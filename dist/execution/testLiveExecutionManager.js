"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const liveExecutionManager_1 = require("./liveExecutionManager");
const exchangeAdapter_1 = require("./exchangeAdapter");
const exchangeTypes_1 = require("./exchangeTypes");
const liveOrderJournal_1 = require("./liveOrderJournal");
const logsDir = path.resolve(__dirname, '../../logs');
const baseState = {
    dailyLiveTrades: 0,
    dailyLivePnlUsd: 0,
    hasOpenLivePosition: false,
};
const baseRequest = {
    symbol: 'BTC',
    side: 'BUY',
    action: 'OPEN',
    orderType: 'MARKET',
    requestedSizeUsd: 10,
    requestedPrice: 65_000,
    reason: 'TEST_BUY_SIGNAL',
    exitLogicPresent: true,
};
const tests = [
    {
        name: 'live order rejected when BOT_MODE != live',
        expected: 'BOT_MODE_NOT_LIVE',
        run: async () => firstFailure({ botMode: 'paper_live' }),
    },
    {
        name: 'live order rejected when LIVE_TRADING_ENABLED != true',
        expected: 'LIVE_TRADING_DISABLED',
        run: async () => firstFailure({ liveTradingEnabled: false }),
    },
    {
        name: 'live order rejected without manual arm',
        expected: 'MANUAL_ARM_NOT_CONFIRMED',
        run: async () => firstFailure({ liveArmConfirm: '' }),
    },
    {
        name: 'live order rejected above max size',
        expected: 'ORDER_SIZE_EXCEEDS_MAX',
        run: async () => {
            const result = await execute({}, { ...baseRequest, requestedSizeUsd: 11 }, baseState);
            return result.safetyGateResult.failures[0] ?? result.order.status;
        },
    },
    {
        name: 'live order rejected after max daily trades',
        expected: 'MAX_DAILY_TRADES_REACHED',
        run: async () => {
            const result = await execute({}, baseRequest, { ...baseState, dailyLiveTrades: 5 });
            return result.safetyGateResult.failures[0] ?? result.order.status;
        },
    },
    {
        name: 'live order rejected after max daily loss',
        expected: 'MAX_DAILY_LOSS_REACHED',
        run: async () => {
            const result = await execute({}, baseRequest, { ...baseState, dailyLivePnlUsd: -5 });
            return result.safetyGateResult.failures[0] ?? result.order.status;
        },
    },
    {
        name: 'live order accepted when all gates pass using stub adapter',
        expected: 'FILLED',
        run: async () => {
            const result = await execute({}, baseRequest, baseState);
            return result.order.status;
        },
    },
    {
        name: 'close order accepted when exit signal fires',
        expected: 'FILLED',
        run: async () => {
            const closeRequest = {
                ...baseRequest,
                side: 'SELL',
                action: 'CLOSE',
                reason: 'TAKE_PROFIT_EXIT',
            };
            const result = await execute({}, closeRequest, { ...baseState, hasOpenLivePosition: true, openPositionSide: 'LONG' });
            return result.order.status;
        },
    },
];
async function main() {
    resetTestLogs();
    let failures = 0;
    for (const test of tests) {
        const actual = await test.run();
        const passed = actual === test.expected;
        if (!passed)
            failures++;
        console.log(`Test: ${test.name}`);
        console.log(`Expected: ${test.expected}`);
        console.log(`Actual:   ${actual}`);
        console.log(`Result:   ${passed ? 'PASS' : 'FAIL'}`);
        console.log('');
    }
    const csvExists = fs.existsSync(path.join(logsDir, 'live-orders.csv'));
    const jsonExists = fs.existsSync(path.join(logsDir, 'live-orders.json'));
    if (!csvExists || !jsonExists) {
        failures++;
        console.log('Test: live order journal files written');
        console.log('Expected: live-orders.csv and live-orders.json');
        console.log(`Actual:   csv=${csvExists} json=${jsonExists}`);
        console.log('Result:   FAIL');
        console.log('');
    }
    if (failures > 0) {
        console.error(`Live execution manager tests: ${tests.length - failures}/${tests.length} passed`);
        process.exit(1);
    }
    console.log(`Live execution manager tests: ${tests.length}/${tests.length} passed`);
}
async function firstFailure(configPatch) {
    const result = await execute(configPatch, baseRequest, baseState);
    return result.safetyGateResult.failures[0] ?? result.order.status;
}
async function execute(configPatch, request, state) {
    const config = makeConfig(configPatch);
    const manager = new liveExecutionManager_1.LiveExecutionManager(config, new exchangeAdapter_1.StubExchangeAdapter('STUB'), new liveOrderJournal_1.LiveOrderJournal({ logsDir }));
    return manager.execute(request, state);
}
function makeConfig(patch = {}) {
    return {
        botMode: 'live',
        signalSource: 'ICT',
        marketDataSource: 'SIMULATOR',
        realPublicHost: 'https://api.binance.com',
        symbol: 'BTC',
        side: 'LONG',
        orderSizeUsd: 100,
        maxCapUsd: 500,
        takeProfitPct: 0.006,
        dcaTriggerPct: 0.015,
        profitTargetUsdMin: 0.50,
        profitTargetUsdMax: 1.00,
        maxPositionMinutes: 5,
        maxLossUsd: 1,
        allowMultiplePositions: true,
        maxConcurrentPositions: 3,
        targetProfitMinUsd: 0.50,
        targetProfitMaxUsd: 1.00,
        maxRiskPerTradeUsd: 1.00,
        minPositionUsd: 25,
        maxPositionUsd: 500,
        positionSizingMode: 'RISK_FIRST',
        hardStopEnabled: true,
        stopModel: 'TIGHT_FVG',
        debugIctPipeline: false,
        breakevenTriggerProfitUsd: 0.80,
        partialCloseEnabled: true,
        partialCloseTriggerProfitUsd: 1.30,
        partialCloseLockProfitUsd: 1.00,
        startupCandleLimit: 500,
        exitTargetMode: 'HYBRID',
        targetRMultiple: 1.5,
        minRiskRewardRatio: 1.5,
        maxTargetDistancePercent: 0,
        oppositeSignalMaxLossUsd: 0.30,
        maxTotalOpenPositions: 5,
        maxActiveRiskPositions: 3,
        volumeLookback: 20,
        volumeSpikeMultiplier: 2,
        reversalDropPercent: 1,
        ictMinConfidence: 75,
        ictTradeOnIfvgFormation: true,
        ictTargetSwingLeft: 3,
        ictTargetSwingRight: 3,
        ictTargetFallbackLookback: 50,
        tradingViewSymbol: 'BINANCE:BTCUSDT',
        liveTradingEnabled: true,
        exchangeName: 'STUB',
        exchangeApiKey: 'test-key',
        exchangeApiSecret: 'test-secret',
        exchangeApiPassphrase: '',
        liveSymbol: 'BTC',
        liveOrderSizeUsd: 10,
        maxLiveOrderSizeUsd: 10,
        maxDailyLossUsd: 5,
        maxDailyTrades: 5,
        allowShorts: true,
        requireManualArm: true,
        liveArmConfirm: exchangeTypes_1.LIVE_ARM_CONFIRMATION,
        startPrice: 65_000,
        tickIntervalMs: 2_000,
        priceVolatility: 0.80,
        priceDrift: 0,
        baseVolume: 800,
        startingCapital: 10_000,
        ...patch,
    };
}
function resetTestLogs() {
    if (!fs.existsSync(logsDir))
        fs.mkdirSync(logsDir, { recursive: true });
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});

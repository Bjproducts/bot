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
const config_1 = require("./config");
const tradeJournal_1 = require("./journal/tradeJournal");
const positionExitManager_1 = require("./positionExitManager");
const now = new Date('2026-06-01T12:00:00.000Z');
const recent = '2026-06-01T11:50:00.000Z';
const old = '2026-06-01T11:20:00.000Z';
const fixtures = [
    {
        name: 'position closes at max loss',
        position: position('LONG', recent),
        price: 99,
        settings: settings({ takeProfitPct: 0.02, maxLossUsd: 1 }),
        now,
        expectedReason: 'RISK_EXIT',
    },
    {
        name: 'LONG closes at managed target before fixed TP',
        position: {
            ...position('LONG', recent),
            targetPrice: 100.75,
            targetSource: 'OPPOSING_FVG',
        },
        price: 100.8,
        settings: settings({ takeProfitPct: 0.02, profitTargetUsdMin: 999 }),
        now,
        expectedReason: 'MANAGED_TARGET_EXIT',
    },
    {
        name: 'SHORT closes at breakeven stop after BE is armed',
        position: {
            ...position('SHORT', recent),
            stopAtBreakeven: true,
        },
        price: 100,
        settings: settings({ takeProfitPct: 0.02, profitTargetUsdMin: 999, maxLossUsd: 999 }),
        now,
        expectedReason: 'BREAKEVEN_STOP_EXIT',
    },
];
const results = fixtures.map((fixture) => {
    const actual = (0, positionExitManager_1.evaluatePositionExit)(fixture.position, fixture.price, fixture.settings, fixture.now);
    return {
        name: fixture.name,
        expected: fixture.expectedReason,
        actual: actual.reason,
        passed: actual.shouldClose && actual.reason === fixture.expectedReason,
    };
});
results.push(testFixedTakeProfitDoesNotCloseWithoutManagedTarget());
results.push(testQuickProfitDoesNotClose());
results.push(testTimeExitDoesNotClose());
results.push(testBreakevenActivatesAtHalfTargetDistance());
results.push(testBreakevenDoesNotActivateBeforeHalfTargetDistance());
const zoneDisrespectFixtures = [
    {
        name: 'SHORT closes when candle body closes above bearish entry zone high',
        position: positionWithEntryZone('SHORT', 'FVG', 'BEARISH'),
        candle: candle(101, 103, 100.5, 102.5),
        expectedReason: 'ENTRY_ZONE_DISRESPECT_EXIT',
    },
    {
        name: 'SHORT does not close on wick above only',
        position: positionWithEntryZone('SHORT', 'FVG', 'BEARISH'),
        candle: candle(101, 103, 100.5, 101.5),
        expectedReason: null,
    },
    {
        name: 'LONG closes when candle body closes below bullish entry zone low',
        position: positionWithEntryZone('LONG', 'FVG', 'BULLISH'),
        candle: candle(100.5, 101, 99, 99.5),
        expectedReason: 'ENTRY_ZONE_DISRESPECT_EXIT',
    },
    {
        name: 'LONG does not close on wick below only',
        position: positionWithEntryZone('LONG', 'FVG', 'BULLISH'),
        candle: candle(100.5, 101, 99, 100.5),
        expectedReason: null,
    },
    {
        name: 'No close if unrelated opposite signal appears',
        position: positionWithEntryZone('LONG', 'FVG', 'BULLISH'),
        candle: candle(101, 102, 100.25, 101.5),
        expectedReason: null,
    },
];
for (const fixture of zoneDisrespectFixtures) {
    const actual = (0, positionExitManager_1.evaluateEntryZoneDisrespectExit)(fixture.position, fixture.candle);
    results.push({
        name: fixture.name,
        expected: fixture.expectedReason ?? 'NO_CLOSE',
        actual: actual.reason ?? 'NO_CLOSE',
        passed: actual.reason === fixture.expectedReason,
    });
}
results.push(testCompletedTradeRecordWritten());
results.push(testCompletedDisrespectTradeRecordWritten());
results.push(testCompletedHardStopTradeRecordWritten());
results.push(testMaxHoldDefaultIsFiveMinutes());
results.push(testExitPriorityChoosesZoneDisrespectBeforeTimeExit());
results.push(testLongHardStopExit());
results.push(testShortHardStopExit());
results.push(testExitPriorityChoosesHardStopBeforeZoneDisrespectAndTimeExit());
for (const result of results) {
    console.log(`Test: ${result.name}`);
    console.log(`Expected: ${result.expected}`);
    console.log(`Actual:   ${result.actual}`);
    console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log('');
}
const failed = results.filter(result => !result.passed);
console.log(`Position exit manager tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
function testCompletedTradeRecordWritten() {
    const logsDir = path.resolve(__dirname, '../logs', `.position-exit-test-${Date.now()}`);
    fs.rmSync(logsDir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir });
    const event = {
        timestamp: now.toISOString(),
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'MANAGED_TARGET_EXIT',
        side: 'LONG',
        price: 100.5,
        size: 1,
        investedUsd: 100,
        avgEntry: 100,
        dcaCount: 0,
        realizedPnlUsd: 0.5,
        signalDirection: 'BUY',
        signalSource: 'ICT',
    };
    const trade = {
        id: 'fixture-close',
        symbol: 'BTC',
        side: 'LONG',
        marketDataSource: 'TEST',
        entryTimestamp: '2026-06-01T11:59:00.000Z',
        exitTimestamp: now.toISOString(),
        entryPrice: 100,
        avgEntryPrice: 100,
        exitPrice: 100.5,
        dcaCount: 0,
        totalInvestedUsd: 100,
        realizedPnlUsd: 0.5,
        pnlPct: 0.5,
        reason: 'MANAGED_TARGET_EXIT',
    };
    journal.logClose(event, trade);
    const completedPath = path.join(logsDir, 'completed-trades.json');
    const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    const actual = saved[0]?.reason ?? 'missing';
    const passed = saved.length === 1 && actual === 'MANAGED_TARGET_EXIT';
    fs.rmSync(logsDir, { recursive: true, force: true });
    return {
        name: 'completed trade record is written',
        expected: 'MANAGED_TARGET_EXIT',
        actual,
        passed,
    };
}
function position(side, openedAt) {
    return {
        id: null,
        activePositionSize: 1,
        averageEntryPrice: 100,
        totalUsdInvested: 100,
        side,
        dcaCount: 1,
        lastDcaPrice: 100,
        openedAt,
        entryZoneId: null,
        entryZoneType: null,
        entryZoneHigh: null,
        entryZoneLow: null,
        entryZoneMidpoint: null,
        entryZoneDirection: null,
        entryZoneRespected: null,
        targetPrice: null,
        targetSource: null,
        targetZoneId: null,
        targetZoneType: null,
        targetZoneHigh: null,
        targetZoneLow: null,
        targetZoneDirection: null,
        targetDisrespected: null,
        stopAtBreakeven: false,
        stopMovedToBreakevenAt: null,
        breakevenActivationPrice: null,
        breakevenActivationTime: null,
        hardStopPrice: null,
        hardStopEnabled: false,
        stopPrice: null,
        stopSource: null,
        stopRiskDistance: null,
        stopZoneSize: null,
        positionSizeUsd: null,
        expectedProfitUsd: null,
        expectedLossUsd: null,
        riskRewardRatio: null,
        sizingMode: null,
        riskUtilizationPercent: null,
        riskUtilizationWarning: null,
        targetRMultiple: null,
        expectedMovePercent: null,
        selectionScore: null,
        scoreAttribution: null,
    };
}
function positionWithHardStop(side, hardStopPrice) {
    return {
        ...position(side, recent),
        hardStopEnabled: true,
        hardStopPrice,
        sizingMode: 'RISK_FIRST',
        expectedLossUsd: 1,
        expectedProfitUsd: 1.5,
        riskRewardRatio: 1.5,
        riskUtilizationPercent: 100,
        riskUtilizationWarning: false,
        targetRMultiple: 1.5,
        positionSizeUsd: 100,
    };
}
function positionWithEntryZone(side, entryZoneType, entryZoneDirection) {
    return {
        ...position(side, recent),
        entryZoneId: `${entryZoneType}:${entryZoneDirection}:fixture`,
        entryZoneType,
        entryZoneHigh: 102,
        entryZoneLow: 100,
        entryZoneMidpoint: 101,
        entryZoneDirection,
        entryZoneRespected: true,
    };
}
function candle(open, high, low, close) {
    return {
        timestamp: now,
        open,
        high,
        low,
        close,
        volume: 100,
    };
}
function testCompletedDisrespectTradeRecordWritten() {
    const logsDir = path.resolve(__dirname, '../logs', `.position-disrespect-test-${Date.now()}`);
    fs.rmSync(logsDir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir });
    const event = {
        timestamp: now.toISOString(),
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'ENTRY_ZONE_DISRESPECT_EXIT',
        side: 'SHORT',
        price: 102.5,
        size: 1,
        investedUsd: 100,
        avgEntry: 100,
        dcaCount: 0,
        realizedPnlUsd: -2.5,
        signalDirection: 'SELL',
        signalSource: 'ICT',
        tradeDurationMinutes: 1,
        entryZoneId: 'FVG:BEARISH:fixture',
        entryZoneType: 'FVG',
        entryZoneHigh: 102,
        entryZoneLow: 100,
        entryZoneMidpoint: 101,
        entryZoneDirection: 'BEARISH',
        entryZoneRespected: false,
        disrespectCandleClose: 102.5,
        zoneBoundaryViolated: 'HIGH',
    };
    const trade = {
        id: 'fixture-disrespect-close',
        symbol: 'BTC',
        side: 'SHORT',
        marketDataSource: 'TEST',
        entryTimestamp: '2026-06-01T11:59:00.000Z',
        exitTimestamp: now.toISOString(),
        entryPrice: 100,
        avgEntryPrice: 100,
        exitPrice: 102.5,
        dcaCount: 0,
        totalInvestedUsd: 100,
        realizedPnlUsd: -2.5,
        pnlPct: -2.5,
        reason: 'ENTRY_ZONE_DISRESPECT_EXIT',
        tradeDurationMinutes: 1,
        entryZoneId: 'FVG:BEARISH:fixture',
        entryZoneType: 'FVG',
        entryZoneHigh: 102,
        entryZoneLow: 100,
        entryZoneMidpoint: 101,
        entryZoneDirection: 'BEARISH',
        entryZoneRespected: false,
        disrespectCandleClose: 102.5,
        zoneBoundaryViolated: 'HIGH',
    };
    journal.logClose(event, trade);
    const completedPath = path.join(logsDir, 'completed-trades.json');
    const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    const actual = saved[0]?.reason ?? 'missing';
    const passed = saved.length === 1
        && actual === 'ENTRY_ZONE_DISRESPECT_EXIT'
        && saved[0].entryZoneId === 'FVG:BEARISH:fixture'
        && saved[0].disrespectCandleClose === 102.5
        && saved[0].zoneBoundaryViolated === 'HIGH'
        && saved[0].tradeDurationMinutes === 1;
    fs.rmSync(logsDir, { recursive: true, force: true });
    return {
        name: 'completed trade is written with ENTRY_ZONE_DISRESPECT_EXIT',
        expected: 'ENTRY_ZONE_DISRESPECT_EXIT',
        actual,
        passed,
    };
}
function testMaxHoldDefaultIsFiveMinutes() {
    return {
        name: 'max hold default is 5 minutes',
        expected: '5',
        actual: String(config_1.DEFAULT_MAX_POSITION_MINUTES),
        passed: config_1.DEFAULT_MAX_POSITION_MINUTES === 5 && settings().maxPositionMinutes === 5,
    };
}
function testExitPriorityChoosesZoneDisrespectBeforeTimeExit() {
    const positionState = positionWithEntryZone('SHORT', 'FVG', 'BEARISH');
    positionState.openedAt = old;
    const result = (0, positionExitManager_1.evaluatePositionLifecycleExit)(positionState, 102.5, candle(101, 103, 100.5, 102.5), settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }), now);
    return {
        name: 'exit priority chooses zone disrespect while time exit is disabled',
        expected: 'ENTRY_ZONE_DISRESPECT_EXIT',
        actual: result.reason,
        passed: result.reason === 'ENTRY_ZONE_DISRESPECT_EXIT'
            && result.entryZoneDisrespect.reason === 'ENTRY_ZONE_DISRESPECT_EXIT'
            && result.positionExit.reason === null,
    };
}
function testLongHardStopExit() {
    const result = (0, positionExitManager_1.evaluatePositionLifecycleExit)(positionWithHardStop('LONG', 99), 99, candle(100, 101, 98.5, 99), settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }), now);
    return {
        name: 'LONG hard stop exits when close <= stopPrice',
        expected: 'HARD_STOP_EXIT',
        actual: result.reason,
        passed: result.reason === 'HARD_STOP_EXIT',
    };
}
function testShortHardStopExit() {
    const result = (0, positionExitManager_1.evaluatePositionLifecycleExit)(positionWithHardStop('SHORT', 101), 101, candle(100, 101.5, 99.5, 101), settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }), now);
    return {
        name: 'SHORT hard stop exits when close >= stopPrice',
        expected: 'HARD_STOP_EXIT',
        actual: result.reason,
        passed: result.reason === 'HARD_STOP_EXIT',
    };
}
function testExitPriorityChoosesHardStopBeforeZoneDisrespectAndTimeExit() {
    const positionState = {
        ...positionWithEntryZone('SHORT', 'FVG', 'BEARISH'),
        openedAt: old,
        hardStopEnabled: true,
        hardStopPrice: 101,
    };
    const result = (0, positionExitManager_1.evaluatePositionLifecycleExit)(positionState, 102.5, candle(101, 103, 100.5, 102.5), settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }), now);
    return {
        name: 'exit priority chooses hard stop before zone disrespect while time exit is disabled',
        expected: 'HARD_STOP_EXIT',
        actual: result.reason,
        passed: result.reason === 'HARD_STOP_EXIT'
            && result.hardStop.reason === 'HARD_STOP_EXIT'
            && result.entryZoneDisrespect.reason === 'ENTRY_ZONE_DISRESPECT_EXIT'
            && result.positionExit.reason === null,
    };
}
function testFixedTakeProfitDoesNotCloseWithoutManagedTarget() {
    const result = (0, positionExitManager_1.evaluatePositionExit)(position('LONG', recent), 101, settings({ profitTargetUsdMin: 999, takeProfitPct: 0.01 }), now);
    return {
        name: 'fixed percent take-profit no longer closes trades',
        expected: 'NO_EXIT',
        actual: result.reason,
        passed: !result.shouldClose && result.reason === null,
    };
}
function testQuickProfitDoesNotClose() {
    const result = (0, positionExitManager_1.evaluatePositionExit)(position('LONG', recent), 100.5, settings({ profitTargetUsdMin: 0.5, takeProfitPct: 0.99 }), now);
    return {
        name: 'quick profit no longer closes trades',
        expected: 'NO_EXIT',
        actual: result.reason,
        passed: !result.shouldClose && result.reason === null,
    };
}
function testTimeExitDoesNotClose() {
    const result = (0, positionExitManager_1.evaluatePositionExit)(position('LONG', old), 100, settings({ maxPositionMinutes: 30, profitTargetUsdMin: 999, takeProfitPct: 0.99, maxLossUsd: 999 }), now);
    return {
        name: 'time-based exit no longer closes trades',
        expected: 'NO_EXIT',
        actual: result.reason,
        passed: !result.shouldClose && result.reason === null && result.positionAgeMinutes !== null,
    };
}
function testBreakevenActivatesAtHalfTargetDistance() {
    const positionState = {
        ...position('LONG', recent),
        targetPrice: 110,
        targetSource: 'SCALP_R',
    };
    const progress = (0, positionExitManager_1.calculateProgressToTargetPercent)(positionState, 105);
    const activates = (0, positionExitManager_1.shouldActivateBreakeven)(positionState, 105, 50);
    return {
        name: 'break-even activates at 50% target progress',
        expected: '50 true',
        actual: `${progress?.toFixed(0) ?? 'null'} ${activates}`,
        passed: progress === 50 && activates,
    };
}
function testBreakevenDoesNotActivateBeforeHalfTargetDistance() {
    const positionState = {
        ...position('SHORT', recent),
        targetPrice: 90,
        targetSource: 'SCALP_R',
    };
    const progress = (0, positionExitManager_1.calculateProgressToTargetPercent)(positionState, 96);
    const activates = (0, positionExitManager_1.shouldActivateBreakeven)(positionState, 96, 50);
    return {
        name: 'break-even does not activate before 50% target progress',
        expected: '40 false',
        actual: `${progress?.toFixed(0) ?? 'null'} ${activates}`,
        passed: progress === 40 && !activates,
    };
}
function testCompletedHardStopTradeRecordWritten() {
    const logsDir = path.resolve(__dirname, '../logs', `.position-hard-stop-test-${Date.now()}`);
    fs.rmSync(logsDir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir });
    const event = {
        timestamp: now.toISOString(),
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'HARD_STOP_EXIT',
        side: 'LONG',
        price: 99,
        size: 1,
        investedUsd: 100,
        avgEntry: 100,
        dcaCount: 0,
        realizedPnlUsd: -1,
        signalDirection: 'BUY',
        signalSource: 'ICT',
        positionSizeUsd: 100,
        sizingMode: 'RISK_FIRST',
        hardStopPrice: 99,
        expectedProfitUsd: 1.5,
        expectedLossUsd: 1,
        riskRewardRatio: 1.5,
        riskUtilizationPercent: 100,
        targetRMultiple: 1.5,
    };
    const trade = {
        id: 'fixture-hard-stop-close',
        symbol: 'BTC',
        side: 'LONG',
        marketDataSource: 'TEST',
        entryTimestamp: '2026-06-01T11:59:00.000Z',
        exitTimestamp: now.toISOString(),
        entryPrice: 100,
        avgEntryPrice: 100,
        exitPrice: 99,
        dcaCount: 0,
        totalInvestedUsd: 100,
        realizedPnlUsd: -1,
        pnlPct: -1,
        reason: 'HARD_STOP_EXIT',
        positionSizeUsd: 100,
        sizingMode: 'RISK_FIRST',
        hardStopPrice: 99,
        expectedProfitUsd: 1.5,
        expectedLossUsd: 1,
        riskRewardRatio: 1.5,
        riskUtilizationPercent: 100,
        targetRMultiple: 1.5,
    };
    journal.logClose(event, trade);
    const completedPath = path.join(logsDir, 'completed-trades.json');
    const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    const actual = `${saved[0]?.reason ?? 'missing'} ${saved[0]?.sizingMode ?? 'missing'} ${saved[0]?.hardStopPrice ?? 'missing'}`;
    const passed = saved.length === 1
        && saved[0].reason === 'HARD_STOP_EXIT'
        && saved[0].sizingMode === 'RISK_FIRST'
        && saved[0].hardStopPrice === 99;
    fs.rmSync(logsDir, { recursive: true, force: true });
    return {
        name: 'completed trade logs hardStopPrice and sizingMode',
        expected: 'HARD_STOP_EXIT RISK_FIRST 99',
        actual,
        passed,
    };
}
function settings(overrides = {}) {
    return {
        takeProfitPct: 0.01,
        profitTargetUsdMin: 0.5,
        profitTargetUsdMax: 1,
        maxPositionMinutes: config_1.DEFAULT_MAX_POSITION_MINUTES,
        maxLossUsd: 1,
        ...overrides,
    };
}

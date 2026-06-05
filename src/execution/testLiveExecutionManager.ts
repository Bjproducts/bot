import * as fs from 'fs';
import * as path from 'path';
import { BotConfig } from '../types';
import { LiveExecutionManager } from './liveExecutionManager';
import { StubExchangeAdapter } from './exchangeAdapter';
import { LIVE_ARM_CONFIRMATION, LiveExecutionState, LiveOrderRequest } from './exchangeTypes';
import { LiveOrderJournal } from './liveOrderJournal';

interface TestCase {
  name: string;
  expected: string;
  run: () => Promise<string>;
}

const logsDir = path.resolve(__dirname, '../../logs');

const baseState: LiveExecutionState = {
  dailyLiveTrades: 0,
  dailyLivePnlUsd: 0,
  hasOpenLivePosition: false,
};

const baseRequest: LiveOrderRequest = {
  symbol: 'BTC',
  side: 'BUY',
  action: 'OPEN',
  orderType: 'MARKET',
  requestedSizeUsd: 10,
  requestedPrice: 65_000,
  reason: 'TEST_BUY_SIGNAL',
  exitLogicPresent: true,
};

const tests: TestCase[] = [
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
      const closeRequest: LiveOrderRequest = {
        ...baseRequest,
        side: 'SELL',
        action: 'CLOSE',
        reason: 'TAKE_PROFIT_EXIT',
      };
      const result = await execute(
        {},
        closeRequest,
        { ...baseState, hasOpenLivePosition: true, openPositionSide: 'LONG' },
      );
      return result.order.status;
    },
  },
];

async function main(): Promise<void> {
  resetTestLogs();
  let failures = 0;

  for (const test of tests) {
    const actual = await test.run();
    const passed = actual === test.expected;
    if (!passed) failures++;

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

async function firstFailure(configPatch: Partial<BotConfig>): Promise<string> {
  const result = await execute(configPatch, baseRequest, baseState);
  return result.safetyGateResult.failures[0] ?? result.order.status;
}

async function execute(
  configPatch: Partial<BotConfig>,
  request: LiveOrderRequest,
  state: LiveExecutionState,
) {
  const config = makeConfig(configPatch);
  const manager = new LiveExecutionManager(
    config,
    new StubExchangeAdapter('STUB'),
    new LiveOrderJournal({ logsDir }),
  );
  return manager.execute(request, state);
}

function makeConfig(patch: Partial<BotConfig> = {}): BotConfig {
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
    breakevenTriggerProfitUsd: 0.40,
    partialCloseEnabled: true,
    partialCloseTriggerProfitUsd: 1.00,
    partialCloseLockProfitUsd: 0.75,
    partialCloseMaxFraction: 0.85,
    startupCandleLimit: 500,
    exitTargetMode: 'HYBRID',
    targetRMultiple: 1.5,
    minRiskRewardRatio: 1.5,
    maxTargetDistancePercent: 0,
    oppositeSignalMaxLossUsd: 0.50,
    recentSignalWatchEnabled: true,
    recentSignalWatchTtlCandles: 3,
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
    liveArmConfirm: LIVE_ARM_CONFIRMATION,
    startPrice: 65_000,
    tickIntervalMs: 2_000,
    priceVolatility: 0.80,
    priceDrift: 0,
    baseVolume: 800,
    startingCapital: 10_000,
    ...patch,
  };
}

function resetTestLogs(): void {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_MAX_POSITION_MINUTES } from './config';
import { TradeJournal } from './journal/tradeJournal';
import { CompletedTrade, TradeEvent } from './journal/types';
import {
  evaluateEntryZoneDisrespectExit,
  evaluatePositionExit,
  evaluatePositionLifecycleExit,
} from './positionExitManager';
import {
  applyPartialClose,
  planPartialClose,
  shouldActivateDollarBreakeven,
} from './positionTradeManagement';
import { formatPerPositionRows } from './sessionStats';
import { PositionCloseReason, PositionExitSettings } from './positionExitTypes';
import { Candle, PositionState } from './types';

interface ExitFixture {
  name: string;
  position: PositionState;
  price: number;
  settings: PositionExitSettings;
  now: Date;
  expectedReason: PositionCloseReason;
}

interface TestResult {
  name: string;
  expected: string;
  actual: string | null;
  passed: boolean;
}

interface ZoneDisrespectFixture {
  name: string;
  position: PositionState;
  candle: Candle;
  expectedReason: PositionCloseReason | null;
}

const now = new Date('2026-06-01T12:00:00.000Z');
const recent = '2026-06-01T11:50:00.000Z';
const old = '2026-06-01T11:20:00.000Z';

const fixtures: ExitFixture[] = [
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

const results: TestResult[] = fixtures.map((fixture) => {
  const actual = evaluatePositionExit(
    fixture.position,
    fixture.price,
    fixture.settings,
    fixture.now,
  );

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
results.push(testBreakevenActivatesAtDollarProfit());
results.push(testBreakevenDoesNotUseAggregateBasketPnl());
results.push(testPartialCloseTriggersAtDollarProfit());
results.push(testPartialCloseRealizesExactlyOneDollar());
results.push(testPartialCloseOnlyOnce());
results.push(testRunnerRemainsOpenAfterPartialClose());
results.push(testCompletedPnlIncludesPartialAndRunner());
results.push(testDashboardFormatsMultipleActivePositions());

const zoneDisrespectFixtures: ZoneDisrespectFixture[] = [
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
  const actual = evaluateEntryZoneDisrespectExit(fixture.position, fixture.candle);
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
results.push(testEntryWritesTradeEventsJsonl());
results.push(testPartialCloseWritesTradeEventsJsonl());
results.push(testBreakevenWritesTradeEventsJsonl());
results.push(testManagedTargetWritesCompletedJsonl());
results.push(testHardStopWritesCompletedJsonl());
results.push(testRestartDoesNotEraseJsonlLogs());
results.push(testCompletedJsonlPnlIncludesPartialAndRunner());
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

function testCompletedTradeRecordWritten(): {
  name: string;
  expected: string;
  actual: string | null;
  passed: boolean;
} {
  const logsDir = path.resolve(__dirname, '../logs', `.position-exit-test-${Date.now()}`);
  fs.rmSync(logsDir, { recursive: true, force: true });

  const journal = new TradeJournal({ logsDir });
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
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
  const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8')) as CompletedTrade[];
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

function position(side: 'LONG' | 'SHORT', openedAt: string): PositionState {
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
    partialCloseDone: false,
    partialClosePrice: null,
    partialCloseTime: null,
    partialCloseFraction: null,
    realizedPartialPnlUsd: 0,
    remainingSizeAfterPartial: null,
    finalRunnerPnlUsd: null,
    totalPnlUsd: null,
    maxFavorableExcursionUsd: 0,
    maxAdverseExcursionUsd: 0,
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

function positionWithHardStop(side: 'LONG' | 'SHORT', hardStopPrice: number): PositionState {
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

function positionWithEntryZone(
  side: 'LONG' | 'SHORT',
  entryZoneType: 'FVG' | 'IFVG',
  entryZoneDirection: 'BULLISH' | 'BEARISH',
): PositionState {
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

function candle(open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: now,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function testCompletedDisrespectTradeRecordWritten(): {
  name: string;
  expected: string;
  actual: string | null;
  passed: boolean;
} {
  const logsDir = path.resolve(__dirname, '../logs', `.position-disrespect-test-${Date.now()}`);
  fs.rmSync(logsDir, { recursive: true, force: true });

  const journal = new TradeJournal({ logsDir });
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
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
  const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8')) as CompletedTrade[];
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

function testMaxHoldDefaultIsFiveMinutes(): TestResult {
  return {
    name: 'max hold default is 5 minutes',
    expected: '5',
    actual: String(DEFAULT_MAX_POSITION_MINUTES),
    passed: DEFAULT_MAX_POSITION_MINUTES === 5 && settings().maxPositionMinutes === 5,
  };
}

function testExitPriorityChoosesZoneDisrespectBeforeTimeExit(): TestResult {
  const positionState = positionWithEntryZone('SHORT', 'FVG', 'BEARISH');
  positionState.openedAt = old;
  const result = evaluatePositionLifecycleExit(
    positionState,
    102.5,
    candle(101, 103, 100.5, 102.5),
    settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }),
    now,
  );

  return {
    name: 'exit priority chooses zone disrespect while time exit is disabled',
    expected: 'ENTRY_ZONE_DISRESPECT_EXIT',
    actual: result.reason,
    passed: result.reason === 'ENTRY_ZONE_DISRESPECT_EXIT'
      && result.entryZoneDisrespect.reason === 'ENTRY_ZONE_DISRESPECT_EXIT'
      && result.positionExit.reason === null,
  };
}

function testLongHardStopExit(): TestResult {
  const result = evaluatePositionLifecycleExit(
    positionWithHardStop('LONG', 99),
    99,
    candle(100, 101, 98.5, 99),
    settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }),
    now,
  );

  return {
    name: 'LONG hard stop exits when close <= stopPrice',
    expected: 'HARD_STOP_EXIT',
    actual: result.reason,
    passed: result.reason === 'HARD_STOP_EXIT',
  };
}

function testShortHardStopExit(): TestResult {
  const result = evaluatePositionLifecycleExit(
    positionWithHardStop('SHORT', 101),
    101,
    candle(100, 101.5, 99.5, 101),
    settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }),
    now,
  );

  return {
    name: 'SHORT hard stop exits when close >= stopPrice',
    expected: 'HARD_STOP_EXIT',
    actual: result.reason,
    passed: result.reason === 'HARD_STOP_EXIT',
  };
}

function testExitPriorityChoosesHardStopBeforeZoneDisrespectAndTimeExit(): TestResult {
  const positionState = {
    ...positionWithEntryZone('SHORT', 'FVG', 'BEARISH'),
    openedAt: old,
    hardStopEnabled: true,
    hardStopPrice: 101,
  };
  const result = evaluatePositionLifecycleExit(
    positionState,
    102.5,
    candle(101, 103, 100.5, 102.5),
    settings({ maxLossUsd: 999, profitTargetUsdMin: 999, takeProfitPct: 0.99 }),
    now,
  );

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

function testFixedTakeProfitDoesNotCloseWithoutManagedTarget(): TestResult {
  const result = evaluatePositionExit(
    position('LONG', recent),
    101,
    settings({ profitTargetUsdMin: 999, takeProfitPct: 0.01 }),
    now,
  );

  return {
    name: 'fixed percent take-profit no longer closes trades',
    expected: 'NO_EXIT',
    actual: result.reason,
    passed: !result.shouldClose && result.reason === null,
  };
}

function testQuickProfitDoesNotClose(): TestResult {
  const result = evaluatePositionExit(
    position('LONG', recent),
    100.5,
    settings({ profitTargetUsdMin: 0.5, takeProfitPct: 0.99 }),
    now,
  );

  return {
    name: 'quick profit no longer closes trades',
    expected: 'NO_EXIT',
    actual: result.reason,
    passed: !result.shouldClose && result.reason === null,
  };
}

function testTimeExitDoesNotClose(): TestResult {
  const result = evaluatePositionExit(
    position('LONG', old),
    100,
    settings({ maxPositionMinutes: 30, profitTargetUsdMin: 999, takeProfitPct: 0.99, maxLossUsd: 999 }),
    now,
  );

  return {
    name: 'time-based exit no longer closes trades',
    expected: 'NO_EXIT',
    actual: result.reason,
    passed: !result.shouldClose && result.reason === null && result.positionAgeMinutes !== null,
  };
}

function testBreakevenActivatesAtDollarProfit(): TestResult {
  const positionState = position('LONG', recent);
  const activates = shouldActivateDollarBreakeven(positionState, 100.8, {
    breakevenTriggerProfitUsd: 0.80,
  });

  return {
    name: 'breakeven activates at +$0.80 individual position profit',
    expected: 'true',
    actual: String(activates),
    passed: activates,
  };
}

function testBreakevenDoesNotUseAggregateBasketPnl(): TestResult {
  const winner = position('LONG', recent);
  const loser = position('SHORT', recent);
  const winnerActivates = shouldActivateDollarBreakeven(winner, 100.9, {
    breakevenTriggerProfitUsd: 0.80,
  });
  const loserActivates = shouldActivateDollarBreakeven(loser, 100.9, {
    breakevenTriggerProfitUsd: 0.80,
  });

  return {
    name: 'breakeven does not activate from aggregate basket PnL',
    expected: 'winner=true loser=false',
    actual: `winner=${winnerActivates} loser=${loserActivates}`,
    passed: winnerActivates && !loserActivates,
  };
}

function testPartialCloseTriggersAtDollarProfit(): TestResult {
  const plan = planPartialClose(position('LONG', recent), 101.3, partialSettings());
  return {
    name: 'partial close triggers at +$1.30',
    expected: 'true',
    actual: String(plan.shouldClosePartial),
    passed: plan.shouldClosePartial,
  };
}

function testPartialCloseRealizesExactlyOneDollar(): TestResult {
  const plan = planPartialClose(position('LONG', recent), 101.3, partialSettings());
  return {
    name: 'partial close realizes exactly $1.00',
    expected: '1.00',
    actual: plan.realizedPartialPnlUsd.toFixed(2),
    passed: Math.abs(plan.realizedPartialPnlUsd - 1) < 0.000001,
  };
}

function testPartialCloseOnlyOnce(): TestResult {
  const alreadyPartial = {
    ...position('LONG', recent),
    partialCloseDone: true,
  };
  const plan = planPartialClose(alreadyPartial, 101.3, partialSettings());
  return {
    name: 'partial close only happens once per position',
    expected: 'false',
    actual: String(plan.shouldClosePartial),
    passed: !plan.shouldClosePartial,
  };
}

function testRunnerRemainsOpenAfterPartialClose(): TestResult {
  const original = position('LONG', recent);
  const plan = planPartialClose(original, 101.3, partialSettings());
  const updated = applyPartialClose(original, 101.3, now, plan);
  return {
    name: 'runner remains open after partial close',
    expected: 'side=LONG remaining>0 partial=true',
    actual: `side=${updated.side} remaining=${updated.activePositionSize.toFixed(6)} partial=${updated.partialCloseDone}`,
    passed: updated.side === 'LONG' && updated.activePositionSize > 0 && updated.partialCloseDone,
  };
}

function testCompletedPnlIncludesPartialAndRunner(): TestResult {
  const partial = {
    ...position('LONG', recent),
    realizedPartialPnlUsd: 1,
  };
  const finalRunnerPnlUsd = 0.25;
  const totalPnlUsd = partial.realizedPartialPnlUsd + finalRunnerPnlUsd;
  return {
    name: 'completed trade PnL includes partial plus final runner PnL',
    expected: '1.25',
    actual: totalPnlUsd.toFixed(2),
    passed: totalPnlUsd === 1.25,
  };
}

function testDashboardFormatsMultipleActivePositions(): TestResult {
  const aggregate = {
    ...position('LONG', recent),
    id: 'AGGREGATE',
    openPositions: [
      {
        ...position('SHORT', recent),
        id: 'p1',
        averageEntryPrice: 100,
        targetPrice: 98,
        hardStopPrice: 101,
        stopAtBreakeven: true,
      },
      {
        ...position('LONG', recent),
        id: 'p2',
        averageEntryPrice: 100,
        targetPrice: 102,
        hardStopPrice: 99,
        partialCloseDone: true,
      },
    ],
  };
  const rows = formatPerPositionRows(aggregate, 99);
  return {
    name: 'dashboard can display multiple active positions separately',
    expected: '2 rows with #1 and #2',
    actual: rows.join(' | '),
    passed: rows.length === 2 && rows[0]!.includes('#1 SHORT') && rows[1]!.includes('#2 LONG'),
  };
}

function partialSettings() {
  return {
    partialCloseEnabled: true,
    partialCloseTriggerProfitUsd: 1.30,
    partialCloseLockProfitUsd: 1.00,
  };
}

function testCompletedHardStopTradeRecordWritten(): TestResult {
  const logsDir = path.resolve(__dirname, '../logs', `.position-hard-stop-test-${Date.now()}`);
  fs.rmSync(logsDir, { recursive: true, force: true });

  const journal = new TradeJournal({ logsDir });
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
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
  const saved = JSON.parse(fs.readFileSync(completedPath, 'utf-8')) as CompletedTrade[];
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

function testEntryWritesTradeEventsJsonl(): TestResult {
  return testJsonlEventWrite('ENTRY', 'trade-events.jsonl');
}

function testPartialCloseWritesTradeEventsJsonl(): TestResult {
  return testJsonlEventWrite('PARTIAL_CLOSE', 'trade-events.jsonl');
}

function testBreakevenWritesTradeEventsJsonl(): TestResult {
  return testJsonlEventWrite('BREAKEVEN_ACTIVATED', 'trade-events.jsonl');
}

function testManagedTargetWritesCompletedJsonl(): TestResult {
  return testJsonlCloseWrite('MANAGED_TARGET_EXIT');
}

function testHardStopWritesCompletedJsonl(): TestResult {
  return testJsonlCloseWrite('HARD_STOP_EXIT');
}

function testRestartDoesNotEraseJsonlLogs(): TestResult {
  const logsDir = tempLogsDir('journal-restart');
  const first = new TradeJournal({ logsDir });
  first.logEvent(journalEvent('ENTRY'));
  const second = new TradeJournal({ logsDir });
  second.logEvent(journalEvent('BREAKEVEN_ACTIVATED'));
  const rows = readJsonl(path.join(logsDir, 'trade-events.jsonl'));
  fs.rmSync(logsDir, { recursive: true, force: true });

  return {
    name: 'killing/restarting bot does not erase JSONL logs',
    expected: '2 rows',
    actual: `${rows.length} rows`,
    passed: rows.length === 2
      && rows[0]?.eventType === 'ENTRY'
      && rows[1]?.eventType === 'BREAKEVEN_ACTIVATED',
  };
}

function testCompletedJsonlPnlIncludesPartialAndRunner(): TestResult {
  const logsDir = tempLogsDir('journal-pnl');
  const journal = new TradeJournal({ logsDir });
  const trade = completedTrade('MANAGED_TARGET_EXIT', {
    realizedPnlUsd: 1.25,
    realizedPartialPnlUsd: 1,
    finalRunnerPnlUsd: 0.25,
    totalPnlUsd: 1.25,
  });
  journal.logClose(journalEvent('MANAGED_TARGET_EXIT', {
    realizedPnlUsd: 1.25,
    realizedPartialPnlUsd: 1,
    finalRunnerPnlUsd: 0.25,
    totalPnlUsd: 1.25,
  }), trade);
  const rows = readJsonl(path.join(logsDir, 'completed-trades.jsonl'));
  fs.rmSync(logsDir, { recursive: true, force: true });

  return {
    name: 'completed trade JSONL PnL includes partial plus runner PnL',
    expected: '1.25',
    actual: String(rows[0]?.finalTotalPnlUsd ?? 'missing'),
    passed: rows[0]?.finalTotalPnlUsd === 1.25
      && rows[0]?.partialClose?.realizedPartialPnlUsd === 1
      && rows[0]?.finalExit?.runnerPnlUsd === 0.25,
  };
}

function testJsonlEventWrite(action: TradeEvent['action'], fileName: string): TestResult {
  const logsDir = tempLogsDir(`journal-${action}`);
  const journal = new TradeJournal({ logsDir });
  journal.logEvent(journalEvent(action));
  const rows = readJsonl(path.join(logsDir, fileName));
  fs.rmSync(logsDir, { recursive: true, force: true });

  return {
    name: `${action} writes to ${fileName}`,
    expected: action,
    actual: String(rows[0]?.eventType ?? 'missing'),
    passed: rows.length === 1 && rows[0]?.eventType === action,
  };
}

function testJsonlCloseWrite(reason: PositionCloseReason): TestResult {
  const logsDir = tempLogsDir(`journal-${reason}`);
  const journal = new TradeJournal({ logsDir });
  journal.logClose(journalEvent(reason), completedTrade(reason));
  const rows = readJsonl(path.join(logsDir, 'completed-trades.jsonl'));
  fs.rmSync(logsDir, { recursive: true, force: true });

  return {
    name: `${reason} writes to completed-trades.jsonl`,
    expected: reason,
    actual: String(rows[0]?.exitType ?? 'missing'),
    passed: rows.length === 1 && rows[0]?.exitType === reason,
  };
}

function journalEvent(
  action: TradeEvent['action'],
  overrides: Partial<TradeEvent> = {},
): TradeEvent {
  return {
    timestamp: now.toISOString(),
    symbol: 'BTC',
    marketDataSource: 'TEST',
    action,
    side: 'LONG',
    price: 101,
    size: 1,
    investedUsd: 100,
    avgEntry: 100,
    dcaCount: 0,
    realizedPnlUsd: 0,
    positionId: 'position-1',
    signalDirection: 'BUY',
    signalSource: 'ICT',
    ictConfidence: 90,
    ictZoneId: 'zone-1',
    ictZoneType: 'FVG',
    targetPrice: 102,
    hardStopPrice: 99,
    activeStopPrice: 100,
    positionSizeUsd: 100,
    unrealizedPnlUsd: 1,
    realizedPartialPnlUsd: 0,
    totalPnlUsd: 0,
    stopSource: 'firstCandleLow',
    riskDistance: 1,
    expectedProfitUsd: 1.5,
    expectedLossUsd: 1,
    riskRewardRatio: 1.5,
    ...overrides,
  };
}

function completedTrade(
  reason: PositionCloseReason,
  overrides: Partial<CompletedTrade> = {},
): CompletedTrade {
  return {
    id: 'completed-1',
    symbol: 'BTC',
    side: 'LONG',
    marketDataSource: 'TEST',
    entryTimestamp: recent,
    exitTimestamp: now.toISOString(),
    entryPrice: 100,
    avgEntryPrice: 100,
    exitPrice: 101,
    dcaCount: 0,
    totalInvestedUsd: 100,
    realizedPnlUsd: 1,
    positionId: 'position-1',
    pnlPct: 1,
    reason,
    partialCloseDone: false,
    realizedPartialPnlUsd: 0,
    finalRunnerPnlUsd: 1,
    totalPnlUsd: 1,
    maxFavorableExcursionUsd: 1.5,
    maxAdverseExcursionUsd: -0.25,
    tradeDurationMinutes: 5,
    ...overrides,
  };
}

function readJsonl(filePath: string): Array<Record<string, any>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map(line => JSON.parse(line) as Record<string, any>);
}

function tempLogsDir(label: string): string {
  const dir = path.resolve(__dirname, '../logs', `.${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

function settings(overrides: Partial<PositionExitSettings> = {}): PositionExitSettings {
  return {
    takeProfitPct: 0.01,
    profitTargetUsdMin: 0.5,
    profitTargetUsdMax: 1,
    maxPositionMinutes: DEFAULT_MAX_POSITION_MINUTES,
    maxLossUsd: 1,
    ...overrides,
  };
}

import { IctSignalZone } from '../ict/ictSignalTypes';
import { calculatePositionSizing } from './positionSizing';
import { PositionSizingConfig } from './positionSizingTypes';
import {
  ExitTargetMode,
  TargetSelectionConfig,
  selectManagedTarget,
} from './targetSelection';
import {
  evaluatePositionLifecycleExit,
} from '../positionExitManager';
import { PositionExitSettings } from '../positionExitTypes';
import { PositionState } from '../types';
import { emptyPositionState } from '../state';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const sizingConfig: PositionSizingConfig = {
  targetProfitMinUsd: 1.00,
  targetProfitMaxUsd: 1.50,
  maxRiskPerTradeUsd: 1.00,
  minPositionUsd: 25,
  maxPositionUsd: 500,
  minRiskRewardRatio: 1.5,
};

const tests: TestResult[] = [
  test1StructureModeUsesOpposingFvg(),
  test2StructureModeFallsBackToSwing(),
  test3ScalpModeUsesRMultiple(),
  test4HybridChoosesScalpWhenStructureTooFar(),
  test5HybridChoosesStructureWhenNearbyAndValid(),
  test6TradeRejectedIfRrBelowMin(),
  test7TradeRejectedIfExpectedLossExceedsMax(),
  test8QuickProfitExitFiresWithManagedTarget(),
];

let failures = 0;
for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Expected: ${test.expected}`);
  console.log(`Actual:   ${test.actual}`);
  console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
  if (!test.passed) failures++;
}

if (failures > 0) {
  console.error(`Target mode tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Target mode tests: ${tests.length}/${tests.length} passed`);

function test1StructureModeUsesOpposingFvg(): TestResult {
  const opposing = bearishFvgZone({ id: 'fvg-opposing', low: 102, high: 103 });
  const result = selectManagedTarget({
    side: 'LONG',
    entryPrice: 100,
    stopPrice: 99,
    opposingZones: [opposing],
    swingTargetPrice: 110,
    config: cfg({ exitTargetMode: 'STRUCTURE' }),
  });
  const target = result.selectedTarget;
  return {
    name: 'STRUCTURE mode uses opposing FVG target',
    expected: 'selectedTarget.source=OPPOSING_FVG and price=102',
    actual: target ? `${target.source} ${target.price}` : 'null',
    passed: target?.source === 'OPPOSING_FVG' && target.price === 102,
  };
}

function test2StructureModeFallsBackToSwing(): TestResult {
  const result = selectManagedTarget({
    side: 'LONG',
    entryPrice: 100,
    stopPrice: 99,
    opposingZones: [],
    swingTargetPrice: 105,
    config: cfg({ exitTargetMode: 'STRUCTURE' }),
  });
  const target = result.selectedTarget;
  return {
    name: 'STRUCTURE mode falls back to swing target',
    expected: 'selectedTarget.source=SWING and price=105',
    actual: target ? `${target.source} ${target.price}` : 'null',
    passed: target?.source === 'SWING' && target.price === 105,
  };
}

function test3ScalpModeUsesRMultiple(): TestResult {
  // entry=100, stop=99 -> riskDistance=1; 1.5R target = 101.5
  const result = selectManagedTarget({
    side: 'LONG',
    entryPrice: 100,
    stopPrice: 99,
    opposingZones: [bearishFvgZone({ id: 'fvg-far', low: 105, high: 106 })],
    swingTargetPrice: 110,
    config: cfg({ exitTargetMode: 'SCALP', targetRMultiple: 1.5 }),
  });
  const target = result.selectedTarget;
  return {
    name: 'SCALP mode uses R-multiple target',
    expected: 'selectedTarget.source=SCALP_R and price=101.5',
    actual: target ? `${target.source} ${target.price}` : 'null',
    passed: target?.source === 'SCALP_R' && approximatelyEqual(target.price, 101.5),
  };
}

function test4HybridChoosesScalpWhenStructureTooFar(): TestResult {
  // entry=100, stop=99 -> scalp 1.5R = 101.5; structure at 115 = 15R (well past
  // 5% maxTargetDistancePercent gate).
  const result = selectManagedTarget({
    side: 'LONG',
    entryPrice: 100,
    stopPrice: 99,
    opposingZones: [bearishFvgZone({ id: 'fvg-far', low: 115, high: 116 })],
    swingTargetPrice: null,
    config: cfg({
      exitTargetMode: 'HYBRID',
      targetRMultiple: 1.5,
      minRiskRewardRatio: 1.5,
      maxTargetDistancePercent: 5,
    }),
  });
  const target = result.selectedTarget;
  return {
    name: 'HYBRID chooses scalp target when structure target is too far',
    expected: 'selectedTarget.source=SCALP_R',
    actual: target ? `${target.source} ${target.price}` : 'null',
    passed: target?.source === 'SCALP_R' && approximatelyEqual(target.price, 101.5),
  };
}

function test5HybridChoosesStructureWhenNearbyAndValid(): TestResult {
  // entry=100, stop=99 -> riskDistance=1; scalp 1.5R target = 101.5.
  // Opposing FVG at 101.5 (= scalp distance). Both valid; structure picked
  // because structureDistance <= scalpDistance.
  const result = selectManagedTarget({
    side: 'LONG',
    entryPrice: 100,
    stopPrice: 99,
    opposingZones: [bearishFvgZone({ id: 'fvg-near', low: 101.5, high: 102.5 })],
    swingTargetPrice: null,
    config: cfg({
      exitTargetMode: 'HYBRID',
      targetRMultiple: 1.5,
      minRiskRewardRatio: 1.5,
      maxTargetDistancePercent: 5,
    }),
  });
  const target = result.selectedTarget;
  return {
    name: 'HYBRID chooses structure target when structure is nearby and valid',
    expected: 'selectedTarget.source=OPPOSING_FVG and price=101.5',
    actual: target ? `${target.source} ${target.price}` : 'null',
    passed: target?.source === 'OPPOSING_FVG' && approximatelyEqual(target.price, 101.5),
  };
}

function test6TradeRejectedIfRrBelowMin(): TestResult {
  // entry=100, stop=99 -> risk=1; target=100.5 -> reward=0.5 -> RR=0.5 < 1.5.
  const sizing = calculatePositionSizing({
    signal: 'BUY',
    confidence: 90,
    selectionScore: 85,
    entryPrice: 100,
    targetPrice: 100.5,
    stopPrice: 99,
    config: sizingConfig,
  });
  return {
    name: 'Trade rejected if RR < 1.5',
    expected: 'sizing.status=REJECTED with RR-related reason',
    actual: `${sizing.status} (${sizing.rejectionReason})`,
    passed: sizing.status === 'REJECTED' && sizing.rejectionReason.toLowerCase().includes('risk/reward'),
  };
}

function test7TradeRejectedIfExpectedLossExceedsMax(): TestResult {
  // Force expected loss > maxRiskPerTradeUsd by setting minPositionUsd so high
  // that even the smallest legal position exceeds the $1 loss cap.
  const tightConfig: PositionSizingConfig = {
    ...sizingConfig,
    minPositionUsd: 500,
    maxRiskPerTradeUsd: 1.00,
  };
  // entry=100, stop=99 -> risk=1% -> loss on $500 position = $5 > $1.
  const sizing = calculatePositionSizing({
    signal: 'BUY',
    confidence: 90,
    selectionScore: 85,
    entryPrice: 100,
    targetPrice: 101.5,
    stopPrice: 99,
    config: tightConfig,
  });
  return {
    name: 'Trade rejected if expected loss > MAX_RISK_PER_TRADE_USD',
    expected: 'sizing.status=REJECTED and expectedLossUsd>1',
    actual: `${sizing.status} expectedLossUsd=${sizing.expectedLossUsd} (${sizing.rejectionReason})`,
    passed: sizing.status === 'REJECTED' && sizing.expectedLossUsd > 1,
  };
}

function test8QuickProfitExitFiresWithManagedTarget(): TestResult {
  // Trade with managed target far away; price has moved into +$1.05 unrealized
  // territory. Quick-profit exit must fire even though the managed target
  // (110) is not yet hit. This proves bot.ts no longer gates useQuickProfitExit
  // behind "no managed target".
  const position: PositionState = {
    ...emptyPositionState(),
    id: 'qp-test-1',
    side: 'LONG',
    activePositionSize: 1.05,
    averageEntryPrice: 100,
    totalUsdInvested: 105,
    openedAt: new Date('2026-06-02T11:55:00.000Z').toISOString(),
    targetPrice: 110,
    targetSource: 'OPPOSING_FVG',
  };
  const settings: PositionExitSettings = {
    takeProfitPct: 0.10,
    profitTargetUsdMin: 1.00,
    profitTargetUsdMax: 1.50,
    maxPositionMinutes: 60,
    maxLossUsd: 1.00,
    useQuickProfitExit: true,
  };
  const evaluation = evaluatePositionLifecycleExit(
    position,
    101,
    null,
    settings,
    new Date('2026-06-02T12:00:00.000Z'),
  );
  return {
    name: 'Quick-profit exit still fires in ICT mode with managed target',
    expected: 'reason=QUICK_PROFIT_EXIT (target=110 not hit, +$1.05 unrealized)',
    actual: evaluation.reason ?? 'null',
    passed: evaluation.reason === 'QUICK_PROFIT_EXIT',
  };
}

function cfg(overrides: Partial<TargetSelectionConfig> & { exitTargetMode: ExitTargetMode }): TargetSelectionConfig {
  return {
    targetRMultiple: 1.5,
    minRiskRewardRatio: 1.5,
    maxTargetDistancePercent: 0,
    ...overrides,
  };
}

function bearishFvgZone(params: { id: string; low: number; high: number }): IctSignalZone {
  return {
    id: params.id,
    type: 'FVG',
    direction: 'BEARISH',
    high: params.high,
    low: params.low,
    midpoint: (params.high + params.low) / 2,
    createdAt: '2026-06-02T00:00:00.000Z',
    invalidated: false,
    filled: false,
    flipped: false,
    candle1Index: 0,
    candle2Index: 1,
    candle3Index: 2,
  };
}

function approximatelyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) < epsilon;
}

import { calculatePositionSizing } from './positionSizing';
import { PositionSizingConfig, PositionSizingInput } from './positionSizingTypes';

interface TestCase {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const baseConfig: PositionSizingConfig = {
  positionSizingMode: 'PROFIT_FIRST',
  targetProfitMinUsd: 0.50,
  targetProfitMaxUsd: 1.00,
  maxRiskPerTradeUsd: 1.00,
  minPositionUsd: 25,
  maxPositionUsd: 500,
  minRiskRewardRatio: 1.5,
};

const riskFirstConfig: PositionSizingConfig = {
  positionSizingMode: 'RISK_FIRST',
  targetProfitMinUsd: 1.00,
  targetProfitMaxUsd: 1.50,
  maxRiskPerTradeUsd: 1.00,
  minPositionUsd: 25,
  maxPositionUsd: 500,
  minRiskRewardRatio: 1.5,
  targetRMultiple: 1.5,
};

const baseInput: PositionSizingInput = {
  signal: 'BUY',
  confidence: 88,
  selectionScore: 84,
  entryPrice: 100,
  targetPrice: 101,
  stopPrice: 99.5,
  config: baseConfig,
};

const tests: TestCase[] = [];

tests.push(testExpectedProfitInsideTargetRange());
tests.push(testExpectedLossCapped());
tests.push(testLowConfidenceReducesSize());
tests.push(testHighConfidenceIncreasesSize());
tests.push(testMaxPositionRespected());
tests.push(testMinPositionRespected());
tests.push(testLowRiskRewardRejected());
tests.push(testRiskFirstTargetsOneDollarRisk());
tests.push(testRiskFirstTargetsFiftyCentRisk());
tests.push(testRiskFirstTargetMultipleProfit());
tests.push(testRiskFirstShortTargetUsesPriceRMultiple());
tests.push(testRiskFirstRejectsWhenMaxPositionPreventsProfit());
tests.push(testRiskFirstRejectsWhenMinPositionExceedsRisk());
tests.push(testRiskUtilizationWarningOnMaxClamp());

let failures = 0;
for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Expected: ${test.expected}`);
  console.log(`Actual:   ${test.actual}`);
  console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
  if (!test.passed) failures++;
}

if (failures > 0) {
  console.error(`Position sizing tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Position sizing tests: ${tests.length}/${tests.length} passed`);

function testExpectedProfitInsideTargetRange(): TestCase {
  const result = calculatePositionSizing(baseInput);
  const passed = result.status === 'ACCEPTED'
    && result.expectedProfitUsd >= baseConfig.targetProfitMinUsd
    && result.expectedProfitUsd <= baseConfig.targetProfitMaxUsd;
  return {
    name: 'expected profit inside target range',
    expected: '$0.50 <= expectedProfit <= $1.00',
    actual: `${result.status} expectedProfit=$${result.expectedProfitUsd}`,
    passed,
  };
}

function testExpectedLossCapped(): TestCase {
  const result = calculatePositionSizing({
    ...baseInput,
    targetPrice: 102,
    stopPrice: 98.7,
  });
  const passed = result.status === 'ACCEPTED'
    && result.expectedLossUsd <= baseConfig.maxRiskPerTradeUsd;
  return {
    name: 'expected loss capped',
    expected: 'expectedLoss <= $1.00',
    actual: `${result.status} expectedLoss=$${result.expectedLossUsd} size=$${result.recommendedPositionSizeUsd}`,
    passed,
  };
}

function testLowConfidenceReducesSize(): TestCase {
  const normal = calculatePositionSizing({ ...baseInput, confidence: 88 });
  const low = calculatePositionSizing({ ...baseInput, confidence: 79 });
  return {
    name: 'position size reduced on low confidence',
    expected: 'low confidence size < normal size',
    actual: `low=$${low.recommendedPositionSizeUsd} normal=$${normal.recommendedPositionSizeUsd}`,
    passed: low.recommendedPositionSizeUsd < normal.recommendedPositionSizeUsd,
  };
}

function testHighConfidenceIncreasesSize(): TestCase {
  const normal = calculatePositionSizing({ ...baseInput, confidence: 88 });
  const high = calculatePositionSizing({ ...baseInput, confidence: 96 });
  return {
    name: 'position size increased on high confidence',
    expected: 'high confidence size > normal size',
    actual: `high=$${high.recommendedPositionSizeUsd} normal=$${normal.recommendedPositionSizeUsd}`,
    passed: high.recommendedPositionSizeUsd > normal.recommendedPositionSizeUsd,
  };
}

function testMaxPositionRespected(): TestCase {
  const config = { ...baseConfig, maxPositionUsd: 50 };
  const result = calculatePositionSizing({
    ...baseInput,
    confidence: 99,
    selectionScore: 99,
    config,
  });
  return {
    name: 'max position respected',
    expected: 'size <= $50',
    actual: `size=$${result.recommendedPositionSizeUsd}`,
    passed: result.recommendedPositionSizeUsd <= config.maxPositionUsd,
  };
}

function testMinPositionRespected(): TestCase {
  const config = { ...baseConfig, minPositionUsd: 40 };
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config,
  });
  return {
    name: 'min position respected',
    expected: 'accepted size >= $40',
    actual: `${result.status} size=$${result.recommendedPositionSizeUsd}`,
    passed: result.status === 'ACCEPTED' && result.recommendedPositionSizeUsd >= config.minPositionUsd,
  };
}

function testLowRiskRewardRejected(): TestCase {
  const result = calculatePositionSizing({
    ...baseInput,
    targetPrice: 101,
    stopPrice: 99,
  });
  return {
    name: 'low RR trades rejected',
    expected: 'REJECTED',
    actual: `${result.status} rr=${result.riskRewardRatio}`,
    passed: result.status === 'REJECTED',
  };
}

function testRiskFirstTargetsOneDollarRisk(): TestCase {
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config: riskFirstConfig,
  });
  return {
    name: 'risk-first sizing targets about $1 risk when unclamped',
    expected: 'ACCEPTED expectedLoss ~= $1.00 size=$100',
    actual: `${result.status} expectedLoss=$${result.expectedLossUsd} size=$${result.recommendedPositionSizeUsd}`,
    passed: result.status === 'ACCEPTED'
      && Math.abs(result.expectedLossUsd - 1) <= 0.0001
      && Math.abs(result.recommendedPositionSizeUsd - 100) <= 0.0001,
  };
}

function testRiskFirstTargetsFiftyCentRisk(): TestCase {
  const config = {
    ...riskFirstConfig,
    targetProfitMinUsd: 0.50,
    targetProfitMaxUsd: 0.75,
    maxRiskPerTradeUsd: 0.50,
  };
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config,
  });
  return {
    name: 'risk-first sizing supports $0.50 max risk target',
    expected: 'ACCEPTED expectedLoss ~= $0.50 expectedProfit ~= $0.75',
    actual: `${result.status} expectedLoss=$${result.expectedLossUsd} expectedProfit=$${result.expectedProfitUsd} size=$${result.recommendedPositionSizeUsd}`,
    passed: result.status === 'ACCEPTED'
      && Math.abs(result.expectedLossUsd - 0.50) <= 0.0001
      && Math.abs(result.expectedProfitUsd - 0.75) <= 0.0001
      && Math.abs(result.recommendedPositionSizeUsd - 50) <= 0.0001,
  };
}

function testRiskFirstTargetMultipleProfit(): TestCase {
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config: riskFirstConfig,
  });
  return {
    name: 'risk-first 1.5R target produces about $1.50 profit',
    expected: 'expectedProfit ~= $1.50 target=$101.50',
    actual: `${result.status} expectedProfit=$${result.expectedProfitUsd} target=$${result.resolvedTargetPrice}`,
    passed: result.status === 'ACCEPTED'
      && Math.abs(result.expectedProfitUsd - 1.5) <= 0.0001
      && Math.abs(result.resolvedTargetPrice - 101.5) <= 0.0001,
  };
}

function testRiskFirstShortTargetUsesPriceRMultiple(): TestCase {
  const result = calculatePositionSizing({
    ...baseInput,
    signal: 'SELL',
    entryPrice: 100,
    targetPrice: 90,
    stopPrice: 102,
    config: riskFirstConfig,
  });
  return {
    name: 'risk-first short target uses true price R multiple',
    expected: 'SELL entry=100 stop=102 -> target=$97.00 at 1.5R',
    actual: `${result.status} target=$${result.resolvedTargetPrice} rr=${result.riskRewardRatio}`,
    passed: result.status === 'ACCEPTED'
      && Math.abs(result.resolvedTargetPrice - 97) <= 0.0001
      && Math.abs(result.riskRewardRatio - 1.5) <= 0.0001,
  };
}

function testRiskFirstRejectsWhenMaxPositionPreventsProfit(): TestCase {
  const config = { ...riskFirstConfig, maxPositionUsd: 50 };
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config,
  });
  return {
    name: 'risk-first rejects when max position prevents profit target',
    expected: 'REJECTED with "Expected profit < minimum" and position-context fields in reason',
    actual: `${result.status} expectedProfit=$${result.expectedProfitUsd} reason=${result.rejectionReason}`,
    // Phase 7C: rejection reason now includes position + risk + reward
    // context so post-sizing audit can see exactly why the trade was
    // skipped. Assertion follows the new format.
    passed: result.status === 'REJECTED'
      && result.expectedProfitUsd < config.targetProfitMinUsd
      && result.rejectionReason.includes('< minimum')
      && result.rejectionReason.includes('position'),
  };
}

function testRiskFirstRejectsWhenMinPositionExceedsRisk(): TestCase {
  const config = { ...riskFirstConfig, minPositionUsd: 25 };
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 90,
    config,
  });
  return {
    name: 'risk-first rejects when min position causes risk above max',
    expected: 'REJECTED expectedLoss > $1.00',
    actual: `${result.status} expectedLoss=$${result.expectedLossUsd} reason=${result.rejectionReason}`,
    passed: result.status === 'REJECTED'
      && result.expectedLossUsd > config.maxRiskPerTradeUsd
      && result.rejectionReason.includes('Minimum position would exceed max risk'),
  };
}

function testRiskUtilizationWarningOnMaxClamp(): TestCase {
  const config = {
    ...riskFirstConfig,
    targetProfitMinUsd: 0.10,
    targetProfitMaxUsd: 1.50,
    maxPositionUsd: 40,
  };
  const result = calculatePositionSizing({
    ...baseInput,
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 99,
    config,
  });
  return {
    name: 'risk-first warns when max clamp uses under 50% risk',
    expected: 'ACCEPTED riskUtilization < 50% warning=true',
    actual: `${result.status} riskUtilization=${result.riskUtilizationPercent}% warning=${result.riskUtilizationWarning}`,
    passed: result.status === 'ACCEPTED'
      && result.riskUtilizationPercent < 50
      && result.riskUtilizationWarning,
  };
}

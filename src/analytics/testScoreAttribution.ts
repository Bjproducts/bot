import * as fs from 'fs';
import * as path from 'path';
import { TradeCandidate } from '../ict/tradeCandidateTypes';
import { CompletedTrade } from '../journal/types';
import { createScoreAttribution, scoreBreakdownTotal } from './scoreAttribution';
import { createScoreAttributionReport, writeScoreAttributionReports } from './tradeOutcomeAnalytics';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const tmpLogsDir = path.resolve(__dirname, '../../logs/score-attribution-test');
const attribution = createScoreAttribution(candidate());
const completedTrades = trades();

const tests: TestResult[] = [
  testScoreBreakdownSums(),
  testAllComponentsLogged(),
  testCompletedTradesLinked(),
  testAnalyticsGenerated(),
  testProbabilityBucketsGenerated(),
  testReportGeneration(),
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
  console.error(`Score attribution tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Score attribution tests: ${tests.length}/${tests.length} passed`);

function testScoreBreakdownSums(): TestResult {
  const total = scoreBreakdownTotal(attribution.breakdown);
  return {
    name: 'score breakdown sums correctly',
    expected: 'componentTotal equals summed breakdown',
    actual: `componentTotal=${attribution.componentTotal} sum=${total}`,
    passed: attribution.componentTotal === total && attribution.finalScore === 92,
  };
}

function testAllComponentsLogged(): TestResult {
  const keys = Object.keys(attribution.breakdown);
  const expectedKeys = [
    'liquiditySweepScore',
    'displacementScore',
    'mssScore',
    'fvgQualityScore',
    'ifvgBonus',
    'targetFitScore',
    'reactionScore',
    'premiumDiscountScore',
    'sessionScore',
    'confidenceScore',
    'targetReachProbability',
    'reactionTierScore',
    'rrFitScore',
    'scalpTargetFitScore',
    'targetDistancePenalty',
    'zoneFreshnessScore',
  ];
  return {
    name: 'all components logged',
    expected: expectedKeys.join(','),
    actual: keys.join(','),
    passed: expectedKeys.every(key => keys.includes(key)),
  };
}

function testCompletedTradesLinked(): TestResult {
  const report = createScoreAttributionReport(completedTrades);
  return {
    name: 'completed trades linked to attribution',
    expected: '2 outcomes with score breakdown',
    actual: `${report.outcomes.length} outcomes`,
    passed: report.outcomes.length === 2 && report.outcomes.every(outcome => outcome.scoreBreakdown.mssScore > 0),
  };
}

function testAnalyticsGenerated(): TestResult {
  const report = createScoreAttributionReport(completedTrades);
  const mss = report.factors.find(factor => factor.factor === 'MSS');
  return {
    name: 'analytics generated',
    expected: 'MSS has 2 trades and 50% WR',
    actual: `MSS trades=${mss?.trades ?? 0} WR=${mss?.winRate ?? 0}`,
    passed: mss?.trades === 2 && mss.winRate === 50,
  };
}

function testProbabilityBucketsGenerated(): TestResult {
  const report = createScoreAttributionReport(completedTrades);
  const highBucket = report.probabilityBuckets.find(bucket => bucket.bucket === '85-100');
  return {
    name: 'probability buckets generated',
    expected: '85-100 bucket has 2 trades',
    actual: `85-100 trades=${highBucket?.trades ?? 0}`,
    passed: highBucket?.trades === 2,
  };
}

function testReportGeneration(): TestResult {
  if (fs.existsSync(tmpLogsDir)) fs.rmSync(tmpLogsDir, { recursive: true, force: true });
  const report = createScoreAttributionReport(completedTrades);
  const paths = writeScoreAttributionReports(report, tmpLogsDir);
  const passed = fs.existsSync(paths.jsonPath) && fs.existsSync(paths.htmlPath);
  return {
    name: 'report generation',
    expected: 'JSON and HTML reports exist',
    actual: `${fs.existsSync(paths.jsonPath)} ${fs.existsSync(paths.htmlPath)}`,
    passed,
  };
}

function candidate(): TradeCandidate {
  return {
    signal: {
      signal: 'BUY',
      confidence: 100,
      reason: 'BULLISH reaction confirmed',
      sourceZoneType: 'IFVG',
      zoneId: 'fixture-ifvg',
      reactionOutput: 'BUY',
      minConfidence: 75,
      evaluatedAt: new Date().toISOString(),
    },
    zone: {
      id: 'fixture-ifvg',
      type: 'IFVG',
      direction: 'BULLISH',
      high: 102,
      low: 100,
      midpoint: 101,
      createdAt: new Date().toISOString(),
      invalidated: false,
      filled: false,
      flipped: false,
      sourceFvgId: 'fixture-fvg',
      inversionCandleIndex: 12,
    },
    reaction: {
      zoneId: 'fixture-ifvg',
      zoneDirection: 'BULLISH',
      reaction: 'BULLISH_REACTION',
      output: 'BUY',
      confidence: 100,
      currentPrice: 101,
      evaluatedAt: new Date().toISOString(),
      checks: {
        returnToZone: { status: 'PASS', passed: true, detail: '' },
        midpointInteraction: { status: 'PASS', passed: true, detail: '' },
        bodyCloseConfirmation: { status: 'PASS', passed: true, detail: '' },
        volumeConfirmation: { status: 'NOT_EVALUATED', passed: false, detail: '' },
      },
      reasons: [],
      reactionType: 'DISPLACEMENT',
      midpointResult: 'BULLISH',
      boundaryCloseResult: 'BULLISH',
      displacementReaction: 'BULLISH',
      reactionWinner: 'BUY',
      reactionScore: 100,
    },
    signalDirection: 'BUY',
    zoneType: 'IFVG',
    zoneId: 'fixture-ifvg',
    expectedProfitAtTPUsd: 0.75,
    distanceToTPPercent: 0.6,
    distanceToInvalidationPercent: 0.4,
    confidence: 100,
    reason: 'BULLISH reaction confirmed',
    score: 92,
    targetFit: 'PREFERRED_RANGE',
    extendedTarget: false,
    status: 'SELECTED',
    rejectionReason: '',
    reactionConfirmed: true,
    volumeConfirmed: false,
    targetReachProbability: 91,
    expectedTimeToTargetEstimate: 8,
    reactionTierScore: 30,
    displacementScore: 10,
    rrFitScore: 18,
    scalpTargetFitScore: 25,
    zoneFreshnessScore: 15,
    targetDistancePenalty: 7,
    targetSelection: null,
    managedTarget: null,
    stopPrice: 100,
    realExpectedProfitUsd: null,
    realExpectedLossUsd: null,
    realRiskRewardRatio: null,
  };
}

function trades(): CompletedTrade[] {
  const base = {
    symbol: 'BTC',
    side: 'LONG' as const,
    marketDataSource: 'TEST',
    entryTimestamp: '2026-06-02T00:00:00.000Z',
    exitTimestamp: '2026-06-02T00:05:00.000Z',
    entryPrice: 100,
    avgEntryPrice: 100,
    exitPrice: 101,
    dcaCount: 0,
    totalInvestedUsd: 100,
    pnlPct: 1,
    reason: 'MANAGED_TARGET_EXIT' as const,
    tradeDurationMinutes: 5,
    scoreBreakdown: attribution.breakdown,
    scoreFinal: attribution.finalScore,
    targetReachProbability: attribution.breakdown.targetReachProbability,
  };

  return [
    { ...base, id: 'win', realizedPnlUsd: 1 },
    { ...base, id: 'loss', realizedPnlUsd: -1, reason: 'RISK_EXIT' },
  ];
}

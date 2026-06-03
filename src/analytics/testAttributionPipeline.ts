import * as fs from 'fs';
import * as path from 'path';
import { TradeCandidate } from '../ict/tradeCandidateTypes';
import { CompletedTrade, TradeEvent } from '../journal/types';
import { TradeJournal } from '../journal/tradeJournal';
import { PositionState } from '../types';
import { emptyPositionState } from '../state';
import { createScoreAttribution } from './scoreAttribution';
import { createScoreAttributionReport } from './tradeOutcomeAnalytics';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const tmpLogsDir = path.resolve(__dirname, '../../logs/attribution-pipeline-test');
if (fs.existsSync(tmpLogsDir)) fs.rmSync(tmpLogsDir, { recursive: true, force: true });

const candidate = buildCandidate();
const attribution = createScoreAttribution(candidate);

// Stage 1: a freshly opened ICT position carries scoreAttribution in memory.
const openedPosition: PositionState = {
  ...emptyPositionState(),
  id: 'pipeline-test-1',
  side: 'LONG',
  averageEntryPrice: 100,
  activePositionSize: 1,
  totalUsdInvested: 100,
  openedAt: new Date().toISOString(),
  entryZoneId: candidate.zoneId,
  entryZoneType: 'IFVG',
  entryZoneHigh: 102,
  entryZoneLow: 100,
  entryZoneMidpoint: 101,
  entryZoneDirection: 'BULLISH',
  entryZoneRespected: true,
  positionSizeUsd: 100,
  expectedProfitUsd: 0.75,
  expectedLossUsd: 0.5,
  riskRewardRatio: 1.5,
  expectedMovePercent: 0.75,
  selectionScore: candidate.score,
  scoreAttribution: attribution,
};

// Stage 2: simulate state.ts JSON save+load round-trip — the same operation
// performed by saveOpenPositions / loadOpenPositions through fs.
const reloadedPosition: PositionState = {
  ...emptyPositionState(),
  ...JSON.parse(JSON.stringify(openedPosition)),
};

// Stage 3: TradeJournal writes a CompletedTrade carrying scoreBreakdown/scoreFinal.
const journal = new TradeJournal({ logsDir: tmpLogsDir });
const completedTrade: CompletedTrade = {
  id: 'pipeline-test-1',
  symbol: 'BTC',
  side: 'LONG',
  marketDataSource: 'PIPELINE_TEST',
  entryTimestamp: reloadedPosition.openedAt ?? new Date().toISOString(),
  exitTimestamp: new Date().toISOString(),
  entryPrice: reloadedPosition.averageEntryPrice,
  avgEntryPrice: reloadedPosition.averageEntryPrice,
  exitPrice: 101,
  dcaCount: 0,
  totalInvestedUsd: reloadedPosition.totalUsdInvested,
  realizedPnlUsd: 1,
  pnlPct: 1,
  reason: 'MANAGED_TARGET_EXIT',
  tradeDurationMinutes: 5,
  entryZoneId: reloadedPosition.entryZoneId ?? undefined,
  entryZoneType: reloadedPosition.entryZoneType ?? undefined,
  positionSizeUsd: reloadedPosition.positionSizeUsd ?? undefined,
  selectionScore: reloadedPosition.selectionScore ?? undefined,
  scoreBreakdown: reloadedPosition.scoreAttribution?.breakdown,
  scoreFinal: reloadedPosition.scoreAttribution?.finalScore,
};
const closeEvent: TradeEvent = {
  timestamp: completedTrade.exitTimestamp,
  symbol: completedTrade.symbol,
  marketDataSource: completedTrade.marketDataSource,
  action: completedTrade.reason,
  side: completedTrade.side,
  price: completedTrade.exitPrice,
  size: 1,
  investedUsd: completedTrade.totalInvestedUsd,
  avgEntry: completedTrade.avgEntryPrice,
  dcaCount: 0,
  realizedPnlUsd: completedTrade.realizedPnlUsd,
  signalDirection: 'BUY',
  signalSource: 'ICT',
  scoreBreakdown: completedTrade.scoreBreakdown,
  scoreFinal: completedTrade.scoreFinal,
};
journal.logClose(closeEvent, completedTrade);

// Stage 4: re-read the file the journal wrote.
const completedTradesPath = path.join(tmpLogsDir, 'completed-trades.json');
const persistedTrades = JSON.parse(fs.readFileSync(completedTradesPath, 'utf-8')) as CompletedTrade[];

// Stage 5: the attribution report counts the attributed trade.
const report = createScoreAttributionReport(persistedTrades);

const tests: TestResult[] = [
  testEntryHasAttribution(),
  testStateRoundTripPreservesAttribution(),
  testCompletedTradeCarriesAttribution(),
  testReportTotalTradesNonZero(),
  testEveryComponentSurvivesRoundTrip(),
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
  console.error(`Attribution pipeline tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Attribution pipeline tests: ${tests.length}/${tests.length} passed`);

function testEntryHasAttribution(): TestResult {
  const hasAttribution = openedPosition.scoreAttribution !== null;
  const finalScore = openedPosition.scoreAttribution?.finalScore ?? 0;
  return {
    name: 'attribution exists on entry',
    expected: 'position.scoreAttribution is non-null and finalScore matches candidate.score',
    actual: `hasAttribution=${hasAttribution} finalScore=${finalScore}`,
    passed: hasAttribution && finalScore === candidate.score,
  };
}

function testStateRoundTripPreservesAttribution(): TestResult {
  const before = openedPosition.scoreAttribution;
  const after = reloadedPosition.scoreAttribution;
  const sameFinal = before?.finalScore === after?.finalScore;
  const sameKeys = before && after
    ? Object.keys(before.breakdown).every(
      key => before.breakdown[key as keyof typeof before.breakdown]
        === after.breakdown[key as keyof typeof after.breakdown],
    )
    : false;
  return {
    name: 'attribution survives state save/load',
    expected: 'JSON round-trip preserves finalScore and every breakdown component',
    actual: `sameFinal=${sameFinal} sameKeys=${sameKeys}`,
    passed: sameFinal && sameKeys,
  };
}

function testCompletedTradeCarriesAttribution(): TestResult {
  const trade = persistedTrades[0];
  const hasBreakdown = trade?.scoreBreakdown !== undefined;
  const hasFinal = trade?.scoreFinal !== undefined;
  return {
    name: 'attribution copied to completed trade',
    expected: 'completed-trades.json entry has scoreBreakdown and scoreFinal',
    actual: `tradeCount=${persistedTrades.length} hasBreakdown=${hasBreakdown} hasFinal=${hasFinal}`,
    passed: persistedTrades.length === 1 && hasBreakdown && hasFinal,
  };
}

function testReportTotalTradesNonZero(): TestResult {
  return {
    name: 'report totalTrades > 0 when attributed trades exist',
    expected: 'totalTrades === 1',
    actual: `totalTrades=${report.totalTrades}`,
    passed: report.totalTrades === 1,
  };
}

function testEveryComponentSurvivesRoundTrip(): TestResult {
  const trade = persistedTrades[0];
  if (!trade?.scoreBreakdown) {
    return {
      name: 'every score component present after pipeline',
      expected: 'all 10 components present',
      actual: 'scoreBreakdown missing',
      passed: false,
    };
  }
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
  const present = expectedKeys.filter(key => key in trade.scoreBreakdown!);
  return {
    name: 'every score component present after pipeline',
    expected: expectedKeys.join(','),
    actual: present.join(','),
    passed: present.length === expectedKeys.length,
  };
}

function buildCandidate(): TradeCandidate {
  const now = new Date().toISOString();
  return {
    signal: {
      signal: 'BUY',
      confidence: 100,
      reason: 'BULLISH reaction confirmed',
      sourceZoneType: 'IFVG',
      zoneId: 'pipeline-ifvg',
      reactionOutput: 'BUY',
      minConfidence: 75,
      evaluatedAt: now,
    },
    zone: {
      id: 'pipeline-ifvg',
      type: 'IFVG',
      direction: 'BULLISH',
      high: 102,
      low: 100,
      midpoint: 101,
      createdAt: now,
      invalidated: false,
      filled: false,
      flipped: false,
      sourceFvgId: 'pipeline-fvg',
      inversionCandleIndex: 12,
    },
    reaction: {
      zoneId: 'pipeline-ifvg',
      zoneDirection: 'BULLISH',
      reaction: 'BULLISH_REACTION',
      output: 'BUY',
      confidence: 100,
      currentPrice: 101,
      evaluatedAt: now,
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
    zoneId: 'pipeline-ifvg',
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

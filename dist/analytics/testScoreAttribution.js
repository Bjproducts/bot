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
const scoreAttribution_1 = require("./scoreAttribution");
const tradeOutcomeAnalytics_1 = require("./tradeOutcomeAnalytics");
const tmpLogsDir = path.resolve(__dirname, '../../logs/score-attribution-test');
const attribution = (0, scoreAttribution_1.createScoreAttribution)(candidate());
const completedTrades = trades();
const tests = [
    testScoreBreakdownSums(),
    testAllComponentsLogged(),
    testCompletedTradesLinked(),
    testAnalyticsGenerated(),
    testProbabilityBucketsGenerated(),
    testStopAttributionInOutcome(),
    testReportGeneration(),
];
let failures = 0;
for (const test of tests) {
    console.log(`Test: ${test.name}`);
    console.log(`Expected: ${test.expected}`);
    console.log(`Actual:   ${test.actual}`);
    console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
    if (!test.passed)
        failures++;
}
if (failures > 0) {
    console.error(`Score attribution tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Score attribution tests: ${tests.length}/${tests.length} passed`);
function testScoreBreakdownSums() {
    const total = (0, scoreAttribution_1.scoreBreakdownTotal)(attribution.breakdown);
    return {
        name: 'score breakdown sums correctly',
        expected: 'componentTotal equals summed breakdown',
        actual: `componentTotal=${attribution.componentTotal} sum=${total}`,
        passed: attribution.componentTotal === total && attribution.finalScore === 92,
    };
}
function testAllComponentsLogged() {
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
function testCompletedTradesLinked() {
    const report = (0, tradeOutcomeAnalytics_1.createScoreAttributionReport)(completedTrades);
    return {
        name: 'completed trades linked to attribution',
        expected: '2 outcomes with score breakdown',
        actual: `${report.outcomes.length} outcomes`,
        passed: report.outcomes.length === 2 && report.outcomes.every(outcome => outcome.scoreBreakdown.mssScore > 0),
    };
}
function testAnalyticsGenerated() {
    const report = (0, tradeOutcomeAnalytics_1.createScoreAttributionReport)(completedTrades);
    const mss = report.factors.find(factor => factor.factor === 'MSS');
    return {
        name: 'analytics generated',
        expected: 'MSS has 2 trades and 50% WR',
        actual: `MSS trades=${mss?.trades ?? 0} WR=${mss?.winRate ?? 0}`,
        passed: mss?.trades === 2 && mss.winRate === 50,
    };
}
function testProbabilityBucketsGenerated() {
    const report = (0, tradeOutcomeAnalytics_1.createScoreAttributionReport)(completedTrades);
    const highBucket = report.probabilityBuckets.find(bucket => bucket.bucket === '85-100');
    return {
        name: 'probability buckets generated',
        expected: '85-100 bucket has 2 trades',
        actual: `85-100 trades=${highBucket?.trades ?? 0}`,
        passed: highBucket?.trades === 2,
    };
}
function testStopAttributionInOutcome() {
    const report = (0, tradeOutcomeAnalytics_1.createScoreAttributionReport)(trades());
    const outcome = report.outcomes[0];
    const passed = outcome?.entryPrice === 100
        && outcome.stopPrice === 99
        && outcome.riskDistance === 1
        && outcome.zoneSize === 2
        && outcome.stopSource === 'zoneLow';
    return {
        name: 'stop attribution copied to analytics outcome',
        expected: 'entry=100 stop=99 riskDistance=1 zoneSize=2 stopSource=zoneLow',
        actual: outcome
            ? `entry=${outcome.entryPrice} stop=${outcome.stopPrice} risk=${outcome.riskDistance} zone=${outcome.zoneSize} source=${outcome.stopSource}`
            : 'missing outcome',
        passed,
    };
}
function testReportGeneration() {
    if (fs.existsSync(tmpLogsDir))
        fs.rmSync(tmpLogsDir, { recursive: true, force: true });
    const report = (0, tradeOutcomeAnalytics_1.createScoreAttributionReport)(completedTrades);
    const paths = (0, tradeOutcomeAnalytics_1.writeScoreAttributionReports)(report, tmpLogsDir);
    const passed = fs.existsSync(paths.jsonPath) && fs.existsSync(paths.htmlPath);
    return {
        name: 'report generation',
        expected: 'JSON and HTML reports exist',
        actual: `${fs.existsSync(paths.jsonPath)} ${fs.existsSync(paths.htmlPath)}`,
        passed,
    };
}
function candidate() {
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
        entryPrice: 101,
        stopPrice: 100,
        stopSource: 'zoneLow',
        stopModel: 'TIGHT_FVG',
        originalStopPrice: 99,
        tightStopPrice: 100,
        selectedStopPrice: 100,
        stopTightened: true,
        stopTighteningReason: 'fixture tight stop',
        riskDistance: 1,
        zoneSize: 2,
        realExpectedProfitUsd: null,
        realExpectedLossUsd: null,
        realRiskRewardRatio: null,
    };
}
function trades() {
    const base = {
        symbol: 'BTC',
        side: 'LONG',
        marketDataSource: 'TEST',
        entryTimestamp: '2026-06-02T00:00:00.000Z',
        exitTimestamp: '2026-06-02T00:05:00.000Z',
        entryPrice: 100,
        avgEntryPrice: 100,
        exitPrice: 101,
        dcaCount: 0,
        totalInvestedUsd: 100,
        pnlPct: 1,
        reason: 'MANAGED_TARGET_EXIT',
        tradeDurationMinutes: 5,
        scoreBreakdown: attribution.breakdown,
        scoreFinal: attribution.finalScore,
        targetReachProbability: attribution.breakdown.targetReachProbability,
        stopPrice: 99,
        riskDistance: 1,
        zoneSize: 2,
        stopSource: 'zoneLow',
    };
    return [
        { ...base, id: 'win', realizedPnlUsd: 1 },
        { ...base, id: 'loss', realizedPnlUsd: -1, reason: 'RISK_EXIT' },
    ];
}

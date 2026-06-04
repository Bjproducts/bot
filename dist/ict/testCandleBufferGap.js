"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const candleBufferGap_1 = require("./candleBufferGap");
const tests = [
    test1NoResetOnNormalSequence(),
    test2ResetOnLargeGap(),
    test3FvgStateCleared(),
    test4IfvgStateCleared(),
    test5CandidateCacheCleared(),
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
    console.error(`Candle buffer gap tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Candle buffer gap tests: ${tests.length}/${tests.length} passed`);
function test1NoResetOnNormalSequence() {
    // 60s delta on a 1-minute stream → well under 180s threshold.
    const prev = new Date('2026-06-03T11:36:00.000Z');
    const next = new Date('2026-06-03T11:37:00.000Z');
    const result = (0, candleBufferGap_1.detectCandleGap)(prev, next);
    return {
        name: 'no reset on normal sequence (60s delta)',
        expected: `gapDetected=false, gapSeconds=60, threshold=${candleBufferGap_1.DEFAULT_MAX_GAP_SECONDS}`,
        actual: `gapDetected=${result.gapDetected}, gapSeconds=${result.gapSeconds}, threshold=${result.thresholdSeconds}`,
        passed: result.gapDetected === false
            && result.gapSeconds === 60
            && result.thresholdSeconds === candleBufferGap_1.DEFAULT_MAX_GAP_SECONDS,
    };
}
function test2ResetOnLargeGap() {
    // The Phase 5b discovery scenario: 5-hour pause between buffered candles.
    const prev = new Date('2026-06-03T06:40:00.000Z');
    const next = new Date('2026-06-03T11:36:00.000Z');
    const result = (0, candleBufferGap_1.detectCandleGap)(prev, next);
    const expectedGap = (next.getTime() - prev.getTime()) / 1000;
    return {
        name: 'reset on large gap (5h delta)',
        expected: `gapDetected=true, gapSeconds=${expectedGap}, threshold=180`,
        actual: `gapDetected=${result.gapDetected}, gapSeconds=${result.gapSeconds}, threshold=${result.thresholdSeconds}`,
        passed: result.gapDetected === true
            && result.gapSeconds === expectedGap
            && result.thresholdSeconds === 180,
    };
}
function test3FvgStateCleared() {
    const state = buildPopulatedState({ fvgCount: 3, ifvgCount: 0, candidates: 0 });
    const summary = (0, candleBufferGap_1.clearIctStateForGap)(state);
    const fvgRemaining = state.latestIctZones.filter(z => z.type === 'FVG').length;
    return {
        name: 'FVG state cleared on gap reset',
        expected: 'oldFvgCount=3, latestIctZones FVG count=0 after reset',
        actual: `oldFvgCount=${summary.oldFvgCount}, fvgRemaining=${fvgRemaining}, latestIctZones.length=${state.latestIctZones.length}`,
        passed: summary.oldFvgCount === 3
            && fvgRemaining === 0
            && state.latestIctZones.length === 0,
    };
}
function test4IfvgStateCleared() {
    const state = buildPopulatedState({ fvgCount: 1, ifvgCount: 2, candidates: 0 });
    const summary = (0, candleBufferGap_1.clearIctStateForGap)(state);
    const ifvgRemaining = state.latestIctZones.filter(z => z.type === 'IFVG').length;
    return {
        name: 'IFVG state cleared on gap reset',
        expected: 'oldIfvgCount=2, latestIctZones IFVG count=0 after reset',
        actual: `oldIfvgCount=${summary.oldIfvgCount}, ifvgRemaining=${ifvgRemaining}, latestIctZones.length=${state.latestIctZones.length}`,
        passed: summary.oldIfvgCount === 2
            && ifvgRemaining === 0
            && state.latestIctZones.length === 0,
    };
}
function test5CandidateCacheCleared() {
    const state = buildPopulatedState({ fvgCount: 2, ifvgCount: 1, candidates: 4 });
    const oldBufferSize = state.ictCandleBuffer.length;
    const summary = (0, candleBufferGap_1.clearIctStateForGap)(state);
    // After in-place clear, caller is responsible for nulling latestTradeSelection;
    // verify that the summary captured the old candidate count and the buffer/zones
    // are emptied. The candidate cache itself lives on latestTradeSelection.candidates.
    return {
        name: 'candidate cache cleared on gap reset',
        expected: 'oldCandidateCount=4, oldBufferSize captured, buffer+zones emptied',
        actual: `oldCandidateCount=${summary.oldCandidateCount}, oldBufferSize=${summary.oldBufferSize} (was ${oldBufferSize}), bufferAfter=${state.ictCandleBuffer.length}, zonesAfter=${state.latestIctZones.length}`,
        passed: summary.oldCandidateCount === 4
            && summary.oldBufferSize === oldBufferSize
            && state.ictCandleBuffer.length === 0
            && state.latestIctZones.length === 0,
    };
}
function buildPopulatedState(opts) {
    const ictCandleBuffer = [];
    for (let i = 0; i < 10; i++) {
        ictCandleBuffer.push({
            open: 100, high: 101, low: 99, close: 100, volume: 1,
            timestamp: new Date(Date.UTC(2026, 5, 3, 11, 36 + i)),
        });
    }
    const latestIctZones = [];
    for (let i = 0; i < opts.fvgCount; i++) {
        latestIctZones.push(buildFvgZone(`fvg-${i}`));
    }
    for (let i = 0; i < opts.ifvgCount; i++) {
        latestIctZones.push(buildIfvgZone(`ifvg-${i}`));
    }
    const candidates = [];
    for (let i = 0; i < opts.candidates; i++) {
        candidates.push(buildCandidateStub(`cand-${i}`));
    }
    const latestTradeSelection = {
        action: 'NONE',
        selectedCandidate: null,
        candidates,
        candidatesEvaluated: candidates.length,
        rejectionReason: '',
        evaluatedAt: new Date().toISOString(),
    };
    return { ictCandleBuffer, latestIctZones, latestTradeSelection };
}
function buildFvgZone(id) {
    return {
        id, type: 'FVG', direction: 'BULLISH',
        high: 102, low: 100, midpoint: 101,
        createdAt: '2026-06-03T11:36:00.000Z',
        invalidated: false, filled: false, flipped: false,
        candle1Index: 0, candle2Index: 1, candle3Index: 2,
    };
}
function buildIfvgZone(id) {
    return {
        id, type: 'IFVG', direction: 'BEARISH',
        high: 102, low: 100, midpoint: 101,
        createdAt: '2026-06-03T11:38:00.000Z',
        invalidated: false, filled: false, flipped: false,
        sourceFvgId: 'src-fvg', inversionCandleIndex: 5,
    };
}
function buildCandidateStub(id) {
    return {
        signal: {
            signal: 'BUY', confidence: 80, reason: 'stub',
            sourceZoneType: 'FVG', zoneId: id, reactionOutput: 'BUY',
            minConfidence: 75, evaluatedAt: '2026-06-03T11:36:00.000Z',
        },
        zone: buildFvgZone(id),
        signalDirection: 'BUY',
        zoneType: 'FVG', zoneId: id,
        expectedProfitAtTPUsd: 1, distanceToTPPercent: 1, distanceToInvalidationPercent: 1,
        confidence: 80, reason: 'stub', score: 60,
        targetFit: 'PREFERRED_RANGE', extendedTarget: false,
        status: 'QUALIFIED', rejectionReason: '',
        reactionConfirmed: true, volumeConfirmed: false,
        targetReachProbability: 70, expectedTimeToTargetEstimate: 5,
        reactionTierScore: 22, displacementScore: 10, rrFitScore: 20,
        scalpTargetFitScore: 25, zoneFreshnessScore: 10, targetDistancePenalty: 0,
        targetSelection: null, managedTarget: null,
        entryPrice: 101, stopPrice: 100, stopSource: 'zoneLow',
        stopModel: 'TIGHT_FVG',
        originalStopPrice: 99,
        tightStopPrice: 100,
        selectedStopPrice: 100,
        stopTightened: true,
        stopTighteningReason: 'fixture tight stop',
        riskDistance: 1, zoneSize: 2,
        realExpectedProfitUsd: null, realExpectedLossUsd: null, realRiskRewardRatio: null,
    };
}

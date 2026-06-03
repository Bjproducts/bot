"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tradeSelectionEngine_1 = require("./tradeSelectionEngine");
const fixtures = [
    {
        name: 'fresh IFVG formation can be selected immediately',
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        evaluations: [
            evaluation(ifvgZone('fresh-formation-ifvg', 'BULLISH'), 'BUY', 100, true),
        ],
        expected: {
            action: 'BUY',
            selectedZoneId: 'fresh-formation-ifvg',
            expectedProfitAtTPUsd: 0.6,
            targetFit: 'PREFERRED_RANGE',
        },
    },
    {
        name: 'first accepted signal is not always selected',
        evaluations: [
            evaluation(fvgZone('first-fvg', 'BULLISH'), 'BUY', 78, false),
            evaluation(ifvgZone('better-ifvg', 'BULLISH'), 'BUY', 86, true),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        expected: expected('BUY', 'better-ifvg', 0.6, 'PREFERRED_RANGE'),
    },
    {
        name: 'highest score candidate selected',
        evaluations: [
            evaluation(fvgZone('lower-score-fvg', 'BEARISH'), 'SELL', 82, false),
            evaluation(ifvgZone('highest-score-ifvg', 'BEARISH'), 'SELL', 84, true),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        expected: expected('SELL', 'highest-score-ifvg', 0.6, 'PREFERRED_RANGE'),
    },
    {
        name: 'higher targetReachProbability beats higher legacy score',
        evaluations: [
            evaluation(fvgZone('high-probability-fvg', 'BULLISH'), 'BUY', 82, false, {
                reactionType: 'DISPLACEMENT',
                targetSelection: targetSelection(101.5, 'SCALP'),
                stopPrice: 99,
            }),
            evaluation(ifvgZone('higher-score-lower-probability-ifvg', 'BULLISH'), 'BUY', 100, true, {
                reactionType: 'BOUNDARY',
                targetSelection: targetSelection(106, 'STRUCTURE'),
                stopPrice: 99,
            }),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        expected: expected('BUY', 'high-probability-fvg', 0.6, 'EXTENDED_TARGET'),
    },
    {
        name: 'tie uses highest confidence',
        evaluations: [
            evaluation(ifvgZone('same-score-ifvg', 'BULLISH'), 'BUY', 80, true),
            evaluation(fvgZone('higher-confidence-fvg', 'BULLISH'), 'BUY', 100, false),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        expected: expected('BUY', 'higher-confidence-fvg', 0.6, 'PREFERRED_RANGE'),
    },
    {
        name: 'candidate below $0.50 target rejected',
        evaluations: [
            evaluation(fvgZone('small-target-fvg', 'BULLISH'), 'BUY', 90, true),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.004,
        expected: expected('NONE', null),
    },
    {
        name: 'candidate between $0.50-$1.00 preferred',
        evaluations: [
            evaluation(fvgZone('preferred-profit-fvg', 'BULLISH'), 'BUY', 80, true),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.0075,
        expected: expected('BUY', 'preferred-profit-fvg', 0.75, 'PREFERRED_RANGE'),
    },
    {
        name: 'no valid candidate returns NONE',
        evaluations: [
            evaluation(fvgZone('none-fvg', 'BULLISH'), 'NONE', 100, false),
            evaluation(ifvgZone('low-confidence-ifvg', 'BEARISH'), 'SELL', 60, true),
        ],
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        expected: expected('NONE', null),
    },
];
const results = fixtures.map((fixture) => {
    const selection = (0, tradeSelectionEngine_1.selectTradeCandidate)({
        evaluations: fixture.evaluations,
        currentPrice: 100,
        orderSizeUsd: fixture.orderSizeUsd,
        takeProfitPct: fixture.takeProfitPct,
        options: {
            minConfidence: 75,
        },
        evaluatedAt: '2026-06-01T00:10:00.000Z',
    });
    const actual = summarize(selection);
    return {
        name: fixture.name,
        expected: fixture.expected,
        actual,
        passed: stableJson(actual) === stableJson(fixture.expected),
    };
});
results.push(testStopAttributionFields());
for (const result of results) {
    console.log(`Test: ${result.name}`);
    console.log(`Expected: ${stableJson(result.expected)}`);
    console.log(`Actual:   ${stableJson(result.actual)}`);
    console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log('');
}
const failed = results.filter(result => !result.passed);
console.log(`ICT trade selection fixture tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
function summarize(selection) {
    const candidate = selection.selectedCandidate;
    return {
        action: selection.action,
        selectedZoneId: candidate?.zoneId ?? null,
        expectedProfitAtTPUsd: candidate?.expectedProfitAtTPUsd,
        targetFit: candidate?.targetFit,
    };
}
function evaluation(zone, action, confidence, volumeConfirmed, options = {}) {
    return {
        zone,
        signal: signal(zone, action, confidence),
        reaction: reaction(zone, action, confidence, volumeConfirmed, options.reactionType),
        targetSelection: options.targetSelection,
        stopPrice: options.stopPrice,
        stopSource: options.stopSource,
    };
}
function testStopAttributionFields() {
    const selection = (0, tradeSelectionEngine_1.selectTradeCandidate)({
        evaluations: [
            evaluation(fvgZone('stop-attribution-fvg', 'BULLISH'), 'BUY', 90, true, {
                targetSelection: targetSelection(103, 'SCALP'),
                stopPrice: 98,
                stopSource: 'zoneLow',
            }),
        ],
        currentPrice: 100,
        orderSizeUsd: 100,
        takeProfitPct: 0.006,
        options: { minConfidence: 75 },
        evaluatedAt: '2026-06-01T00:10:00.000Z',
    });
    const candidate = selection.selectedCandidate;
    const actual = {
        entryPrice: candidate?.entryPrice,
        stopPrice: candidate?.stopPrice,
        riskDistance: candidate?.riskDistance,
        zoneSize: candidate?.zoneSize,
        stopSource: candidate?.stopSource,
    };
    const expected = {
        entryPrice: 100,
        stopPrice: 98,
        riskDistance: 2,
        zoneSize: 4,
        stopSource: 'zoneLow',
    };
    return {
        name: 'candidate records stop attribution fields',
        expected,
        actual,
        passed: stableJson(actual) === stableJson(expected),
    };
}
function signal(zone, action, confidence) {
    return {
        signal: action,
        confidence,
        reason: action === 'NONE' ? 'Reaction output is NONE' : `Reaction output ${action} met confidence threshold`,
        sourceZoneType: zone.type,
        zoneId: zone.id,
        reactionOutput: action,
        minConfidence: 75,
        evaluatedAt: '2026-06-01T00:09:00.000Z',
    };
}
function reaction(zone, action, confidence, volumeConfirmed, reactionType = action === 'NONE' ? 'NONE' : 'BOUNDARY') {
    return {
        zoneId: zone.id,
        zoneDirection: zone.direction,
        reaction: action === 'BUY'
            ? 'BULLISH_REACTION'
            : action === 'SELL'
                ? 'BEARISH_REACTION'
                : 'NO_REACTION',
        output: action,
        confidence,
        currentPrice: 100,
        evaluatedAt: '2026-06-01T00:09:00.000Z',
        checks: {
            returnToZone: check(action !== 'NONE'),
            midpointInteraction: check(action !== 'NONE'),
            bodyCloseConfirmation: check(action !== 'NONE'),
            volumeConfirmation: {
                status: volumeConfirmed ? 'PASS' : 'NOT_EVALUATED',
                passed: volumeConfirmed,
                detail: volumeConfirmed ? 'Fixture volume confirmed' : 'Volume confirmation disabled',
            },
        },
        reasons: [`Fixture ${action}`],
        reactionType,
        midpointResult: action === 'NONE' ? 'NOT_EVALUATED' : zone.direction,
        boundaryCloseResult: action === 'NONE' ? 'NOT_EVALUATED' : zone.direction,
        displacementReaction: 'NONE',
        reactionWinner: action === 'BUY' || action === 'SELL' ? action : 'NONE',
        reactionScore: confidence,
    };
}
function targetSelection(targetPrice, mode) {
    return {
        exitTargetMode: mode,
        structureTarget: mode === 'STRUCTURE' ? { price: targetPrice, source: 'SWING' } : null,
        scalpTarget: mode === 'SCALP' ? { price: targetPrice, source: 'SCALP_R' } : null,
        selectedTarget: { price: targetPrice, source: mode === 'SCALP' ? 'SCALP_R' : 'SWING' },
        selectedTargetReason: 'Fixture target',
        targetRMultiple: 1.5,
        structureRiskRewardRatio: mode === 'STRUCTURE' ? targetPrice - 100 : null,
        scalpRiskRewardRatio: mode === 'SCALP' ? targetPrice - 100 : null,
    };
}
function check(passed) {
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed ? 'Fixture passed' : 'Fixture failed',
    };
}
function fvgZone(id, direction) {
    return {
        id,
        type: 'FVG',
        direction,
        high: 102,
        low: 98,
        midpoint: 100,
        createdAt: '2026-06-01T00:00:00.000Z',
        invalidated: false,
        filled: false,
        flipped: false,
        candle1Index: 0,
        candle2Index: 1,
        candle3Index: 2,
    };
}
function ifvgZone(id, direction) {
    return {
        id,
        type: 'IFVG',
        direction,
        high: 102,
        low: 98,
        midpoint: 100,
        createdAt: '2026-06-01T00:03:00.000Z',
        invalidated: false,
        filled: false,
        flipped: false,
        sourceFvgId: 'source-fvg',
        inversionCandleIndex: 3,
    };
}
function expected(action, selectedZoneId, expectedProfitAtTPUsd, targetFit) {
    return {
        action,
        selectedZoneId,
        expectedProfitAtTPUsd,
        targetFit,
    };
}
function stableJson(value) {
    return JSON.stringify(value);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ictSignalEngine_1 = require("./ictSignalEngine");
const bullishFvg = fvgZone('signal-fvg-bull', 'BULLISH');
const bearishIfvg = ifvgZone('signal-ifvg-bear', 'BEARISH');
const invalidatedFvg = { ...bullishFvg, id: 'signal-invalidated-fvg', invalidated: true };
const fixtures = [
    {
        name: 'BUY signal above threshold',
        zone: bullishFvg,
        reaction: reaction('signal-fvg-bull', 'BUY', 82),
        expected: expected('BUY', 82, 'FVG', 'signal-fvg-bull', 'BUY', 75),
    },
    {
        name: 'SELL signal above threshold',
        zone: bearishIfvg,
        reaction: reaction('signal-ifvg-bear', 'SELL', 88),
        expected: expected('SELL', 88, 'IFVG', 'signal-ifvg-bear', 'SELL', 75),
    },
    {
        name: 'confidence below threshold returns NONE',
        zone: bullishFvg,
        reaction: reaction('signal-fvg-bull', 'BUY', 74),
        expected: expected('NONE', 74, 'FVG', 'signal-fvg-bull', 'BUY', 75),
    },
    {
        name: 'invalidated zone returns NONE',
        zone: invalidatedFvg,
        reaction: reaction('signal-invalidated-fvg', 'BUY', 95),
        expected: expected('NONE', 0, 'FVG', 'signal-invalidated-fvg', 'BUY', 75),
    },
    {
        name: 'NONE reaction returns NONE',
        zone: bullishFvg,
        reaction: reaction('signal-fvg-bull', 'NONE', 100),
        expected: expected('NONE', 100, 'FVG', 'signal-fvg-bull', 'NONE', 75),
    },
];
const results = fixtures.map(fixture => {
    const actual = summarize((0, ictSignalEngine_1.createIctSignal)({
        zone: fixture.zone,
        reaction: fixture.reaction,
        options: fixture.minConfidence === undefined
            ? undefined
            : { minConfidence: fixture.minConfidence },
    }));
    return {
        name: fixture.name,
        expected: fixture.expected,
        actual,
        passed: stableJson(actual) === stableJson(fixture.expected),
    };
});
for (const result of results) {
    console.log(`Test: ${result.name}`);
    console.log(`Expected: ${stableJson(result.expected)}`);
    console.log(`Actual:   ${stableJson(result.actual)}`);
    console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log('');
}
const failed = results.filter(result => !result.passed);
console.log(`ICT signal fixture tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
function summarize(result) {
    return {
        signal: result.signal,
        confidence: result.confidence,
        sourceZoneType: result.sourceZoneType,
        zoneId: result.zoneId,
        reactionOutput: result.reactionOutput,
        minConfidence: result.minConfidence,
    };
}
function fvgZone(id, direction) {
    return {
        id,
        type: 'FVG',
        direction,
        high: 102,
        low: 100,
        midpoint: 101,
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
        low: 100,
        midpoint: 101,
        createdAt: '2026-06-01T00:03:00.000Z',
        invalidated: false,
        filled: false,
        flipped: false,
        sourceFvgId: 'source-fvg',
        inversionCandleIndex: 3,
    };
}
function reaction(zoneId, output, confidence) {
    const winner = output === 'BUY' || output === 'SELL' ? output : 'NONE';
    const direction = output === 'SELL' ? 'BEARISH' : 'BULLISH';
    return {
        zoneId,
        zoneDirection: direction,
        reaction: output === 'BUY'
            ? 'BULLISH_REACTION'
            : output === 'SELL'
                ? 'BEARISH_REACTION'
                : 'NO_REACTION',
        output,
        confidence,
        currentPrice: 101,
        evaluatedAt: '2026-06-01T00:04:00.000Z',
        checks: {
            returnToZone: check(output !== 'NONE'),
            midpointInteraction: check(output !== 'NONE'),
            bodyCloseConfirmation: check(output !== 'NONE'),
            volumeConfirmation: {
                status: 'NOT_EVALUATED',
                passed: false,
                detail: 'Volume confirmation disabled',
            },
        },
        reasons: [`Fixture reaction ${output}`],
        reactionType: output === 'NONE' ? 'NONE' : 'BOUNDARY',
        midpointResult: output === 'NONE' ? 'NOT_EVALUATED' : direction,
        boundaryCloseResult: output === 'NONE' ? 'NOT_EVALUATED' : direction,
        displacementReaction: 'NONE',
        reactionWinner: winner,
        reactionScore: confidence,
    };
}
function check(passed) {
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed ? 'Fixture passed' : 'Fixture failed',
    };
}
function expected(signal, confidence, sourceZoneType, zoneId, reactionOutput, minConfidence) {
    return {
        signal,
        confidence,
        sourceZoneType,
        zoneId,
        reactionOutput,
        minConfidence,
    };
}
function stableJson(value) {
    return JSON.stringify(value);
}

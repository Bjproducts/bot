"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stopAttribution_1 = require("./stopAttribution");
const candles = [
    c(0, 100, 101, 99, 100.5),
    c(1, 100.5, 104, 100, 103.5),
    c(2, 104, 106, 102, 105),
    c(3, 105, 107, 103, 106),
    c(4, 106, 108, 105, 107),
    c(5, 107, 109, 106, 108),
];
const tests = [
    testBullishFvgUsesFirstCandleLow(),
    testBearishFvgUsesFirstCandleHigh(),
    testBullishIfvgUsesDisplacementOriginAndReducesRisk(),
    testBearishIfvgUsesDisplacementOriginAndReducesRisk(),
    testTightBullishFvgUsesZoneLowWhenCloser(),
    testTightBearishFvgUsesZoneHighWhenCloser(),
    testTightStopFallsBackWhenWrongSide(),
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
    console.error(`Stop attribution tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Stop attribution tests: ${tests.length}/${tests.length} passed`);
function testBullishFvgUsesFirstCandleLow() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bullishFvg(),
        signal: 'BUY',
        entryPrice: 105,
        candles,
    });
    return {
        name: 'bullish FVG stop uses first candle low',
        expected: 'stopPrice=99 stopSource=firstCandleLow',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource}`,
        passed: result.stopPrice === 99 && result.stopSource === 'firstCandleLow',
    };
}
function testBearishFvgUsesFirstCandleHigh() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bearishFvg(),
        signal: 'SELL',
        entryPrice: 100,
        candles,
    });
    return {
        name: 'bearish FVG stop uses first candle high',
        expected: 'stopPrice=108 stopSource=firstCandleHigh',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource}`,
        passed: result.stopPrice === 108 && result.stopSource === 'firstCandleHigh',
    };
}
function testBullishIfvgUsesDisplacementOriginAndReducesRisk() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bullishIfvg(),
        signal: 'BUY',
        entryPrice: 105,
        candles,
    });
    const reduced = result.riskDistance !== null
        && result.zoneBoundaryRiskDistance !== null
        && result.riskDistance < result.zoneBoundaryRiskDistance;
    return {
        name: 'bullish IFVG displacement origin stop reduces risk',
        expected: 'stopPrice=103 stopSource=displacementOrigin riskDistance < zoneBoundaryRiskDistance',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource} risk=${result.riskDistance} oldRisk=${result.zoneBoundaryRiskDistance}`,
        passed: result.stopPrice === 103 && result.stopSource === 'displacementOrigin' && reduced,
    };
}
function testBearishIfvgUsesDisplacementOriginAndReducesRisk() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bearishIfvg(),
        signal: 'SELL',
        entryPrice: 103,
        candles,
    });
    const reduced = result.riskDistance !== null
        && result.zoneBoundaryRiskDistance !== null
        && result.riskDistance < result.zoneBoundaryRiskDistance;
    return {
        name: 'bearish IFVG displacement origin stop reduces risk',
        expected: 'stopPrice=104 stopSource=displacementOrigin riskDistance < zoneBoundaryRiskDistance',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource} risk=${result.riskDistance} oldRisk=${result.zoneBoundaryRiskDistance}`,
        passed: result.stopPrice === 104 && result.stopSource === 'displacementOrigin' && reduced,
    };
}
function testTightBullishFvgUsesZoneLowWhenCloser() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bullishFvg(),
        signal: 'BUY',
        entryPrice: 105,
        candles,
        stopModel: 'TIGHT_FVG',
    });
    return {
        name: 'TIGHT_FVG bullish FVG uses nearer zone low',
        expected: 'stopPrice=101 stopSource=zoneLow stopTightened=true',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource} tightened=${result.stopTightened}`,
        passed: result.stopPrice === 101 && result.stopSource === 'zoneLow' && result.stopTightened,
    };
}
function testTightBearishFvgUsesZoneHighWhenCloser() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bearishFvg(),
        signal: 'SELL',
        entryPrice: 100,
        candles,
        stopModel: 'TIGHT_FVG',
    });
    return {
        name: 'TIGHT_FVG bearish FVG uses nearer zone high',
        expected: 'stopPrice=106 stopSource=zoneHigh stopTightened=true',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource} tightened=${result.stopTightened}`,
        passed: result.stopPrice === 106 && result.stopSource === 'zoneHigh' && result.stopTightened,
    };
}
function testTightStopFallsBackWhenWrongSide() {
    const result = (0, stopAttribution_1.resolveStopAttribution)({
        zone: bullishFvg(),
        signal: 'BUY',
        entryPrice: 100.5,
        candles,
        stopModel: 'TIGHT_FVG',
    });
    return {
        name: 'TIGHT_FVG falls back to origin when tight stop crosses entry',
        expected: 'stopPrice=99 stopSource=firstCandleLow stopTightened=false',
        actual: `stopPrice=${result.stopPrice} stopSource=${result.stopSource} tightened=${result.stopTightened}`,
        passed: result.stopPrice === 99 && result.stopSource === 'firstCandleLow' && !result.stopTightened,
    };
}
function bullishFvg() {
    return {
        id: 'FVG:BULLISH:0:1:2:101:102',
        type: 'FVG',
        direction: 'BULLISH',
        high: 102,
        low: 101,
        midpoint: 101.5,
        createdAt: candles[2].timestamp.toISOString(),
        invalidated: false,
        filled: false,
        flipped: false,
        candle1Index: 0,
        candle2Index: 1,
        candle3Index: 2,
    };
}
function bearishFvg() {
    return {
        id: 'FVG:BEARISH:4:5:6:104:106',
        type: 'FVG',
        direction: 'BEARISH',
        high: 106,
        low: 104,
        midpoint: 105,
        createdAt: candles[5].timestamp.toISOString(),
        invalidated: false,
        filled: false,
        flipped: false,
        candle1Index: 4,
        candle2Index: 5,
        candle3Index: 5,
    };
}
function bullishIfvg() {
    return {
        id: 'IFVG:BULLISH:FVG:BEARISH:0:1:2:99:104:3',
        type: 'IFVG',
        direction: 'BULLISH',
        sourceFvgId: 'FVG:BEARISH:0:1:2:99:104',
        inversionCandleIndex: 3,
        high: 104,
        low: 99,
        midpoint: 101.5,
        createdAt: candles[3].timestamp.toISOString(),
        invalidated: false,
        filled: false,
        flipped: false,
    };
}
function bearishIfvg() {
    return {
        id: 'IFVG:BEARISH:FVG:BULLISH:0:1:2:100:108:1',
        type: 'IFVG',
        direction: 'BEARISH',
        sourceFvgId: 'FVG:BULLISH:0:1:2:100:108',
        inversionCandleIndex: 1,
        high: 108,
        low: 100,
        midpoint: 104,
        createdAt: candles[1].timestamp.toISOString(),
        invalidated: false,
        filled: false,
        flipped: false,
    };
}
function c(minute, open, high, low, close) {
    return {
        timestamp: new Date(Date.UTC(2026, 5, 3, 12, minute, 0)),
        open,
        high,
        low,
        close,
        volume: 100,
    };
}

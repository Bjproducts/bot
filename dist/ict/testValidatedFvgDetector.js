"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validatedFvgDetector_1 = require("./validatedFvgDetector");
const fixtures = [
    {
        name: 'random 3-candle gap is rejected',
        candles: randomThreeCandleGap(),
        targetIndex: 7,
        targetDirection: 'BULLISH',
        expected: {
            foundRawFvg: true,
            accepted: false,
            validatedCount: 0,
            rejectionIncludes: 'liquidity',
            liquiditySweep: 'FAIL',
        },
    },
    {
        name: 'bearish FVG after buy-side sweep is accepted',
        candles: bearishAfterBuySideSweep(),
        targetIndex: 7,
        targetDirection: 'BEARISH',
        expected: {
            foundRawFvg: true,
            accepted: true,
            validatedCount: 1,
            liquiditySweep: 'PASS',
            displacement: 'PASS',
            marketStructureShift: 'PASS',
        },
    },
    {
        name: 'bearish FVG with buy-side wick but no rejection is rejected',
        candles: bearishAfterBuySideWickOnly(),
        targetIndex: 7,
        targetDirection: 'BEARISH',
        expected: {
            foundRawFvg: true,
            accepted: false,
            validatedCount: 0,
            rejectionIncludes: 'reject buy-side',
            liquiditySweep: 'FAIL',
        },
    },
    {
        name: 'bullish FVG after sell-side sweep is accepted',
        candles: bullishAfterSellSideSweep(),
        targetIndex: 7,
        targetDirection: 'BULLISH',
        expected: {
            foundRawFvg: true,
            accepted: true,
            validatedCount: 1,
            liquiditySweep: 'PASS',
            displacement: 'PASS',
            marketStructureShift: 'PASS',
        },
    },
    {
        name: 'bullish FVG with sell-side wick but no rejection is rejected',
        candles: bullishAfterSellSideWickOnly(),
        targetIndex: 7,
        targetDirection: 'BULLISH',
        expected: {
            foundRawFvg: true,
            accepted: false,
            validatedCount: 0,
            rejectionIncludes: 'reject sell-side',
            liquiditySweep: 'FAIL',
        },
    },
    {
        name: 'FVG without displacement is rejected',
        candles: bullishWithoutDisplacement(),
        targetIndex: 7,
        targetDirection: 'BULLISH',
        expected: {
            foundRawFvg: true,
            accepted: false,
            validatedCount: 0,
            rejectionIncludes: 'displacement',
            displacement: 'FAIL',
        },
    },
    {
        name: 'FVG without MSS is rejected',
        candles: bearishWithoutMss(),
        targetIndex: 7,
        targetDirection: 'BEARISH',
        expected: {
            foundRawFvg: true,
            accepted: false,
            validatedCount: 0,
            rejectionIncludes: 'structure',
            marketStructureShift: 'FAIL',
        },
    },
];
const results = fixtures.map(runFixture);
for (const result of results) {
    console.log(`Test: ${result.name}`);
    console.log(`Expected: ${stableJson(result.expected)}`);
    console.log(`Actual:   ${stableJson(result.actual)}`);
    console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log('');
}
const failed = results.filter(result => !result.passed);
console.log(`Validated FVG detector tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
function runFixture(fixture) {
    const validations = (0, validatedFvgDetector_1.validateFVGs)(fixture.candles);
    const validated = (0, validatedFvgDetector_1.detectValidatedFVGs)({ candles: fixture.candles });
    const target = validations.find(result => result.rawFvg.candle3Index === fixture.targetIndex
        && result.rawFvg.direction === fixture.targetDirection);
    const actual = summarize(target, validated.length);
    const passed = matchesExpected(actual, fixture.expected);
    return {
        name: fixture.name,
        expected: fixture.expected,
        actual,
        passed,
    };
}
function summarize(target, validatedCount) {
    if (!target) {
        return {
            foundRawFvg: false,
            accepted: false,
            validatedCount,
        };
    }
    return {
        foundRawFvg: true,
        accepted: target.accepted,
        validatedCount,
        direction: target.rawFvg.direction,
        rejectionReasons: target.validation.rejectionReasons,
        liquiditySweep: target.validation.liquiditySweep.status,
        displacement: target.validation.displacement.status,
        marketStructureShift: target.validation.marketStructureShift.status,
    };
}
function matchesExpected(actual, expected) {
    const value = actual;
    if (value.foundRawFvg !== expected.foundRawFvg)
        return false;
    if (value.accepted !== expected.accepted)
        return false;
    if (value.validatedCount !== expected.validatedCount)
        return false;
    if (expected.liquiditySweep && value.liquiditySweep !== expected.liquiditySweep)
        return false;
    if (expected.displacement && value.displacement !== expected.displacement)
        return false;
    if (expected.marketStructureShift
        && value.marketStructureShift !== expected.marketStructureShift) {
        return false;
    }
    if (expected.rejectionIncludes) {
        const haystack = (value.rejectionReasons ?? []).join(' ').toLowerCase();
        if (!haystack.includes(expected.rejectionIncludes.toLowerCase()))
            return false;
    }
    return true;
}
function randomThreeCandleGap() {
    return [
        c(0, 101, 102, 100, 101),
        c(1, 101.2, 102.5, 100.5, 101.5),
        c(2, 101.4, 103, 100.8, 102),
        c(3, 102, 103.5, 101, 103),
        c(4, 102.5, 104, 101.5, 103.5),
        c(5, 103, 104, 102, 103.5),
        c(6, 103.6, 108, 103, 107.5),
        c(7, 107, 109, 105, 108),
    ];
}
function bearishAfterBuySideSweep() {
    return [
        c(0, 101, 102, 100, 101),
        c(1, 101.2, 102.5, 100.5, 101.5),
        c(2, 101.4, 103, 100.8, 102),
        c(3, 102, 103.5, 101, 103),
        c(4, 102.5, 105, 101.5, 103.5),
        c(5, 105.2, 106.5, 104.4, 104.8),
        c(6, 104.5, 105, 97.5, 98.2),
        c(7, 98.4, 103, 97, 98),
    ];
}
function bearishAfterBuySideWickOnly() {
    return [
        c(0, 101, 102, 100, 101),
        c(1, 101.2, 102.5, 100.5, 101.5),
        c(2, 101.4, 103, 100.8, 102),
        c(3, 102, 103.5, 101, 103),
        c(4, 102.5, 105, 101.5, 103.5),
        c(5, 105.2, 106.5, 104.4, 105.4),
        c(6, 104.5, 105, 97.5, 98.2),
        c(7, 98.4, 103, 97, 98),
    ];
}
function bullishAfterSellSideSweep() {
    return [
        c(0, 102, 104, 100, 102),
        c(1, 102.2, 103.5, 100.5, 101.5),
        c(2, 101.4, 103.8, 100.8, 102),
        c(3, 102, 104, 101, 103),
        c(4, 102.5, 103.8, 99, 102.8),
        c(5, 99.4, 100.5, 98, 99.5),
        c(6, 100.2, 107, 99.5, 106.5),
        c(7, 106.3, 108, 102, 107),
    ];
}
function bullishAfterSellSideWickOnly() {
    return [
        c(0, 102, 104, 100, 102),
        c(1, 102.2, 103.5, 100.5, 101.5),
        c(2, 101.4, 103.8, 100.8, 102),
        c(3, 102, 104, 101, 103),
        c(4, 102.5, 103.8, 99, 102.8),
        c(5, 99.4, 100.5, 98, 98.6),
        c(6, 100.2, 107, 99.5, 106.5),
        c(7, 106.3, 108, 102, 107),
    ];
}
function bullishWithoutDisplacement() {
    return [
        c(0, 102, 104, 100, 102),
        c(1, 102.2, 103.5, 100.5, 101.5),
        c(2, 101.4, 103.8, 100.8, 102),
        c(3, 102, 104, 101, 103),
        c(4, 102.5, 103.8, 101.5, 102.8),
        c(5, 101, 101.5, 99, 100.2),
        c(6, 100.2, 107, 99.5, 100.8),
        c(7, 106.3, 108, 102, 107),
    ];
}
function bearishWithoutMss() {
    return [
        c(0, 101, 102, 100, 101),
        c(1, 101.2, 102.5, 100.5, 101.5),
        c(2, 101.4, 103, 100.8, 102),
        c(3, 102, 103.5, 101, 103),
        c(4, 102.5, 104, 101.5, 103.5),
        c(5, 103.5, 105.5, 104, 104.5),
        c(6, 104.5, 105, 101.5, 102),
        c(7, 102.4, 103, 101, 102.5),
    ];
}
function c(minute, open, high, low, close) {
    return {
        timestamp: new Date(Date.UTC(2026, 5, 1, 14, minute, 0)),
        open,
        high,
        low,
        close,
        volume: 100,
    };
}
function stableJson(value) {
    return JSON.stringify(value);
}

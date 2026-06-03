"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTradableICTFVGs = void 0;
exports.detectValidatedFVGs = detectValidatedFVGs;
exports.validateFVGs = validateFVGs;
exports.validateFVG = validateFVG;
const fvgDetector_1 = require("./fvgDetector");
const DEFAULT_OPTIONS = {
    liquidityLookback: 5,
    marketStructureLookback: 5,
    displacementBodyToRangeMin: 0.6,
    displacementRangeMultiplier: 1.2,
    premiumDiscount: {
        enabled: false,
        lookback: 20,
        requireCorrectContext: false,
    },
    sessionFilter: {
        enabled: false,
        allowedUtcHours: [],
    },
};
function detectValidatedFVGs(input) {
    return validateFVGs(input.candles, input.options)
        .filter(result => result.accepted && result.zone !== null)
        .map(result => result.zone);
}
function validateFVGs(candles, options) {
    const normalized = normalizeOptions(options);
    const rawFvgs = (0, fvgDetector_1.detectFVGs)(candles);
    return rawFvgs.map(rawFvg => validateFVG(rawFvg, candles, normalized));
}
function validateFVG(rawFvg, candles, options = DEFAULT_OPTIONS) {
    const liquiditySweep = evaluateLiquiditySweep(rawFvg, candles, options);
    const displacement = evaluateDisplacement(rawFvg, candles, options);
    const marketStructureShift = evaluateMarketStructureShift(rawFvg, candles, options);
    const premiumDiscount = evaluatePremiumDiscount(rawFvg, candles, options);
    const sessionFilter = evaluateSessionFilter(rawFvg, candles, options);
    const checks = [
        liquiditySweep,
        displacement,
        marketStructureShift,
        premiumDiscount,
        sessionFilter,
    ];
    const rejectionReasons = checks
        .filter(check => !check.passed)
        .map(check => check.detail);
    const accepted = rejectionReasons.length === 0;
    const validation = {
        accepted,
        rawFvgId: rawFvg.id,
        direction: rawFvg.direction,
        liquiditySweep,
        displacement,
        marketStructureShift,
        premiumDiscount,
        sessionFilter,
        rejectionReasons,
    };
    return {
        rawFvg,
        accepted,
        zone: accepted
            ? {
                ...rawFvg,
                validated: true,
                validation,
            }
            : null,
        validation,
    };
}
exports.detectTradableICTFVGs = detectValidatedFVGs;
function evaluateLiquiditySweep(rawFvg, candles, options) {
    const sweepCandle = candles[rawFvg.candle1Index];
    const prior = lookbackCandles(candles, rawFvg.candle1Index, options.liquidityLookback);
    if (!sweepCandle || prior.length === 0) {
        return {
            status: 'FAIL',
            passed: false,
            detail: 'No prior liquidity reference before FVG',
            sweptSide: null,
            sweepCandleIndex: null,
            referenceLevel: null,
            sweepPrice: null,
        };
    }
    if (rawFvg.direction === 'BEARISH') {
        const referenceLevel = maxHigh(prior);
        const sweepPrice = sweepCandle.high;
        const passed = sweepPrice > referenceLevel;
        return {
            status: passed ? 'PASS' : 'FAIL',
            passed,
            detail: passed
                ? 'Buy-side liquidity swept before bearish FVG'
                : 'Bearish FVG did not sweep buy-side liquidity first',
            sweptSide: 'BUY_SIDE',
            sweepCandleIndex: rawFvg.candle1Index,
            referenceLevel,
            sweepPrice,
        };
    }
    const referenceLevel = minLow(prior);
    const sweepPrice = sweepCandle.low;
    const passed = sweepPrice < referenceLevel;
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed
            ? 'Sell-side liquidity swept before bullish FVG'
            : 'Bullish FVG did not sweep sell-side liquidity first',
        sweptSide: 'SELL_SIDE',
        sweepCandleIndex: rawFvg.candle1Index,
        referenceLevel,
        sweepPrice,
    };
}
function evaluateDisplacement(rawFvg, candles, options) {
    const displacementCandle = candles[rawFvg.candle2Index];
    const prior = lookbackCandles(candles, rawFvg.candle2Index, options.liquidityLookback);
    if (!displacementCandle || prior.length === 0) {
        return {
            status: 'FAIL',
            passed: false,
            detail: 'No valid displacement candle context',
            displacementCandleIndex: null,
            bodyToRangePercent: null,
            rangeMultiple: null,
        };
    }
    const range = displacementCandle.high - displacementCandle.low;
    const body = Math.abs(displacementCandle.close - displacementCandle.open);
    const averagePriorRange = average(prior.map(candle => candle.high - candle.low));
    const bodyToRange = range > 0 ? body / range : 0;
    const rangeMultiple = averagePriorRange > 0 ? range / averagePriorRange : 0;
    const directionMatches = rawFvg.direction === 'BULLISH'
        ? displacementCandle.close > displacementCandle.open
        : displacementCandle.close < displacementCandle.open;
    const passed = directionMatches
        && bodyToRange >= options.displacementBodyToRangeMin
        && rangeMultiple >= options.displacementRangeMultiplier;
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed
            ? `Displacement candle confirmed ${rawFvg.direction.toLowerCase()} delivery`
            : `FVG lacks required ${rawFvg.direction.toLowerCase()} displacement`,
        displacementCandleIndex: rawFvg.candle2Index,
        bodyToRangePercent: round(bodyToRange * 100),
        rangeMultiple: round(rangeMultiple),
    };
}
function evaluateMarketStructureShift(rawFvg, candles, options) {
    const mssCandle = candles[rawFvg.candle3Index];
    const prior = lookbackCandles(candles, rawFvg.candle1Index, options.marketStructureLookback);
    if (!mssCandle || prior.length === 0) {
        return {
            status: 'FAIL',
            passed: false,
            detail: 'No prior structure reference before FVG',
            mssCandleIndex: null,
            referenceLevel: null,
            breakPrice: null,
        };
    }
    if (rawFvg.direction === 'BEARISH') {
        const referenceLevel = minLow(prior);
        const breakPrice = mssCandle.close;
        const passed = breakPrice < referenceLevel;
        return {
            status: passed ? 'PASS' : 'FAIL',
            passed,
            detail: passed
                ? 'Bearish market structure shift confirmed by close below prior low'
                : 'Bearish FVG did not close below prior structure low',
            mssCandleIndex: rawFvg.candle3Index,
            referenceLevel,
            breakPrice,
        };
    }
    const referenceLevel = maxHigh(prior);
    const breakPrice = mssCandle.close;
    const passed = breakPrice > referenceLevel;
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed
            ? 'Bullish market structure shift confirmed by close above prior high'
            : 'Bullish FVG did not close above prior structure high',
        mssCandleIndex: rawFvg.candle3Index,
        referenceLevel,
        breakPrice,
    };
}
function evaluatePremiumDiscount(rawFvg, candles, options) {
    if (!options.premiumDiscount.enabled) {
        return {
            status: 'NOT_EVALUATED',
            passed: true,
            detail: 'Premium/discount context disabled',
            context: 'UNKNOWN',
            equilibrium: null,
        };
    }
    const prior = lookbackCandles(candles, rawFvg.candle1Index, options.premiumDiscount.lookback);
    if (prior.length === 0) {
        return {
            status: 'FAIL',
            passed: false,
            detail: 'No dealing range available for premium/discount context',
            context: 'UNKNOWN',
            equilibrium: null,
        };
    }
    const rangeHigh = maxHigh(prior);
    const rangeLow = minLow(prior);
    const equilibrium = (rangeHigh + rangeLow) / 2;
    const context = rawFvg.midpoint > equilibrium
        ? 'PREMIUM'
        : rawFvg.midpoint < equilibrium
            ? 'DISCOUNT'
            : 'EQUILIBRIUM';
    const correctContext = rawFvg.direction === 'BEARISH'
        ? context === 'PREMIUM'
        : context === 'DISCOUNT';
    const passed = !options.premiumDiscount.requireCorrectContext || correctContext;
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed
            ? `Premium/discount context ${context.toLowerCase()} recorded`
            : `FVG is not in required ${rawFvg.direction === 'BEARISH' ? 'premium' : 'discount'} context`,
        context,
        equilibrium: round(equilibrium),
    };
}
function evaluateSessionFilter(rawFvg, candles, options) {
    const createdCandle = candles[rawFvg.candle3Index];
    if (!options.sessionFilter.enabled) {
        return {
            status: 'NOT_EVALUATED',
            passed: true,
            detail: 'Session/time filter disabled',
            sessionHourUtc: createdCandle?.timestamp.getUTCHours() ?? null,
        };
    }
    if (!createdCandle) {
        return {
            status: 'FAIL',
            passed: false,
            detail: 'No FVG creation candle for session/time filter',
            sessionHourUtc: null,
        };
    }
    const hour = createdCandle.timestamp.getUTCHours();
    const passed = options.sessionFilter.allowedUtcHours.includes(hour);
    return {
        status: passed ? 'PASS' : 'FAIL',
        passed,
        detail: passed
            ? `FVG formed during allowed UTC hour ${hour}`
            : `FVG formed outside allowed UTC hours at ${hour}`,
        sessionHourUtc: hour,
    };
}
function normalizeOptions(options) {
    return {
        liquidityLookback: positiveInteger(options?.liquidityLookback, DEFAULT_OPTIONS.liquidityLookback),
        marketStructureLookback: positiveInteger(options?.marketStructureLookback, DEFAULT_OPTIONS.marketStructureLookback),
        displacementBodyToRangeMin: finiteInRange(options?.displacementBodyToRangeMin, DEFAULT_OPTIONS.displacementBodyToRangeMin, 0, 1),
        displacementRangeMultiplier: finiteMin(options?.displacementRangeMultiplier, DEFAULT_OPTIONS.displacementRangeMultiplier, 0),
        premiumDiscount: {
            enabled: options?.premiumDiscount?.enabled ?? DEFAULT_OPTIONS.premiumDiscount.enabled,
            lookback: positiveInteger(options?.premiumDiscount?.lookback, DEFAULT_OPTIONS.premiumDiscount.lookback),
            requireCorrectContext: options?.premiumDiscount?.requireCorrectContext
                ?? DEFAULT_OPTIONS.premiumDiscount.requireCorrectContext,
        },
        sessionFilter: {
            enabled: options?.sessionFilter?.enabled ?? DEFAULT_OPTIONS.sessionFilter.enabled,
            allowedUtcHours: options?.sessionFilter?.allowedUtcHours ?? DEFAULT_OPTIONS.sessionFilter.allowedUtcHours,
        },
    };
}
function lookbackCandles(candles, endIndexExclusive, lookback) {
    return candles
        .slice(Math.max(0, endIndexExclusive - lookback), endIndexExclusive)
        .filter(isValidCandle);
}
function isValidCandle(candle) {
    return Number.isFinite(candle.open)
        && Number.isFinite(candle.high)
        && Number.isFinite(candle.low)
        && Number.isFinite(candle.close)
        && candle.high >= candle.low
        && candle.timestamp instanceof Date
        && !Number.isNaN(candle.timestamp.getTime());
}
function maxHigh(candles) {
    return Math.max(...candles.map(candle => candle.high));
}
function minLow(candles) {
    return Math.min(...candles.map(candle => candle.low));
}
function average(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function positiveInteger(value, fallback) {
    if (!Number.isFinite(value) || value === undefined)
        return fallback;
    return Math.max(1, Math.floor(value));
}
function finiteInRange(value, fallback, min, max) {
    if (!Number.isFinite(value) || value === undefined)
        return fallback;
    return Math.min(max, Math.max(min, value));
}
function finiteMin(value, fallback, min) {
    if (!Number.isFinite(value) || value === undefined)
        return fallback;
    return Math.max(min, value);
}
function round(value) {
    return Math.round(value * 100) / 100;
}

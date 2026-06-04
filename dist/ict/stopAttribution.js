"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStopAttribution = resolveStopAttribution;
function resolveStopAttribution(input) {
    const { zone, signal, entryPrice, candles } = input;
    const stopModel = input.stopModel ?? 'ORIGIN';
    const zoneSize = Math.abs(zone.high - zone.low);
    const zoneBoundaryStopPrice = zoneBoundaryStop(zone, signal);
    const originalStop = originStop(zone, signal, candles) ?? {
        stopPrice: zoneBoundaryStopPrice,
        stopSource: zoneBoundaryStopSource(signal),
    };
    const tightStop = {
        stopPrice: zoneBoundaryStopPrice,
        stopSource: zoneBoundaryStopSource(signal),
    };
    const selected = selectStop({
        signal,
        entryPrice,
        stopModel,
        originalStop,
        tightStop,
    });
    const riskDistance = selected.stopPrice !== null
        ? Math.abs(entryPrice - selected.stopPrice)
        : null;
    const zoneBoundaryRiskDistance = zoneBoundaryStopPrice !== null
        ? Math.abs(entryPrice - zoneBoundaryStopPrice)
        : null;
    return {
        entryPrice,
        stopPrice: selected.stopPrice,
        stopSource: selected.stopSource,
        riskDistance,
        zoneSize,
        zoneBoundaryStopPrice,
        zoneBoundaryRiskDistance,
        stopModel,
        originalStopPrice: originalStop.stopPrice,
        tightStopPrice: tightStop.stopPrice,
        selectedStopPrice: selected.stopPrice,
        stopTightened: selected.stopTightened,
        stopTighteningReason: selected.reason,
    };
}
function selectStop(input) {
    const { signal, entryPrice, stopModel, originalStop, tightStop } = input;
    if (stopModel === 'ORIGIN') {
        return {
            ...originalStop,
            stopTightened: false,
            reason: 'STOP_MODEL=ORIGIN uses original stop source',
        };
    }
    if (!validStopSide(signal, entryPrice, tightStop.stopPrice)) {
        return {
            ...originalStop,
            stopTightened: false,
            reason: 'TIGHT_FVG invalid because tight stop is on wrong side of entry; using original stop',
        };
    }
    if (!validStopSide(signal, entryPrice, originalStop.stopPrice)) {
        return {
            ...tightStop,
            stopTightened: false,
            reason: 'Original stop invalid; using valid TIGHT_FVG boundary stop',
        };
    }
    const tightRisk = Math.abs(entryPrice - tightStop.stopPrice);
    const originalRisk = Math.abs(entryPrice - originalStop.stopPrice);
    if (tightRisk <= originalRisk) {
        return {
            ...tightStop,
            stopTightened: tightRisk < originalRisk,
            reason: tightRisk < originalRisk
                ? 'TIGHT_FVG selected nearer valid FVG/IFVG invalidation boundary'
                : 'TIGHT_FVG boundary equals original stop distance',
        };
    }
    return {
        ...originalStop,
        stopTightened: false,
        reason: 'TIGHT_FVG boundary was farther than original stop; using original stop',
    };
}
function validStopSide(signal, entryPrice, stopPrice) {
    if (stopPrice === null || !Number.isFinite(stopPrice))
        return false;
    if (signal === 'BUY')
        return stopPrice < entryPrice;
    if (signal === 'SELL')
        return stopPrice > entryPrice;
    return false;
}
function originStop(zone, signal, candles) {
    if (signal !== 'BUY' && signal !== 'SELL')
        return null;
    if (zone.type === 'FVG') {
        const firstCandle = candles[zone.candle1Index];
        if (!firstCandle)
            return null;
        return signal === 'BUY'
            ? { stopPrice: firstCandle.low, stopSource: 'firstCandleLow' }
            : { stopPrice: firstCandle.high, stopSource: 'firstCandleHigh' };
    }
    const displacementCandle = candles[zone.inversionCandleIndex];
    if (!displacementCandle)
        return null;
    return signal === 'BUY'
        ? { stopPrice: displacementCandle.low, stopSource: 'displacementOrigin' }
        : { stopPrice: displacementCandle.high, stopSource: 'displacementOrigin' };
}
function zoneBoundaryStop(zone, signal) {
    if (signal === 'BUY')
        return zone.low;
    if (signal === 'SELL')
        return zone.high;
    return null;
}
function zoneBoundaryStopSource(signal) {
    if (signal === 'BUY')
        return 'zoneLow';
    if (signal === 'SELL')
        return 'zoneHigh';
    return null;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePositionExit = evaluatePositionExit;
exports.calculateProgressToTargetPercent = calculateProgressToTargetPercent;
exports.shouldActivateBreakeven = shouldActivateBreakeven;
exports.evaluatePositionLifecycleExit = evaluatePositionLifecycleExit;
exports.evaluateHardStopExit = evaluateHardStopExit;
exports.calculateUnrealizedPnl = calculateUnrealizedPnl;
exports.calculateTakeProfitPrice = calculateTakeProfitPrice;
exports.evaluateEntryZoneDisrespectExit = evaluateEntryZoneDisrespectExit;
function evaluatePositionExit(position, currentPrice, settings, now = new Date()) {
    const unrealizedPnlUsd = calculateUnrealizedPnl(position, currentPrice);
    const takeProfitPrice = calculateTakeProfitPrice(position, settings.takeProfitPct);
    const managedTargetPrice = position.targetPrice;
    const breakevenStopPrice = position.stopAtBreakeven ? position.averageEntryPrice : null;
    const hardStopPrice = position.hardStopEnabled ? position.hardStopPrice : null;
    const positionAgeMinutes = calculatePositionAgeMinutes(position.openedAt, now);
    const reason = closeReason(position, currentPrice, settings, unrealizedPnlUsd, positionAgeMinutes);
    const progressToTargetPercent = calculateProgressToTargetPercent(position, currentPrice);
    return {
        shouldClose: reason !== null,
        reason,
        unrealizedPnlUsd,
        takeProfitPrice,
        managedTargetPrice,
        breakevenStopPrice,
        hardStopPrice,
        quickProfitTargetMinUsd: settings.profitTargetUsdMin,
        quickProfitTargetMaxUsd: settings.profitTargetUsdMax,
        maxLossUsd: settings.maxLossUsd,
        positionAgeMinutes,
        maxPositionMinutes: settings.maxPositionMinutes,
        breakevenActive: position.stopAtBreakeven,
        breakevenTriggerPercent: typeof settings.breakevenTriggerPercent === 'number'
            ? settings.breakevenTriggerPercent
            : 50,
        breakevenActivationPrice: position.breakevenActivationPrice,
        breakevenActivationTime: position.breakevenActivationTime,
        progressToTargetPercent,
    };
}
/**
 * Phase 7D: percentage of the target distance the trade has traversed.
 * Returns null if the trade has no managed target or the math is
 * undefined (entry==target, NONE side, etc.). Negative values mean the
 * trade is currently in drawdown relative to entry.
 */
function calculateProgressToTargetPercent(position, currentPrice) {
    if (position.side === 'NONE')
        return null;
    if (typeof position.targetPrice !== 'number')
        return null;
    const targetDistance = Math.abs(position.targetPrice - position.averageEntryPrice);
    if (targetDistance <= 0)
        return null;
    const move = position.side === 'LONG'
        ? currentPrice - position.averageEntryPrice
        : position.averageEntryPrice - currentPrice;
    return (move / targetDistance) * 100;
}
function shouldActivateBreakeven(position, currentPrice, triggerPercent = 50) {
    if (position.side === 'NONE' || position.stopAtBreakeven)
        return false;
    const progress = calculateProgressToTargetPercent(position, currentPrice);
    return progress !== null && progress >= triggerPercent;
}
function evaluatePositionLifecycleExit(position, currentPrice, candle, settings, now = new Date()) {
    const hardStop = evaluateHardStopExit(position, candle);
    const entryZoneDisrespect = evaluateEntryZoneDisrespectExit(position, candle);
    const positionExit = evaluatePositionExit(position, currentPrice, settings, now);
    const reason = hardStop.reason ?? entryZoneDisrespect.reason ?? positionExit.reason;
    return {
        shouldClose: reason !== null,
        reason,
        hardStop,
        entryZoneDisrespect,
        positionExit,
    };
}
function evaluateHardStopExit(position, candle) {
    if (position.side === 'NONE'
        || !candle
        || !position.hardStopEnabled
        || typeof position.hardStopPrice !== 'number') {
        return noHardStop(position.hardStopPrice);
    }
    if (position.side === 'LONG' && candle.close <= position.hardStopPrice) {
        return hardStopHit(position.hardStopPrice);
    }
    if (position.side === 'SHORT' && candle.close >= position.hardStopPrice) {
        return hardStopHit(position.hardStopPrice);
    }
    return noHardStop(position.hardStopPrice);
}
function calculateUnrealizedPnl(position, currentPrice) {
    if (position.side === 'NONE')
        return 0;
    const positionValue = position.activePositionSize * currentPrice;
    const costBasis = position.activePositionSize * position.averageEntryPrice;
    return position.side === 'LONG'
        ? positionValue - costBasis
        : costBasis - positionValue;
}
function calculateTakeProfitPrice(position, takeProfitPct) {
    if (position.side === 'LONG') {
        return position.averageEntryPrice * (1 + takeProfitPct);
    }
    if (position.side === 'SHORT') {
        return position.averageEntryPrice * (1 - takeProfitPct);
    }
    return 0;
}
function evaluateEntryZoneDisrespectExit(position, candle) {
    if (position.side === 'NONE' || !candle || !position.entryZoneType) {
        return noEntryZoneDisrespect(position.entryZoneRespected);
    }
    const close = candle.close;
    if (position.side === 'SHORT'
        && position.entryZoneDirection === 'BEARISH'
        && typeof position.entryZoneHigh === 'number'
        && close > position.entryZoneHigh) {
        return entryZoneDisrespected(close, 'HIGH');
    }
    if (position.side === 'LONG'
        && position.entryZoneDirection === 'BULLISH'
        && typeof position.entryZoneLow === 'number'
        && close < position.entryZoneLow) {
        return entryZoneDisrespected(close, 'LOW');
    }
    return noEntryZoneDisrespect(true);
}
function closeReason(position, currentPrice, settings, unrealizedPnlUsd, positionAgeMinutes) {
    if (position.side === 'NONE')
        return null;
    if (position.targetPrice !== null) {
        const managedTargetHit = position.side === 'LONG'
            ? currentPrice >= position.targetPrice
            : currentPrice <= position.targetPrice;
        if (managedTargetHit)
            return 'MANAGED_TARGET_EXIT';
    }
    if (position.stopAtBreakeven) {
        const breakevenStopHit = position.side === 'LONG'
            ? currentPrice <= position.averageEntryPrice
            : currentPrice >= position.averageEntryPrice;
        if (breakevenStopHit)
            return 'BREAKEVEN_STOP_EXIT';
    }
    if (unrealizedPnlUsd <= -settings.maxLossUsd) {
        return 'RISK_EXIT';
    }
    // Phase 7D: time-based exits removed. Trades close only via target hit,
    // breakeven stop, hard stop, emergency risk exit, or entry-zone disrespect.
    // Position age is still tracked and surfaced on the evaluation object for
    // diagnostics, but it never triggers an exit.
    void positionAgeMinutes;
    void settings;
    return null;
}
function calculatePositionAgeMinutes(openedAt, now) {
    if (!openedAt)
        return null;
    const opened = new Date(openedAt);
    if (Number.isNaN(opened.getTime()))
        return null;
    return Math.max(0, (now.getTime() - opened.getTime()) / 60_000);
}
function entryZoneDisrespected(disrespectCandleClose, zoneBoundaryViolated) {
    return {
        shouldClose: true,
        reason: 'ENTRY_ZONE_DISRESPECT_EXIT',
        entryZoneRespected: false,
        disrespectCandleClose,
        zoneBoundaryViolated,
    };
}
function hardStopHit(hardStopPrice) {
    return {
        shouldClose: true,
        reason: 'HARD_STOP_EXIT',
        hardStopPrice,
    };
}
function noHardStop(hardStopPrice) {
    return {
        shouldClose: false,
        reason: null,
        hardStopPrice,
    };
}
function noEntryZoneDisrespect(entryZoneRespected) {
    return {
        shouldClose: false,
        reason: null,
        entryZoneRespected,
        disrespectCandleClose: null,
        zoneBoundaryViolated: null,
    };
}

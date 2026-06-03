"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePositionExit = evaluatePositionExit;
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
    };
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
    if (settings.useQuickProfitExit !== false && unrealizedPnlUsd >= settings.profitTargetUsdMin) {
        return 'QUICK_PROFIT_EXIT';
    }
    const takeProfitPrice = calculateTakeProfitPrice(position, settings.takeProfitPct);
    const takeProfitHit = position.side === 'LONG'
        ? currentPrice >= takeProfitPrice
        : currentPrice <= takeProfitPrice;
    if (takeProfitHit)
        return 'TAKE_PROFIT';
    if (unrealizedPnlUsd <= -settings.maxLossUsd) {
        return 'RISK_EXIT';
    }
    if (positionAgeMinutes !== null
        && positionAgeMinutes >= settings.maxPositionMinutes) {
        return 'TIME_EXIT';
    }
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

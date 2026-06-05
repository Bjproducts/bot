"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldActivateDollarBreakeven = shouldActivateDollarBreakeven;
exports.activateDollarBreakeven = activateDollarBreakeven;
exports.planPartialClose = planPartialClose;
exports.applyPartialClose = applyPartialClose;
exports.getActiveStopPrice = getActiveStopPrice;
exports.planOppositeSignalProtection = planOppositeSignalProtection;
const positionExitManager_1 = require("./positionExitManager");
function shouldActivateDollarBreakeven(position, currentPrice, config) {
    if (position.side === 'NONE' || position.stopAtBreakeven)
        return false;
    return (0, positionExitManager_1.calculateUnrealizedPnl)(position, currentPrice) >= config.breakevenTriggerProfitUsd - 1e-9;
}
function activateDollarBreakeven(position, currentPrice, activationTime) {
    const activationIso = activationTime.toISOString();
    return {
        ...position,
        stopAtBreakeven: true,
        stopMovedToBreakevenAt: activationIso,
        breakevenActivationPrice: currentPrice,
        breakevenActivationTime: activationIso,
    };
}
function planPartialClose(position, currentPrice, config) {
    const unrealizedProfitAtClose = (0, positionExitManager_1.calculateUnrealizedPnl)(position, currentPrice);
    if (position.side === 'NONE'
        || !config.partialCloseEnabled
        || position.partialCloseDone
        || unrealizedProfitAtClose < config.partialCloseTriggerProfitUsd - 1e-9
        || unrealizedProfitAtClose <= 0
        || position.activePositionSize <= 0) {
        return noPartialClose(unrealizedProfitAtClose, position.activePositionSize);
    }
    const partialCloseFraction = clamp(config.partialCloseLockProfitUsd / unrealizedProfitAtClose, 0, config.partialCloseMaxFraction ?? 1);
    if (partialCloseFraction <= 0) {
        return noPartialClose(unrealizedProfitAtClose, position.activePositionSize);
    }
    const originalSize = position.activePositionSize;
    const closedSize = originalSize * partialCloseFraction;
    const remainingSize = Math.max(0, originalSize - closedSize);
    const realizedPartialPnlUsd = unrealizedProfitAtClose * partialCloseFraction;
    return {
        shouldClosePartial: true,
        unrealizedProfitAtClose,
        partialCloseFraction,
        originalSize,
        closedSize,
        remainingSize,
        realizedPartialPnlUsd,
    };
}
function applyPartialClose(position, currentPrice, closeTime, plan) {
    if (!plan.shouldClosePartial)
        return position;
    const remainingFraction = 1 - plan.partialCloseFraction;
    const closeTimeIso = closeTime.toISOString();
    return {
        ...position,
        activePositionSize: plan.remainingSize,
        totalUsdInvested: position.totalUsdInvested * remainingFraction,
        positionSizeUsd: position.positionSizeUsd !== null
            ? position.positionSizeUsd * remainingFraction
            : position.positionSizeUsd,
        expectedProfitUsd: position.expectedProfitUsd !== null
            ? position.expectedProfitUsd * remainingFraction
            : position.expectedProfitUsd,
        expectedLossUsd: position.expectedLossUsd !== null
            ? position.expectedLossUsd * remainingFraction
            : position.expectedLossUsd,
        stopAtBreakeven: true,
        stopMovedToBreakevenAt: position.stopMovedToBreakevenAt ?? closeTimeIso,
        breakevenActivationPrice: position.breakevenActivationPrice ?? currentPrice,
        breakevenActivationTime: position.breakevenActivationTime ?? closeTimeIso,
        partialCloseDone: true,
        partialClosePrice: currentPrice,
        partialCloseTime: closeTimeIso,
        partialCloseFraction: plan.partialCloseFraction,
        realizedPartialPnlUsd: position.realizedPartialPnlUsd + plan.realizedPartialPnlUsd,
        remainingSizeAfterPartial: plan.remainingSize,
    };
}
function getActiveStopPrice(position) {
    const breakevenStop = position.stopAtBreakeven ? position.averageEntryPrice : null;
    if (breakevenStop === null)
        return position.hardStopPrice;
    if (position.hardStopPrice === null)
        return breakevenStop;
    if (position.side === 'LONG') {
        return Math.max(breakevenStop, position.hardStopPrice);
    }
    if (position.side === 'SHORT') {
        return Math.min(breakevenStop, position.hardStopPrice);
    }
    return breakevenStop;
}
function planOppositeSignalProtection(position, currentPrice, newSignalSide, maxRiskPerTradeUsd) {
    const unrealizedPnlUsd = (0, positionExitManager_1.calculateUnrealizedPnl)(position, currentPrice);
    const activeStopBefore = getActiveStopPrice(position);
    if (position.side === 'NONE' || position.side === newSignalSide) {
        return noOppositeProtection(unrealizedPnlUsd, activeStopBefore);
    }
    if (unrealizedPnlUsd <= -Math.abs(maxRiskPerTradeUsd)) {
        return {
            action: 'CLOSE_FOR_RISK',
            unrealizedPnlUsd,
            activeStopBefore,
            protectionReason: `Opposite accepted signal while loss exceeded $${Math.abs(maxRiskPerTradeUsd).toFixed(2)} cap`,
        };
    }
    if (unrealizedPnlUsd > 0) {
        return {
            action: 'CLOSE_FOR_PROFIT',
            unrealizedPnlUsd,
            activeStopBefore,
            protectionReason: 'Opposite accepted signal while position was profitable; closing profit before reversal.',
        };
    }
    return {
        action: 'NONE',
        unrealizedPnlUsd,
        activeStopBefore,
        protectionReason: 'Opposite accepted signal but position was not profitable and loss was below cap',
    };
}
function noPartialClose(unrealizedProfitAtClose, size) {
    return {
        shouldClosePartial: false,
        unrealizedProfitAtClose,
        partialCloseFraction: 0,
        originalSize: size,
        closedSize: 0,
        remainingSize: size,
        realizedPartialPnlUsd: 0,
    };
}
function noOppositeProtection(unrealizedPnlUsd, activeStopBefore) {
    return {
        action: 'NONE',
        unrealizedPnlUsd,
        activeStopBefore,
        protectionReason: 'No opposite-side active position',
    };
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

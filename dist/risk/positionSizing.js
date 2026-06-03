"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePositionSizing = calculatePositionSizing;
const DEFAULT_MIN_RISK_REWARD_RATIO = 1.5;
const DEFAULT_TARGET_R_MULTIPLE = 1.5;
const RISK_UTILIZATION_WARNING_THRESHOLD = 50;
function calculatePositionSizing(input) {
    const { signal, confidence, selectionScore, entryPrice, targetPrice, stopPrice, config, } = input;
    const minRiskRewardRatio = Number.isFinite(config.minRiskRewardRatio)
        ? config.minRiskRewardRatio
        : DEFAULT_MIN_RISK_REWARD_RATIO;
    const sizingMode = config.positionSizingMode ?? 'PROFIT_FIRST';
    const targetRMultiple = Number.isFinite(config.targetRMultiple)
        ? config.targetRMultiple
        : DEFAULT_TARGET_R_MULTIPLE;
    const rewardDistance = Math.abs(targetPrice - entryPrice);
    const riskDistance = Math.abs(entryPrice - stopPrice);
    const expectedMovePercent = entryPrice > 0 ? (rewardDistance / entryPrice) * 100 : 0;
    const riskRewardRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    const confidenceMultiplier = confidenceSizeMultiplier(confidence);
    const scoreMultiplier = scoreSizeMultiplier(selectionScore);
    if (!isFinitePositive(entryPrice) || !isFinitePositive(targetPrice) || !isFinitePositive(stopPrice)) {
        return rejected(input, 'Invalid entry, target, or stop price', {
            expectedMovePercent,
            rewardDistance,
            riskDistance,
            riskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode,
            targetRMultiple,
            hardStopPrice: stopPrice,
            resolvedTargetPrice: targetPrice,
        });
    }
    if (rewardDistance <= 0 || riskDistance <= 0) {
        return rejected(input, 'Reward and risk distances must be greater than zero', {
            expectedMovePercent,
            rewardDistance,
            riskDistance,
            riskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode,
            targetRMultiple,
            hardStopPrice: stopPrice,
            resolvedTargetPrice: targetPrice,
        });
    }
    if (sizingMode === 'RISK_FIRST') {
        return calculateRiskFirst(input, {
            minRiskRewardRatio,
            targetRMultiple,
            rewardDistance,
            riskDistance,
            expectedMovePercent,
            confidenceMultiplier,
            scoreMultiplier,
        });
    }
    if (riskRewardRatio < minRiskRewardRatio) {
        return rejected(input, `Risk/reward ${round(riskRewardRatio, 4)} below ${minRiskRewardRatio}`, {
            expectedMovePercent,
            rewardDistance,
            riskDistance,
            riskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode,
            targetRMultiple,
            hardStopPrice: stopPrice,
            resolvedTargetPrice: targetPrice,
        });
    }
    const rewardPct = rewardDistance / entryPrice;
    const riskPct = riskDistance / entryPrice;
    const targetProfitUsd = midpoint(config.targetProfitMinUsd, config.targetProfitMaxUsd);
    const rawSize = (targetProfitUsd / rewardPct) * confidenceMultiplier * scoreMultiplier;
    const riskCappedSize = Math.min(rawSize, config.maxRiskPerTradeUsd / riskPct);
    const boundedSize = clamp(riskCappedSize, config.minPositionUsd, config.maxPositionUsd);
    const expectedProfitUsd = boundedSize * rewardPct;
    const expectedLossUsd = boundedSize * riskPct;
    if (expectedLossUsd > config.maxRiskPerTradeUsd + 0.0001) {
        return rejected(input, 'Minimum position would exceed max risk per trade', {
            expectedMovePercent,
            rewardDistance,
            riskDistance,
            riskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode,
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice: targetPrice,
        });
    }
    // Phase 7C: post-sizing profit-min gate. The selector no longer rejects
    // on expected profit (it used a static $orderSizeUsd reference which
    // under-estimated). Validation now runs against the final sized
    // position so a candidate is only rejected if the sizer truly cannot
    // reach the minimum profit objective.
    if (expectedProfitUsd < config.targetProfitMinUsd) {
        return rejected(input, `Expected profit $${expectedProfitUsd.toFixed(2)} < minimum $${config.targetProfitMinUsd.toFixed(2)} (position $${boundedSize.toFixed(2)}, risk ${riskDistance.toFixed(4)}, reward ${rewardDistance.toFixed(4)})`, {
            expectedMovePercent,
            rewardDistance,
            riskDistance,
            riskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode,
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice: targetPrice,
        });
    }
    const riskUtilizationPercent = riskUtilization(expectedLossUsd, config.maxRiskPerTradeUsd);
    return {
        status: 'ACCEPTED',
        rejectionReason: '',
        signal,
        confidence,
        selectionScore,
        entryPrice,
        targetPrice,
        stopPrice,
        expectedMovePercent: round(expectedMovePercent, 4),
        rewardDistance: round(rewardDistance, 8),
        riskDistance: round(riskDistance, 8),
        riskRewardRatio: round(riskRewardRatio, 4),
        recommendedPositionSizeUsd: roundMoney(boundedSize),
        expectedProfitUsd: roundMoney(expectedProfitUsd),
        expectedLossUsd: roundMoney(expectedLossUsd),
        confidenceMultiplier,
        scoreMultiplier,
        sizingMode,
        targetRMultiple,
        riskUtilizationPercent: round(riskUtilizationPercent, 2),
        riskUtilizationWarning: riskUtilizationPercent < RISK_UTILIZATION_WARNING_THRESHOLD,
        hardStopPrice: stopPrice,
        resolvedTargetPrice: targetPrice,
    };
}
function calculateRiskFirst(input, values) {
    const { signal, entryPrice, stopPrice, config } = input;
    const { minRiskRewardRatio, targetRMultiple, riskDistance, confidenceMultiplier, scoreMultiplier, } = values;
    const riskPct = riskDistance / entryPrice;
    const resolvedTargetPrice = signal === 'BUY'
        ? entryPrice + riskDistance * targetRMultiple
        : entryPrice - riskDistance * targetRMultiple;
    const resolvedRewardDistance = Math.abs(resolvedTargetPrice - entryPrice);
    const resolvedRiskRewardRatio = riskDistance > 0 ? resolvedRewardDistance / riskDistance : 0;
    const resolvedExpectedMovePercent = entryPrice > 0 ? (resolvedRewardDistance / entryPrice) * 100 : 0;
    const rawSize = config.maxRiskPerTradeUsd / riskPct;
    const boundedSize = clamp(rawSize, config.minPositionUsd, config.maxPositionUsd);
    const expectedLossUsd = boundedSize * riskPct;
    const expectedProfitUsd = expectedLossUsd * targetRMultiple;
    const utilization = riskUtilization(expectedLossUsd, config.maxRiskPerTradeUsd);
    if (resolvedRiskRewardRatio < minRiskRewardRatio) {
        return rejected(input, `Risk/reward ${round(resolvedRiskRewardRatio, 4)} below ${minRiskRewardRatio}`, {
            expectedMovePercent: resolvedExpectedMovePercent,
            rewardDistance: resolvedRewardDistance,
            riskDistance,
            riskRewardRatio: resolvedRiskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode: 'RISK_FIRST',
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice,
        });
    }
    if (expectedLossUsd > config.maxRiskPerTradeUsd + 0.0001) {
        return rejected(input, 'Minimum position would exceed max risk per trade', {
            expectedMovePercent: resolvedExpectedMovePercent,
            rewardDistance: resolvedRewardDistance,
            riskDistance,
            riskRewardRatio: resolvedRiskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode: 'RISK_FIRST',
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice,
        });
    }
    if (expectedProfitUsd < config.targetProfitMinUsd) {
        return rejected(input, `Expected profit $${expectedProfitUsd.toFixed(2)} < minimum $${config.targetProfitMinUsd.toFixed(2)} (position $${boundedSize.toFixed(2)}, risk ${riskDistance.toFixed(4)}, reward ${resolvedRewardDistance.toFixed(4)})`, {
            expectedMovePercent: resolvedExpectedMovePercent,
            rewardDistance: resolvedRewardDistance,
            riskDistance,
            riskRewardRatio: resolvedRiskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode: 'RISK_FIRST',
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice,
        });
    }
    if (expectedProfitUsd > config.targetProfitMaxUsd + 0.0001) {
        return rejected(input, `Expected profit above $${config.targetProfitMaxUsd.toFixed(2)}`, {
            expectedMovePercent: resolvedExpectedMovePercent,
            rewardDistance: resolvedRewardDistance,
            riskDistance,
            riskRewardRatio: resolvedRiskRewardRatio,
            confidenceMultiplier,
            scoreMultiplier,
            sizingMode: 'RISK_FIRST',
            targetRMultiple,
            recommendedPositionSizeUsd: boundedSize,
            expectedProfitUsd,
            expectedLossUsd,
            hardStopPrice: stopPrice,
            resolvedTargetPrice,
        });
    }
    return {
        status: 'ACCEPTED',
        rejectionReason: '',
        signal,
        confidence: input.confidence,
        selectionScore: input.selectionScore,
        entryPrice,
        targetPrice: input.targetPrice,
        stopPrice,
        expectedMovePercent: round(resolvedExpectedMovePercent, 4),
        rewardDistance: round(resolvedRewardDistance, 8),
        riskDistance: round(riskDistance, 8),
        riskRewardRatio: round(resolvedRiskRewardRatio, 4),
        recommendedPositionSizeUsd: roundMoney(boundedSize),
        expectedProfitUsd: roundMoney(expectedProfitUsd),
        expectedLossUsd: roundMoney(expectedLossUsd),
        confidenceMultiplier,
        scoreMultiplier,
        sizingMode: 'RISK_FIRST',
        targetRMultiple,
        riskUtilizationPercent: round(utilization, 2),
        riskUtilizationWarning: utilization < RISK_UTILIZATION_WARNING_THRESHOLD,
        hardStopPrice: stopPrice,
        resolvedTargetPrice,
    };
}
function confidenceSizeMultiplier(confidence) {
    if (confidence >= 95)
        return 1.15;
    if (confidence >= 85)
        return 1.00;
    if (confidence < 80)
        return 0.75;
    return 0.90;
}
function scoreSizeMultiplier(score) {
    if (score >= 90)
        return 1.10;
    if (score >= 80)
        return 1.00;
    if (score < 70)
        return 0.85;
    return 0.95;
}
function rejected(input, reason, values) {
    const sizingMode = values.sizingMode ?? input.config.positionSizingMode ?? 'PROFIT_FIRST';
    const targetRMultiple = values.targetRMultiple
        ?? input.config.targetRMultiple
        ?? DEFAULT_TARGET_R_MULTIPLE;
    const expectedLossUsd = values.expectedLossUsd ?? 0;
    const utilization = riskUtilization(expectedLossUsd, input.config.maxRiskPerTradeUsd);
    return {
        status: 'REJECTED',
        rejectionReason: reason,
        signal: input.signal,
        confidence: input.confidence,
        selectionScore: input.selectionScore,
        entryPrice: input.entryPrice,
        targetPrice: input.targetPrice,
        stopPrice: input.stopPrice,
        expectedMovePercent: round(values.expectedMovePercent, 4),
        rewardDistance: round(values.rewardDistance, 8),
        riskDistance: round(values.riskDistance, 8),
        riskRewardRatio: round(values.riskRewardRatio, 4),
        recommendedPositionSizeUsd: roundMoney(values.recommendedPositionSizeUsd ?? 0),
        expectedProfitUsd: roundMoney(values.expectedProfitUsd ?? 0),
        expectedLossUsd: roundMoney(expectedLossUsd),
        confidenceMultiplier: values.confidenceMultiplier,
        scoreMultiplier: values.scoreMultiplier,
        sizingMode,
        targetRMultiple,
        riskUtilizationPercent: round(utilization, 2),
        riskUtilizationWarning: utilization < RISK_UTILIZATION_WARNING_THRESHOLD,
        hardStopPrice: values.hardStopPrice ?? input.stopPrice,
        resolvedTargetPrice: values.resolvedTargetPrice ?? input.targetPrice,
    };
}
function midpoint(min, max) {
    return (min + max) / 2;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function isFinitePositive(value) {
    return Number.isFinite(value) && value > 0;
}
function roundMoney(value) {
    return round(value, 4);
}
function riskUtilization(expectedLossUsd, maxRiskPerTradeUsd) {
    if (!Number.isFinite(expectedLossUsd) || !Number.isFinite(maxRiskPerTradeUsd) || maxRiskPerTradeUsd <= 0) {
        return 0;
    }
    return (expectedLossUsd / maxRiskPerTradeUsd) * 100;
}
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

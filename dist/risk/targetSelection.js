"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectManagedTarget = selectManagedTarget;
exports.findStructureTarget = findStructureTarget;
exports.findOpposingZoneTarget = findOpposingZoneTarget;
exports.findScalpTarget = findScalpTarget;
function selectManagedTarget(input) {
    const { side, entryPrice, stopPrice, opposingZones, swingTargetPrice, config } = input;
    const mode = config.exitTargetMode;
    const targetRMultiple = config.targetRMultiple;
    const structureTarget = findStructureTarget(side, entryPrice, opposingZones, swingTargetPrice);
    const structureRR = computeRiskReward(structureTarget?.price ?? null, entryPrice, stopPrice);
    if (mode === 'STRUCTURE') {
        return {
            exitTargetMode: mode,
            structureTarget,
            scalpTarget: null,
            selectedTarget: structureTarget,
            selectedTargetReason: structureTarget
                ? `STRUCTURE mode using ${structureTarget.source}`
                : 'STRUCTURE mode: no structure target available',
            targetRMultiple,
            structureRiskRewardRatio: structureRR,
            scalpRiskRewardRatio: null,
        };
    }
    const scalpTarget = findScalpTarget(side, entryPrice, stopPrice, targetRMultiple);
    const scalpRR = computeRiskReward(scalpTarget?.price ?? null, entryPrice, stopPrice);
    if (mode === 'SCALP') {
        return {
            exitTargetMode: mode,
            structureTarget: null,
            scalpTarget,
            selectedTarget: scalpTarget,
            selectedTargetReason: scalpTarget
                ? `SCALP mode using ${targetRMultiple.toFixed(2)}R target`
                : 'SCALP mode: invalid entry/stop prices for R-multiple target',
            targetRMultiple,
            structureRiskRewardRatio: null,
            scalpRiskRewardRatio: scalpRR,
        };
    }
    // HYBRID: prefer the closer of the two targets, but only if it still
    // satisfies the RR floor (structure) or has been computed (scalp).
    const structureValid = structureTarget !== null
        && structureRR !== null
        && structureRR >= config.minRiskRewardRatio
        && structureWithinMaxDistance(structureTarget, entryPrice, config.maxTargetDistancePercent);
    if (!structureTarget && !scalpTarget) {
        return summarize(mode, null, null, null, 'HYBRID mode: no targets available', targetRMultiple, structureRR, scalpRR);
    }
    if (!scalpTarget) {
        return summarize(mode, structureTarget, null, structureValid ? structureTarget : null, structureValid
            ? `HYBRID mode: scalp unavailable, using structure ${structureTarget.source}`
            : 'HYBRID mode: scalp unavailable and structure fails RR / distance gate', targetRMultiple, structureRR, scalpRR);
    }
    if (!structureTarget) {
        return summarize(mode, null, scalpTarget, scalpTarget, `HYBRID mode: no structure target, using scalp ${targetRMultiple.toFixed(2)}R`, targetRMultiple, structureRR, scalpRR);
    }
    if (!structureValid) {
        const tooFar = !structureWithinMaxDistance(structureTarget, entryPrice, config.maxTargetDistancePercent);
        const reason = tooFar
            ? `HYBRID mode: structure ${structureTarget.source} beyond ${config.maxTargetDistancePercent}% max distance, using scalp`
            : `HYBRID mode: structure RR ${(structureRR ?? 0).toFixed(2)} below ${config.minRiskRewardRatio}, using scalp`;
        return summarize(mode, structureTarget, scalpTarget, scalpTarget, reason, targetRMultiple, structureRR, scalpRR);
    }
    const structureDistance = Math.abs(structureTarget.price - entryPrice);
    const scalpDistance = Math.abs(scalpTarget.price - entryPrice);
    if (structureDistance <= scalpDistance) {
        return summarize(mode, structureTarget, scalpTarget, structureTarget, `HYBRID mode: structure ${structureTarget.source} closer than scalp (RR ${structureRR.toFixed(2)})`, targetRMultiple, structureRR, scalpRR);
    }
    return summarize(mode, structureTarget, scalpTarget, scalpTarget, `HYBRID mode: scalp ${targetRMultiple.toFixed(2)}R closer than structure`, targetRMultiple, structureRR, scalpRR);
}
function findStructureTarget(side, entryPrice, opposingZones, swingTargetPrice) {
    const opposing = findOpposingZoneTarget(side, entryPrice, opposingZones);
    if (opposing)
        return opposing;
    if (swingTargetPrice === null || !Number.isFinite(swingTargetPrice))
        return null;
    // Swing target must be in profit direction.
    if (side === 'LONG' && swingTargetPrice <= entryPrice)
        return null;
    if (side === 'SHORT' && swingTargetPrice >= entryPrice)
        return null;
    return { price: swingTargetPrice, source: 'SWING' };
}
function findOpposingZoneTarget(side, entryPrice, opposingZones) {
    let selected = null;
    for (const zone of opposingZones) {
        if (zone.invalidated)
            continue;
        if (side === 'LONG' && zone.direction === 'BEARISH' && zone.low > entryPrice) {
            if (!selected || zone.low < selected.price) {
                selected = { price: zone.low, source: 'OPPOSING_FVG', zone };
            }
        }
        if (side === 'SHORT' && zone.direction === 'BULLISH' && zone.high < entryPrice) {
            if (!selected || zone.high > selected.price) {
                selected = { price: zone.high, source: 'OPPOSING_FVG', zone };
            }
        }
    }
    return selected;
}
function findScalpTarget(side, entryPrice, stopPrice, targetRMultiple) {
    if (!isFinitePositive(entryPrice) || !isFinitePositive(stopPrice))
        return null;
    if (!Number.isFinite(targetRMultiple) || targetRMultiple <= 0)
        return null;
    const riskDistance = Math.abs(entryPrice - stopPrice);
    if (riskDistance <= 0)
        return null;
    const rewardDistance = riskDistance * targetRMultiple;
    const price = side === 'LONG' ? entryPrice + rewardDistance : entryPrice - rewardDistance;
    return { price, source: 'SCALP_R' };
}
function computeRiskReward(targetPrice, entryPrice, stopPrice) {
    if (targetPrice === null)
        return null;
    if (!isFinitePositive(entryPrice) || !isFinitePositive(stopPrice))
        return null;
    const reward = Math.abs(targetPrice - entryPrice);
    const risk = Math.abs(entryPrice - stopPrice);
    if (risk <= 0)
        return null;
    return reward / risk;
}
function structureWithinMaxDistance(target, entryPrice, maxPercent) {
    if (maxPercent <= 0)
        return true;
    if (!isFinitePositive(entryPrice))
        return true;
    const distancePct = (Math.abs(target.price - entryPrice) / entryPrice) * 100;
    return distancePct <= maxPercent;
}
function summarize(mode, structureTarget, scalpTarget, selectedTarget, reason, targetRMultiple, structureRR, scalpRR) {
    return {
        exitTargetMode: mode,
        structureTarget,
        scalpTarget,
        selectedTarget,
        selectedTargetReason: reason,
        targetRMultiple,
        structureRiskRewardRatio: structureRR,
        scalpRiskRewardRatio: scalpRR,
    };
}
function isFinitePositive(value) {
    return Number.isFinite(value) && value > 0;
}

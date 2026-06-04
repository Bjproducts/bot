"use strict";
// =====================================================================
// Phase 8D — directional exposure manager
//
// Pure helpers that decide:
//   1. Current directional exposure across active positions.
//   2. What to do when a new opposite-direction signal arrives
//      (protect, close, or block).
//   3. What to do on every tick to clean up mixed exposure that
//      somehow exists (unprotected losing positions get closed).
//
// This module is intentionally side-effect-free. The bot uses the
// returned plans to drive its actual close / stop-arming workflow.
// =====================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD = void 0;
exports.assessDirectionalExposure = assessDirectionalExposure;
exports.evaluateOppositeSignalProtection = evaluateOppositeSignalProtection;
exports.evaluateMixedExposureCleanup = evaluateMixedExposureCleanup;
exports.classifyPositionExposureFlags = classifyPositionExposureFlags;
exports.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD = 0.30;
/**
 * Determine the directional state of the currently-active positions.
 */
function assessDirectionalExposure(positions) {
    let hasLong = false;
    let hasShort = false;
    for (const p of positions) {
        if (p.side === 'LONG')
            hasLong = true;
        else if (p.side === 'SHORT')
            hasShort = true;
    }
    if (hasLong && hasShort)
        return 'MIXED';
    if (hasLong)
        return 'LONG';
    if (hasShort)
        return 'SHORT';
    return 'NONE';
}
/**
 * Decide what to do when an opposite-direction signal arrives.
 *
 * Rules (Phase 8D §B):
 *   - profitable opposite (pnl >= 0) and not BE-armed -> move to BE
 *   - losing opposite (pnl <= -maxLoss) -> close with
 *     OPPOSITE_SIGNAL_RISK_EXIT
 *   - small-loss opposite (between 0 and -maxLoss) -> wait
 *   - in all cases: block the new opposite entry while any opposite
 *     position remains open
 */
function evaluateOppositeSignalProtection(positions, newSignalSide, opts = {}) {
    const maxLoss = opts.oppositeMaxLossUsd ?? exports.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
    const existingOpposite = positions.filter(p => p.side !== newSignalSide);
    const positionsToProtect = [];
    const positionsToClose = [];
    const positionsWaiting = [];
    for (const p of existingOpposite) {
        if (p.unrealizedPnlUsd >= 0) {
            if (!p.stopAtBreakeven)
                positionsToProtect.push(p);
            // already BE-protected positions are left alone
        }
        else if (p.unrealizedPnlUsd <= -maxLoss) {
            positionsToClose.push(p);
        }
        else {
            positionsWaiting.push(p);
        }
    }
    const blockNewEntry = existingOpposite.length > 0;
    const blockReason = blockNewEntry
        ? `Opposite exposure active: ${existingOpposite.length} ${existingOpposite[0].side} position(s) ` +
            `[${existingOpposite.map(p => `${p.id}@${p.unrealizedPnlUsd.toFixed(2)}`).join(', ')}]`
        : '';
    return {
        blockNewEntry,
        blockReason,
        positionsToProtect,
        positionsToClose,
        positionsWaiting,
        newSignalSide,
        existingOpposite,
    };
}
/**
 * Every-tick mixed-exposure cleanup. If both LONG and SHORT positions
 * are open simultaneously, close any unprotected position that is
 * losing more than maxLoss. Protected positions (BE-armed) and
 * BE-protected partial runners are left alone.
 */
function evaluateMixedExposureCleanup(positions, opts = {}) {
    const maxLoss = opts.oppositeMaxLossUsd ?? exports.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
    const exposure = assessDirectionalExposure(positions);
    if (exposure !== 'MIXED') {
        return { positionsToClose: [], mixedExposureActive: false };
    }
    const positionsToClose = [];
    for (const p of positions) {
        // Protected positions stay. A partial-runner that is also BE-armed
        // is "protected" in the same sense.
        if (p.stopAtBreakeven)
            continue;
        if (p.unrealizedPnlUsd <= -maxLoss) {
            positionsToClose.push(p);
        }
    }
    return { positionsToClose, mixedExposureActive: true };
}
function classifyPositionExposureFlags(position, positions, opts = {}) {
    const maxLoss = opts.oppositeMaxLossUsd ?? exports.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
    const exposure = assessDirectionalExposure(positions);
    const isMixed = exposure === 'MIXED';
    return {
        protected: position.stopAtBreakeven,
        oppositeRiskExitEligible: position.unrealizedPnlUsd <= -maxLoss && !position.stopAtBreakeven,
        mixedExposureRisk: isMixed && !position.stopAtBreakeven && position.unrealizedPnlUsd <= -maxLoss,
    };
}

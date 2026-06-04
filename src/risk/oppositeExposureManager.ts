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

export type DirectionalSide = 'LONG' | 'SHORT';
export type DirectionalExposure = 'LONG' | 'SHORT' | 'MIXED' | 'NONE';

export interface PositionSnapshot {
  id: string;
  side: DirectionalSide;
  unrealizedPnlUsd: number;
  stopAtBreakeven: boolean;
  averageEntryPrice: number;
  /** Phase 8D: set when a partial close has already happened on this position. */
  partialClosed?: boolean;
}

export interface OppositeSignalEvaluation {
  /** True if the bot must NOT open the new opposite trade right now. */
  blockNewEntry: boolean;
  /** Human-readable reason for ENTRY_SKIP_OPPOSITE_EXPOSURE. */
  blockReason: string;
  /** Positions that are profitable and should be moved to breakeven. */
  positionsToProtect: PositionSnapshot[];
  /** Positions losing >= maxLoss that should be closed immediately
   *  with reason OPPOSITE_SIGNAL_RISK_EXIT. */
  positionsToClose: PositionSnapshot[];
  /** Positions losing but above the cutoff — kept open until they either
   *  improve to BE or get worse than maxLoss. The new opposite trade
   *  stays blocked while any of these remain. */
  positionsWaiting: PositionSnapshot[];
  /** Direction of the new signal that triggered this evaluation. */
  newSignalSide: DirectionalSide;
  /** Snapshot of every existing opposite-side position (intent: log). */
  existingOpposite: PositionSnapshot[];
}

export interface MixedExposureCleanup {
  /** Positions to close with reason MIXED_EXPOSURE_RISK_EXIT. */
  positionsToClose: PositionSnapshot[];
  /** Whether mixed exposure was detected this tick. */
  mixedExposureActive: boolean;
}

export const DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD = 0.30;

/**
 * Determine the directional state of the currently-active positions.
 */
export function assessDirectionalExposure(
  positions: readonly PositionSnapshot[],
): DirectionalExposure {
  let hasLong = false;
  let hasShort = false;
  for (const p of positions) {
    if (p.side === 'LONG') hasLong = true;
    else if (p.side === 'SHORT') hasShort = true;
  }
  if (hasLong && hasShort) return 'MIXED';
  if (hasLong) return 'LONG';
  if (hasShort) return 'SHORT';
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
export function evaluateOppositeSignalProtection(
  positions: readonly PositionSnapshot[],
  newSignalSide: DirectionalSide,
  opts: { oppositeMaxLossUsd?: number } = {},
): OppositeSignalEvaluation {
  const maxLoss = opts.oppositeMaxLossUsd ?? DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
  const existingOpposite = positions.filter(p => p.side !== newSignalSide);

  const positionsToProtect: PositionSnapshot[] = [];
  const positionsToClose: PositionSnapshot[] = [];
  const positionsWaiting: PositionSnapshot[] = [];

  for (const p of existingOpposite) {
    if (p.unrealizedPnlUsd >= 0) {
      if (!p.stopAtBreakeven) positionsToProtect.push(p);
      // already BE-protected positions are left alone
    } else if (p.unrealizedPnlUsd <= -maxLoss) {
      positionsToClose.push(p);
    } else {
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
export function evaluateMixedExposureCleanup(
  positions: readonly PositionSnapshot[],
  opts: { oppositeMaxLossUsd?: number } = {},
): MixedExposureCleanup {
  const maxLoss = opts.oppositeMaxLossUsd ?? DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
  const exposure = assessDirectionalExposure(positions);
  if (exposure !== 'MIXED') {
    return { positionsToClose: [], mixedExposureActive: false };
  }

  const positionsToClose: PositionSnapshot[] = [];
  for (const p of positions) {
    // Protected positions stay. A partial-runner that is also BE-armed
    // is "protected" in the same sense.
    if (p.stopAtBreakeven) continue;
    if (p.unrealizedPnlUsd <= -maxLoss) {
      positionsToClose.push(p);
    }
  }

  return { positionsToClose, mixedExposureActive: true };
}

/**
 * Convenience helper for dashboard rendering: explain a single
 * position's status in the directional-exposure machinery.
 */
export interface PositionExposureFlags {
  protected: boolean;
  oppositeRiskExitEligible: boolean;
  mixedExposureRisk: boolean;
}

export function classifyPositionExposureFlags(
  position: PositionSnapshot,
  positions: readonly PositionSnapshot[],
  opts: { oppositeMaxLossUsd?: number } = {},
): PositionExposureFlags {
  const maxLoss = opts.oppositeMaxLossUsd ?? DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
  const exposure = assessDirectionalExposure(positions);
  const isMixed = exposure === 'MIXED';
  return {
    protected: position.stopAtBreakeven,
    oppositeRiskExitEligible: position.unrealizedPnlUsd <= -maxLoss && !position.stopAtBreakeven,
    mixedExposureRisk: isMixed && !position.stopAtBreakeven && position.unrealizedPnlUsd <= -maxLoss,
  };
}

export type RecentSignalSide = 'BUY' | 'SELL';

export interface RecentSignalWatchState {
  recentOppositeSignalSide: RecentSignalSide | null;
  recentOppositeSignalTimestamp: string | null;
  recentOppositeSignalZoneId: string | null;
  recentOppositeSignalConfidence: number | null;
  recentOppositeSignalReason: string | null;
  recentOppositeSignalExpiresAt: string | null;
  recentOppositeSignalCreatedTick: number | null;
  recentOppositeSignalValid: boolean | null;
}

export interface RecentSignalCandidateSnapshot {
  zoneId: string;
  signalDirection: 'BUY' | 'SELL' | 'NONE';
  status: 'SELECTED' | 'QUALIFIED' | 'REJECTED';
}

export function createRecentSignalWatch(input: {
  side: RecentSignalSide;
  zoneId: string;
  confidence: number;
  reason: string;
  currentTick: number;
  ttlCandles: number;
  now: Date;
  tickIntervalMs: number;
}): RecentSignalWatchState {
  const expiresAt = new Date(input.now.getTime() + input.ttlCandles * input.tickIntervalMs);
  return {
    recentOppositeSignalSide: input.side,
    recentOppositeSignalTimestamp: input.now.toISOString(),
    recentOppositeSignalZoneId: input.zoneId,
    recentOppositeSignalConfidence: input.confidence,
    recentOppositeSignalReason: input.reason,
    recentOppositeSignalExpiresAt: expiresAt.toISOString(),
    recentOppositeSignalCreatedTick: input.currentTick,
    recentOppositeSignalValid: true,
  };
}

export function evaluateRecentSignalWatch(input: {
  state: RecentSignalWatchState;
  candidates: readonly RecentSignalCandidateSnapshot[];
  currentTick: number;
  ttlCandles: number;
}): { state: RecentSignalWatchState; expired: boolean; ageCandles: number; valid: boolean } {
  const side = input.state.recentOppositeSignalSide;
  const zoneId = input.state.recentOppositeSignalZoneId;
  if (!side || !zoneId) {
    return { state: input.state, expired: false, ageCandles: 0, valid: false };
  }

  const createdTick = input.state.recentOppositeSignalCreatedTick ?? input.currentTick;
  const ageCandles = Math.max(0, input.currentTick - createdTick);
  const expiredByAge = ageCandles >= input.ttlCandles;
  const candidateStillValid = input.candidates.some(candidate =>
    candidate.zoneId === zoneId
    && candidate.signalDirection === side
    && candidate.status !== 'REJECTED',
  );

  if (!expiredByAge && candidateStillValid) {
    return {
      state: { ...input.state, recentOppositeSignalValid: true },
      expired: false,
      ageCandles,
      valid: true,
    };
  }

  return {
    state: clearRecentSignalWatch(false),
    expired: true,
    ageCandles,
    valid: false,
  };
}

export function clearRecentSignalWatch(valid: boolean | null = null): RecentSignalWatchState {
  return {
    recentOppositeSignalSide: null,
    recentOppositeSignalTimestamp: null,
    recentOppositeSignalZoneId: null,
    recentOppositeSignalConfidence: null,
    recentOppositeSignalReason: null,
    recentOppositeSignalExpiresAt: null,
    recentOppositeSignalCreatedTick: null,
    recentOppositeSignalValid: valid,
  };
}

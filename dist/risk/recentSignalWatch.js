"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRecentSignalWatch = createRecentSignalWatch;
exports.evaluateRecentSignalWatch = evaluateRecentSignalWatch;
exports.clearRecentSignalWatch = clearRecentSignalWatch;
function createRecentSignalWatch(input) {
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
function evaluateRecentSignalWatch(input) {
    const side = input.state.recentOppositeSignalSide;
    const zoneId = input.state.recentOppositeSignalZoneId;
    if (!side || !zoneId) {
        return { state: input.state, expired: false, ageCandles: 0, valid: false };
    }
    const createdTick = input.state.recentOppositeSignalCreatedTick ?? input.currentTick;
    const ageCandles = Math.max(0, input.currentTick - createdTick);
    const expiredByAge = ageCandles >= input.ttlCandles;
    const candidateStillValid = input.candidates.some(candidate => candidate.zoneId === zoneId
        && candidate.signalDirection === side
        && candidate.status !== 'REJECTED');
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
function clearRecentSignalWatch(valid = null) {
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

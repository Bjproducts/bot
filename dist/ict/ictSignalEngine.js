"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateIctSignal = exports.DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE = void 0;
exports.createIctSignal = createIctSignal;
exports.DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE = 75;
function createIctSignal(input) {
    const minConfidence = normalizeMinConfidence(input.options);
    const evaluatedAt = input.context?.evaluatedAt
        ?? input.reaction.evaluatedAt
        ?? new Date().toISOString();
    if (input.zone.invalidated) {
        return noneSignal(input, minConfidence, evaluatedAt, 'Zone is invalidated');
    }
    if (input.reaction.zoneId !== input.zone.id) {
        return noneSignal(input, minConfidence, evaluatedAt, 'Reaction zone id does not match source zone id');
    }
    // Phase 5f: gate on reactionWinner + reactionScore (canonical fields).
    // output + confidence remain consistent aliases for any legacy callers.
    const winner = input.reaction.reactionWinner;
    const score = input.reaction.reactionScore;
    if (winner !== 'BUY' && winner !== 'SELL') {
        return noneSignal(input, minConfidence, evaluatedAt, `Reaction winner is ${winner}`);
    }
    if (score < minConfidence) {
        return noneSignal(input, minConfidence, evaluatedAt, `Reaction score ${formatNumber(score)} is below minimum ${formatNumber(minConfidence)}`);
    }
    return signal(input, minConfidence, evaluatedAt, winner, `Reaction winner ${winner} met score threshold`);
}
exports.evaluateIctSignal = createIctSignal;
function signal(input, minConfidence, evaluatedAt, action, reason) {
    return {
        signal: action,
        confidence: input.reaction.reactionScore,
        reason,
        sourceZoneType: input.zone.type,
        zoneId: input.zone.id,
        reactionOutput: input.reaction.output,
        minConfidence,
        evaluatedAt,
    };
}
function noneSignal(input, minConfidence, evaluatedAt, reason) {
    return {
        signal: 'NONE',
        confidence: input.zone.invalidated ? 0 : input.reaction.reactionScore,
        reason,
        sourceZoneType: input.zone.type,
        zoneId: input.zone.id,
        reactionOutput: input.reaction.output,
        minConfidence,
        evaluatedAt,
    };
}
function normalizeMinConfidence(options) {
    const value = options?.minConfidence ?? exports.DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE;
    if (!Number.isFinite(value))
        return exports.DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE;
    return Math.min(100, Math.max(0, value));
}
function formatNumber(value) {
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

"use strict";
// =====================================================================
// Phase 8E — position slot manager
//
// Classifies open positions as PROTECTED vs RISK and decides whether a
// new entry is allowed under two simultaneous caps:
//
//   MAX_TOTAL_OPEN_POSITIONS  (e.g. 5)  — counts every open position
//   MAX_ACTIVE_RISK_POSITIONS (e.g. 3)  — counts only RISK positions
//
// A position is PROTECTED when any of:
//   - stopAtBreakeven === true
//   - activeStopPrice == averageEntryPrice  (the stop is at entry)
//   - partialCloseDone === true AND stopAtBreakeven === true
//
// Otherwise it is RISK (the position can still lose money beyond a
// scratch). PROTECTED positions do not consume a risk slot, so the bot
// can keep BE-armed runners open while still taking new same-direction
// entries within MAX_TOTAL_OPEN_POSITIONS.
//
// This module is intentionally side-effect-free. bot.ts converts its
// internal PositionState[] to PositionSlotInput[] and consults the
// returned evaluation to decide whether to log ENTRY_SKIP_MAX_TOTAL or
// ENTRY_SKIP_MAX_RISK or proceed.
// =====================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_ACTIVE_RISK_POSITIONS = exports.DEFAULT_MAX_TOTAL_OPEN_POSITIONS = void 0;
exports.classifyPositionSlot = classifyPositionSlot;
exports.countPositionSlots = countPositionSlots;
exports.evaluatePositionSlotGate = evaluatePositionSlotGate;
exports.DEFAULT_MAX_TOTAL_OPEN_POSITIONS = 5;
exports.DEFAULT_MAX_ACTIVE_RISK_POSITIONS = 3;
function classifyPositionSlot(p) {
    if (p.stopAtBreakeven === true)
        return 'PROTECTED';
    if (typeof p.activeStopPrice === 'number'
        && typeof p.averageEntryPrice === 'number'
        && Math.abs(p.activeStopPrice - p.averageEntryPrice) < 1e-9) {
        return 'PROTECTED';
    }
    // partialCloseDone alone (without BE) is NOT protected per the
    // Phase 8E spec — the residual runner still has open risk until BE
    // is also armed.
    return 'RISK';
}
function countPositionSlots(positions) {
    let total = 0;
    let risk = 0;
    for (const p of positions) {
        total++;
        if (classifyPositionSlot(p) === 'RISK')
            risk++;
    }
    return { total, risk, protected: total - risk };
}
function evaluatePositionSlotGate(positions, opts = {}) {
    const maxTotal = opts.maxTotal ?? exports.DEFAULT_MAX_TOTAL_OPEN_POSITIONS;
    const maxRisk = opts.maxRisk ?? exports.DEFAULT_MAX_ACTIVE_RISK_POSITIONS;
    const counts = countPositionSlots(positions);
    // Total cap is the hard ceiling — even all-protected hits it.
    if (counts.total >= maxTotal) {
        return {
            totalOpen: counts.total,
            riskCount: counts.risk,
            protectedCount: counts.protected,
            maxTotal,
            maxRisk,
            blockNewEntry: true,
            blockReasonCode: 'MAX_TOTAL_POSITIONS',
            blockReason: `Open positions ${counts.total}/${maxTotal} (protected ${counts.protected}, risk ${counts.risk})`,
        };
    }
    // Risk cap only counts non-protected positions, so BE-armed runners
    // do not block new entries.
    if (counts.risk >= maxRisk) {
        return {
            totalOpen: counts.total,
            riskCount: counts.risk,
            protectedCount: counts.protected,
            maxTotal,
            maxRisk,
            blockNewEntry: true,
            blockReasonCode: 'MAX_RISK_POSITIONS',
            blockReason: `Risk positions ${counts.risk}/${maxRisk} (protected ${counts.protected} not counted, total ${counts.total}/${maxTotal})`,
        };
    }
    return {
        totalOpen: counts.total,
        riskCount: counts.risk,
        protectedCount: counts.protected,
        maxTotal,
        maxRisk,
        blockNewEntry: false,
        blockReasonCode: 'NONE',
        blockReason: '',
    };
}

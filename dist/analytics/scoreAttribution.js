"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScoreAttribution = createScoreAttribution;
exports.scoreBreakdownTotal = scoreBreakdownTotal;
exports.formatScoreAttributionRows = formatScoreAttributionRows;
const LEGACY_ROWS = [
    { key: 'liquiditySweepScore', label: 'Liquidity Sweep' },
    { key: 'displacementScore', label: 'Displacement' },
    { key: 'mssScore', label: 'MSS' },
    { key: 'fvgQualityScore', label: 'FVG Quality' },
    { key: 'ifvgBonus', label: 'IFVG Bonus' },
    { key: 'targetFitScore', label: 'Target Fit' },
    { key: 'reactionScore', label: 'Reaction' },
    { key: 'premiumDiscountScore', label: 'Premium/Discount' },
    { key: 'sessionScore', label: 'Session' },
    { key: 'confidenceScore', label: 'Confidence' },
];
const PROBABILITY_ROWS = [
    { key: 'targetReachProbability', label: 'Target Reach Probability' },
    { key: 'reactionTierScore', label: 'Reaction Tier' },
    { key: 'rrFitScore', label: 'RR Fit' },
    { key: 'scalpTargetFitScore', label: 'Scalp Target Fit' },
    { key: 'targetDistancePenalty', label: 'Distance Penalty' },
    { key: 'zoneFreshnessScore', label: 'Zone Freshness' },
];
function createScoreAttribution(candidate) {
    const confidenceScore = round(candidate.confidence * 0.45, 2);
    const fvgQualityScore = candidate.zoneType === 'FVG' ? 10 : 10;
    const ifvgBonus = candidate.zoneType === 'IFVG' ? 4 : 0;
    const targetFitScore = candidate.targetFit === 'PREFERRED_RANGE'
        ? 25
        : candidate.targetFit === 'EXTENDED_TARGET'
            ? 15
            : 0;
    const reactionScore = candidate.reactionConfirmed
        ? 12
        : partialReactionScore(candidate);
    const rawLegacy = {
        liquiditySweepScore: prerequisiteScore(candidate, 'liquidity'),
        displacementScore: prerequisiteScore(candidate, 'displacement'),
        mssScore: prerequisiteScore(candidate, 'mss'),
        fvgQualityScore,
        ifvgBonus,
        targetFitScore,
        reactionScore,
        premiumDiscountScore: 0,
        sessionScore: 0,
        confidenceScore,
    };
    const finalScore = candidate.score;
    const rawLegacyTotal = sumLegacy(rawLegacy);
    const normalizedMultiplier = rawLegacyTotal > 0 ? round(finalScore / rawLegacyTotal, 4) : 0;
    const normalizedLegacy = normalizeLegacy(rawLegacy, normalizedMultiplier, finalScore);
    const breakdown = {
        ...normalizedLegacy,
        // Phase 5h descriptive components — already in 0..100 scale or raw
        // sub-scores; not renormalized so the values stay interpretable.
        targetReachProbability: round(candidate.targetReachProbability, 2),
        reactionTierScore: round(candidate.reactionTierScore, 2),
        rrFitScore: round(candidate.rrFitScore, 2),
        scalpTargetFitScore: round(candidate.scalpTargetFitScore, 2),
        targetDistancePenalty: round(candidate.targetDistancePenalty, 2),
        zoneFreshnessScore: round(candidate.zoneFreshnessScore, 2),
    };
    const componentTotal = round(sumLegacy(breakdown), 2);
    const rows = [
        ...LEGACY_ROWS.map(({ key, label }) => ({ key, label, value: breakdown[key] })),
        ...PROBABILITY_ROWS.map(({ key, label }) => ({ key, label, value: breakdown[key] })),
    ];
    return {
        breakdown,
        finalScore,
        componentTotal,
        normalizedMultiplier,
        rows,
    };
}
function scoreBreakdownTotal(breakdown) {
    return round(sumLegacy(breakdown), 2);
}
function formatScoreAttributionRows(attribution) {
    return [
        ...attribution.rows.map(row => `${row.label.padEnd(24)} +${row.value.toFixed(2)}`),
        '-------------------------',
        `Final Score              ${attribution.finalScore.toFixed(2)}`,
    ];
}
function prerequisiteScore(candidate, prerequisite) {
    const reason = `${candidate.reason} ${candidate.zoneId}`.toLowerCase();
    if (reason.includes(prerequisite))
        return prerequisite === 'liquidity' ? 30 : 20;
    if (candidate.status === 'SELECTED' || candidate.status === 'QUALIFIED') {
        return prerequisite === 'liquidity' ? 30 : 20;
    }
    return 0;
}
function partialReactionScore(candidate) {
    const checks = candidate.reaction?.checks;
    if (!checks)
        return 0;
    let score = 0;
    if (checks.returnToZone.passed)
        score += 3;
    if (checks.midpointInteraction.passed)
        score += 2;
    if (checks.bodyCloseConfirmation.passed)
        score += 3;
    return score;
}
function sumLegacy(breakdown) {
    return LEGACY_ROWS.reduce((sum, { key }) => sum + (breakdown[key] ?? 0), 0);
}
function normalizeLegacy(rawLegacy, multiplier, targetTotal) {
    const normalized = Object.fromEntries(Object.entries(rawLegacy).map(([key, value]) => [key, round(value * multiplier, 2)]));
    const currentSum = LEGACY_ROWS.reduce((sum, { key }) => sum + normalized[key], 0);
    const diff = round(targetTotal - currentSum, 2);
    normalized.confidenceScore = round(normalized.confidenceScore + diff, 2);
    return normalized;
}
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

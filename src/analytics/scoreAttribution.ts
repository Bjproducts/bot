import { TradeCandidate } from '../ict/tradeCandidateTypes';
import { ScoreAttribution, ScoreAttributionRow, ScoreBreakdown } from './scoreAttributionTypes';

// Legacy "scored" components — these renormalize to sum to candidate.score
// so the original ScoreAttribution invariant (componentTotal === finalScore)
// is preserved. Phase 5h "descriptive" components are written to the
// breakdown but excluded from the sum.
type LegacyScoreBreakdown = Pick<ScoreBreakdown,
  | 'liquiditySweepScore'
  | 'displacementScore'
  | 'mssScore'
  | 'fvgQualityScore'
  | 'ifvgBonus'
  | 'targetFitScore'
  | 'reactionScore'
  | 'premiumDiscountScore'
  | 'sessionScore'
  | 'confidenceScore'>;

const LEGACY_ROWS: Array<{ key: keyof LegacyScoreBreakdown; label: string }> = [
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

const PROBABILITY_ROWS: Array<{ key: keyof ScoreBreakdown; label: string }> = [
  { key: 'targetReachProbability', label: 'Target Reach Probability' },
  { key: 'reactionTierScore', label: 'Reaction Tier' },
  { key: 'rrFitScore', label: 'RR Fit' },
  { key: 'scalpTargetFitScore', label: 'Scalp Target Fit' },
  { key: 'targetDistancePenalty', label: 'Distance Penalty' },
  { key: 'zoneFreshnessScore', label: 'Zone Freshness' },
];

export function createScoreAttribution(candidate: TradeCandidate): ScoreAttribution {
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

  const rawLegacy: LegacyScoreBreakdown = {
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

  const breakdown: ScoreBreakdown = {
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

  const rows: ScoreAttributionRow[] = [
    ...LEGACY_ROWS.map(({ key, label }) => ({ key, label, value: breakdown[key] })),
    ...PROBABILITY_ROWS.map(({ key, label }) => ({ key, label, value: breakdown[key] })),
  ] as ScoreAttributionRow[];

  return {
    breakdown,
    finalScore,
    componentTotal,
    normalizedMultiplier,
    rows,
  };
}

export function scoreBreakdownTotal(breakdown: ScoreBreakdown): number {
  return round(sumLegacy(breakdown), 2);
}

export function formatScoreAttributionRows(attribution: ScoreAttribution): string[] {
  return [
    ...attribution.rows.map(row => `${row.label.padEnd(24)} +${row.value.toFixed(2)}`),
    '-------------------------',
    `Final Score              ${attribution.finalScore.toFixed(2)}`,
  ];
}

function prerequisiteScore(candidate: TradeCandidate, prerequisite: 'liquidity' | 'displacement' | 'mss'): number {
  const reason = `${candidate.reason} ${candidate.zoneId}`.toLowerCase();
  if (reason.includes(prerequisite)) return prerequisite === 'liquidity' ? 30 : 20;

  if (candidate.status === 'SELECTED' || candidate.status === 'QUALIFIED') {
    return prerequisite === 'liquidity' ? 30 : 20;
  }
  return 0;
}

function partialReactionScore(candidate: TradeCandidate): number {
  const checks = candidate.reaction?.checks;
  if (!checks) return 0;
  let score = 0;
  if (checks.returnToZone.passed) score += 3;
  if (checks.midpointInteraction.passed) score += 2;
  if (checks.bodyCloseConfirmation.passed) score += 3;
  return score;
}

function sumLegacy(breakdown: LegacyScoreBreakdown): number {
  return LEGACY_ROWS.reduce((sum, { key }) => sum + (breakdown[key] ?? 0), 0);
}

function normalizeLegacy(
  rawLegacy: LegacyScoreBreakdown,
  multiplier: number,
  targetTotal: number,
): LegacyScoreBreakdown {
  const normalized = Object.fromEntries(
    Object.entries(rawLegacy).map(([key, value]) => [key, round(value * multiplier, 2)]),
  ) as typeof rawLegacy;
  const currentSum = LEGACY_ROWS.reduce((sum, { key }) => sum + normalized[key], 0);
  const diff = round(targetTotal - currentSum, 2);
  normalized.confidenceScore = round(normalized.confidenceScore + diff, 2);
  return normalized;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

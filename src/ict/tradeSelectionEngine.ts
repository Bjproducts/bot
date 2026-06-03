import { ValidatedFVGZone } from './validatedFvgTypes';
import {
  TradeCandidate,
  TradeCandidateTargetFit,
  TradeSelectionEvaluationInput,
  TradeSelectionInput,
  TradeSelectionOptions,
  TradeSelectionResult,
} from './tradeCandidateTypes';

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_MIN_EXPECTED_PROFIT_USD = 0.50;
const DEFAULT_PREFERRED_MIN_PROFIT_USD = 0.50;
const DEFAULT_PREFERRED_MAX_PROFIT_USD = 1.00;
const DEFAULT_MIN_RISK_REWARD_RATIO = 1.5;
const DEFAULT_EXIT_TARGET_MODE = 'HYBRID' as const;

// Score caps used by the probability formula. Sum ≤ 110 before penalty
// (max 30 penalty) → clamped to 0..100.
const REACTION_TIER_DISPLACEMENT = 30;
const REACTION_TIER_BOUNDARY = 22;
const REACTION_TIER_MIDPOINT = 8;
const DISPLACEMENT_MAX = 20;
const RR_FIT_MAX = 20;
const SCALP_FIT_PREFERRED = 25;
const SCALP_FIT_NEAR = 12;
const ZONE_FRESHNESS_MAX = 15;
const ZONE_FRESHNESS_UNKNOWN = 7;
const DISTANCE_PENALTY_MAX = 30;

interface NormalizedOptions {
  minConfidence: number;
  minExpectedProfitUsd: number;
  preferredMinProfitUsd: number;
  preferredMaxProfitUsd: number;
  minRiskRewardRatio: number;
  exitTargetMode: 'STRUCTURE' | 'SCALP' | 'HYBRID';
  currentBarIndex: number | null;
}

export function selectTradeCandidate(input: TradeSelectionInput): TradeSelectionResult {
  const options = normalizeOptions(input.options);
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const candidates = input.evaluations.map((evaluation) => buildCandidate(evaluation, input, options));
  const qualified = candidates
    .filter(candidate => candidate.status !== 'REJECTED')
    .sort(compareCandidates);

  const selected = qualified[0] ?? null;
  const updatedCandidates = candidates.map((candidate) => {
    if (!selected || candidate.status === 'REJECTED') return candidate;
    if (candidate.zoneId === selected.zoneId && candidate.signalDirection === selected.signalDirection) {
      return { ...candidate, status: 'SELECTED' as const };
    }
    return {
      ...candidate,
      status: 'REJECTED' as const,
      rejectionReason: 'Higher targetReachProbability candidate selected',
    };
  });

  const selectedCandidate = selected
    ? updatedCandidates.find(c => c.zoneId === selected.zoneId && c.signalDirection === selected.signalDirection) ?? selected
    : null;

  return {
    action: selectedCandidate?.signalDirection ?? 'NONE',
    selectedCandidate,
    candidates: updatedCandidates,
    candidatesEvaluated: updatedCandidates.length,
    rejectionReason: selectedCandidate ? '' : summarizeRejections(updatedCandidates),
    evaluatedAt,
  };
}

export const selectIctTradeCandidate = selectTradeCandidate;

function buildCandidate(
  evaluation: TradeSelectionEvaluationInput,
  input: TradeSelectionInput,
  options: NormalizedOptions,
): TradeCandidate {
  // Legacy expected-profit proxy used when no real target is provided.
  const expectedProfitAtTPUsd = roundMoney(Math.abs(input.orderSizeUsd * input.takeProfitPct));
  const distanceToTPPercent = roundPercent(Math.abs(input.takeProfitPct) * 100);

  // Real target context (when bot passed it).
  const target = evaluation.targetSelection?.selectedTarget ?? null;
  const stopPrice = evaluation.stopPrice ?? null;
  const realRewardDistance = target ? Math.abs(target.price - input.currentPrice) : 0;
  const realRiskDistance = stopPrice !== null ? Math.abs(input.currentPrice - stopPrice) : 0;
  const realRiskRewardRatio = realRiskDistance > 0 && target
    ? realRewardDistance / realRiskDistance
    : null;
  const realRewardPct = input.currentPrice > 0 ? realRewardDistance / input.currentPrice : 0;
  const realRiskPct = input.currentPrice > 0 ? realRiskDistance / input.currentPrice : 0;
  const realExpectedProfitUsd = target ? roundMoney(input.orderSizeUsd * realRewardPct) : null;
  const realExpectedLossUsd = stopPrice !== null ? roundMoney(input.orderSizeUsd * realRiskPct) : null;
  const expectedMovePercent = realRewardPct * 100;

  const profitForFit = realExpectedProfitUsd ?? expectedProfitAtTPUsd;
  const targetFit = classifyTargetFit(profitForFit, options);
  const reactionConfirmed = isReactionConfirmed(evaluation);
  const volumeConfirmed = evaluation.reaction?.checks.volumeConfirmation.passed === true;

  // Phase 5h probability components.
  const reactionTier = evaluation.reaction?.reactionType ?? 'NONE';
  const reactionTierScore = reactionTierScoreOf(reactionTier);
  const displacementScore = displacementScoreOf(evaluation);
  const rrFitScore = realRiskRewardRatio !== null
    ? rrFitScoreOf(realRiskRewardRatio, options.minRiskRewardRatio)
    : 0;
  const scalpTargetFitScore = scalpTargetFitScoreOf(profitForFit, options);
  const zoneFreshnessScore = zoneFreshnessScoreOf(evaluation, options.currentBarIndex);
  const targetDistancePenalty = target
    ? targetDistancePenaltyOf(expectedMovePercent, evaluation.targetSelection?.exitTargetMode ?? options.exitTargetMode)
    : 0;

  const probabilityRaw = reactionTierScore
    + displacementScore
    + rrFitScore
    + scalpTargetFitScore
    + zoneFreshnessScore
    - targetDistancePenalty;
  const targetReachProbability = clamp(0, 100, roundScore(probabilityRaw));

  const expectedTimeToTargetEstimate = estimateTimeToTarget(realRewardDistance, realRiskDistance);

  const rejectionReason = rejectionReasonFor({
    evaluation,
    expectedProfitAtTPUsd,
    options,
    reactionTier,
    realRiskRewardRatio,
    target,
  });
  const rejected = rejectionReason.length > 0;

  const score = rejected
    ? 0
    : scoreCandidate(evaluation, targetFit, reactionConfirmed, volumeConfirmed);

  return {
    signal: evaluation.signal,
    zone: evaluation.zone,
    reaction: evaluation.reaction,
    signalDirection: evaluation.signal.signal,
    zoneType: evaluation.zone.type,
    zoneId: evaluation.zone.id,
    expectedProfitAtTPUsd,
    distanceToTPPercent,
    distanceToInvalidationPercent: distanceToInvalidationPercent(evaluation, input.currentPrice),
    confidence: evaluation.signal.confidence,
    reason: evaluation.signal.reason,
    score,
    targetFit,
    extendedTarget: targetFit === 'EXTENDED_TARGET',
    status: rejected ? 'REJECTED' : 'QUALIFIED',
    rejectionReason,
    reactionConfirmed,
    volumeConfirmed,
    targetReachProbability,
    expectedTimeToTargetEstimate,
    reactionTierScore,
    displacementScore,
    rrFitScore,
    scalpTargetFitScore,
    zoneFreshnessScore,
    targetDistancePenalty,
    targetSelection: evaluation.targetSelection ?? null,
    managedTarget: target,
    stopPrice,
    realExpectedProfitUsd,
    realExpectedLossUsd,
    realRiskRewardRatio: realRiskRewardRatio === null ? null : roundScore(realRiskRewardRatio),
  };
}

function rejectionReasonFor(args: {
  evaluation: TradeSelectionEvaluationInput;
  expectedProfitAtTPUsd: number;
  options: NormalizedOptions;
  reactionTier: string;
  realRiskRewardRatio: number | null;
  target: { price: number } | null;
}): string {
  const { evaluation, expectedProfitAtTPUsd, options, reactionTier, realRiskRewardRatio, target } = args;
  if (evaluation.signal.signal !== 'BUY' && evaluation.signal.signal !== 'SELL') {
    return evaluation.signal.reason || 'Signal is NONE';
  }
  if (evaluation.signal.confidence < options.minConfidence) {
    return `Below confidence threshold ${options.minConfidence}`;
  }
  // Phase 5h: TOUCH and NONE tiers are explicitly rejected. Selection
  // priorities #4 ranks reaction tier last, but the spec says TOUCH should
  // not be selected at all.
  if (reactionTier === 'TOUCH' || reactionTier === 'NONE') {
    return `Reaction tier ${reactionTier} too weak`;
  }
  if (evaluation.targetSelection && target === null) {
    return `Target selection failed: ${evaluation.targetSelection.selectedTargetReason}`;
  }
  if (realRiskRewardRatio !== null && realRiskRewardRatio < options.minRiskRewardRatio) {
    return `Risk/reward ${realRiskRewardRatio.toFixed(2)} below minimum ${options.minRiskRewardRatio}`;
  }
  if (expectedProfitAtTPUsd < options.minExpectedProfitUsd) {
    return `Expected profit below $${options.minExpectedProfitUsd.toFixed(2)}`;
  }
  return '';
}

function scoreCandidate(
  evaluation: TradeSelectionEvaluationInput,
  targetFit: TradeCandidateTargetFit,
  reactionConfirmed: boolean,
  volumeConfirmed: boolean,
): number {
  const confidenceScore = evaluation.signal.confidence * 0.45;
  const zoneQualityScore = evaluation.zone.type === 'IFVG' ? 14 : 10;
  const targetFitScore = targetFit === 'PREFERRED_RANGE'
    ? 25
    : targetFit === 'EXTENDED_TARGET'
      ? 15
      : 0;
  const reactionScore = reactionConfirmed ? 12 : partialReactionScore(evaluation);
  const volumeScore = volumeConfirmed ? 5 : 0;

  return roundScore(confidenceScore + zoneQualityScore + targetFitScore + reactionScore + volumeScore);
}

function partialReactionScore(evaluation: TradeSelectionEvaluationInput): number {
  const checks = evaluation.reaction?.checks;
  if (!checks) return 0;
  let score = 0;
  if (checks.returnToZone.passed) score += 3;
  if (checks.midpointInteraction.passed) score += 2;
  if (checks.bodyCloseConfirmation.passed) score += 3;
  return score;
}

function isReactionConfirmed(evaluation: TradeSelectionEvaluationInput): boolean {
  const reaction = evaluation.reaction;
  if (!reaction) return false;
  return reaction.output === evaluation.signal.signal
    && reaction.checks.returnToZone.passed
    && reaction.checks.bodyCloseConfirmation.passed;
}

function distanceToInvalidationPercent(
  evaluation: TradeSelectionEvaluationInput,
  currentPrice: number,
): number | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (evaluation.signal.signal === 'BUY') {
    return roundPercent(Math.max(0, ((currentPrice - evaluation.zone.low) / currentPrice) * 100));
  }
  if (evaluation.signal.signal === 'SELL') {
    return roundPercent(Math.max(0, ((evaluation.zone.high - currentPrice) / currentPrice) * 100));
  }
  return null;
}

function classifyTargetFit(
  expectedProfitUsd: number,
  options: NormalizedOptions,
): TradeCandidateTargetFit {
  if (expectedProfitUsd < options.minExpectedProfitUsd) return 'BELOW_MINIMUM';
  if (expectedProfitUsd >= options.preferredMinProfitUsd && expectedProfitUsd <= options.preferredMaxProfitUsd) {
    return 'PREFERRED_RANGE';
  }
  return 'EXTENDED_TARGET';
}

function reactionTierScoreOf(tier: string): number {
  switch (tier) {
    case 'DISPLACEMENT': return REACTION_TIER_DISPLACEMENT;
    case 'BOUNDARY': return REACTION_TIER_BOUNDARY;
    case 'MIDPOINT': return REACTION_TIER_MIDPOINT;
    default: return 0;
  }
}

function displacementScoreOf(evaluation: TradeSelectionEvaluationInput): number {
  const validation = (evaluation.zone as ValidatedFVGZone).validation;
  const rangeMultiple = validation?.displacement?.rangeMultiple ?? 0;
  if (rangeMultiple <= 0) {
    // Fall back: if the reaction itself was a displacement, give partial credit.
    return evaluation.reaction?.displacementReaction !== 'NONE' ? 10 : 0;
  }
  if (rangeMultiple < 1.2) return 0;
  // Scale 1.2 → 10, 3.0+ → 20.
  const scaled = 10 + (rangeMultiple - 1.2) * (10 / 1.8);
  return Math.round(clamp(0, DISPLACEMENT_MAX, scaled));
}

function rrFitScoreOf(rr: number, minRR: number): number {
  if (!Number.isFinite(rr) || rr < minRR) return 0;
  // RR == minRR → 20 (best fit for scalp). Falls linearly to 8 at RR=5.
  if (rr >= 5) return 8;
  const span = Math.max(0.01, 5 - minRR);
  const t = (rr - minRR) / span;            // 0..1
  return Math.round(RR_FIT_MAX - t * (RR_FIT_MAX - 8));
}

function scalpTargetFitScoreOf(expectedProfitUsd: number, options: NormalizedOptions): number {
  if (!Number.isFinite(expectedProfitUsd) || expectedProfitUsd <= 0) return 0;
  if (expectedProfitUsd >= options.preferredMinProfitUsd && expectedProfitUsd <= options.preferredMaxProfitUsd) {
    return SCALP_FIT_PREFERRED;
  }
  const widerLow = options.preferredMinProfitUsd / 2;
  const widerHigh = options.preferredMaxProfitUsd * 2;
  if (expectedProfitUsd >= widerLow && expectedProfitUsd <= widerHigh) return SCALP_FIT_NEAR;
  return 0;
}

function zoneFreshnessScoreOf(
  evaluation: TradeSelectionEvaluationInput,
  currentBarIndex: number | null,
): number {
  if (currentBarIndex === null) return ZONE_FRESHNESS_UNKNOWN;
  const formed = formedBarIndexOf(evaluation);
  if (formed === null) return ZONE_FRESHNESS_UNKNOWN;
  const age = Math.max(0, currentBarIndex - formed);
  if (age <= 5) return ZONE_FRESHNESS_MAX;
  if (age <= 20) return 10;
  if (age <= 50) return 5;
  return 0;
}

function formedBarIndexOf(evaluation: TradeSelectionEvaluationInput): number | null {
  const zone = evaluation.zone as { candle3Index?: number; inversionCandleIndex?: number };
  if (typeof zone.inversionCandleIndex === 'number') return zone.inversionCandleIndex;
  if (typeof zone.candle3Index === 'number') return zone.candle3Index;
  return null;
}

function targetDistancePenaltyOf(
  expectedMovePercent: number,
  exitTargetMode: 'STRUCTURE' | 'SCALP' | 'HYBRID',
): number {
  // SCALP-mode targets are deterministically close (1.5R) — no penalty.
  if (exitTargetMode === 'SCALP') return 0;
  if (!Number.isFinite(expectedMovePercent) || expectedMovePercent <= 0) return 0;
  if (expectedMovePercent <= 1) return 0;
  if (expectedMovePercent <= 2) return 8;
  if (expectedMovePercent <= 5) return 18;
  return DISTANCE_PENALTY_MAX;
}

function estimateTimeToTarget(rewardDistance: number, riskDistance: number): number {
  if (!Number.isFinite(rewardDistance) || rewardDistance <= 0) return 0;
  if (!Number.isFinite(riskDistance) || riskDistance <= 0) return 0;
  const r = rewardDistance / riskDistance;
  // Rough heuristic: 5 candles per R, minimum 1.
  return Math.max(1, Math.round(r * 5));
}

function compareCandidates(a: TradeCandidate, b: TradeCandidate): number {
  if (a.targetReachProbability !== b.targetReachProbability) {
    return b.targetReachProbability - a.targetReachProbability;
  }
  if (a.displacementScore !== b.displacementScore) {
    return b.displacementScore - a.displacementScore;
  }
  if (a.rrFitScore !== b.rrFitScore) {
    return b.rrFitScore - a.rrFitScore;
  }
  if (a.reactionTierScore !== b.reactionTierScore) {
    return b.reactionTierScore - a.reactionTierScore;
  }
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  return b.confidence - a.confidence;
}

function summarizeRejections(candidates: readonly TradeCandidate[]): string {
  if (candidates.length === 0) return 'No candidates provided';
  const uniqueReasons = Array.from(new Set(candidates.map(c => c.rejectionReason).filter(Boolean)));
  return uniqueReasons.length > 0 ? uniqueReasons.join('; ') : 'No candidate qualified';
}

function normalizeOptions(options: TradeSelectionOptions | undefined): NormalizedOptions {
  return {
    minConfidence: finiteOr(options?.minConfidence, DEFAULT_MIN_CONFIDENCE),
    minExpectedProfitUsd: finiteOr(options?.minExpectedProfitUsd, DEFAULT_MIN_EXPECTED_PROFIT_USD),
    preferredMinProfitUsd: finiteOr(options?.preferredMinProfitUsd, DEFAULT_PREFERRED_MIN_PROFIT_USD),
    preferredMaxProfitUsd: finiteOr(options?.preferredMaxProfitUsd, DEFAULT_PREFERRED_MAX_PROFIT_USD),
    minRiskRewardRatio: finiteOr(options?.minRiskRewardRatio, DEFAULT_MIN_RISK_REWARD_RATIO),
    exitTargetMode: options?.exitTargetMode ?? DEFAULT_EXIT_TARGET_MODE,
    currentBarIndex: typeof options?.currentBarIndex === 'number' ? options.currentBarIndex : null,
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundPercent(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

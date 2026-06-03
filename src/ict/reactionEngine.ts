import { Candle } from '../signals/types';
import { IctZoneBase } from './types';
import {
  IctDisplacementOptions,
  IctReactionBoundaryResult,
  IctReactionCheck,
  IctReactionDisplacementResult,
  IctReactionInput,
  IctReactionKind,
  IctReactionMidpointResult,
  IctReactionOptions,
  IctReactionOutput,
  IctReactionResult,
  IctReactionTier,
  IctReactionWinner,
  IctVolumeConfirmationOptions,
} from './reactionTypes';

const SCORE_NONE = 0;
const SCORE_TOUCH = 20;
const SCORE_BOUNDARY = 75;
const SCORE_DISPLACEMENT = 100;

const DEFAULT_VOLUME_OPTIONS: Required<IctVolumeConfirmationOptions> = {
  enabled: false,
  lookback: 20,
  multiplier: 1.5,
  requiredForOutput: false,
};

const DEFAULT_DISPLACEMENT_OPTIONS: Required<IctDisplacementOptions> = {
  enabled: true,
  lookback: 5,
  bodyToRangeMin: 0.6,
  rangeMultiplier: 1.2,
};

interface TierEvaluation {
  tier: IctReactionTier;
  winner: IctReactionWinner;
  score: number;
  midpointResult: IctReactionMidpointResult;
  boundaryCloseResult: IctReactionBoundaryResult;
  displacementReaction: IctReactionDisplacementResult;
}

export function evaluateReaction(input: IctReactionInput): IctReactionResult {
  const latestCandle = input.candles[input.candles.length - 1] ?? null;
  const zone = input.zone;
  const volumeOptions = mergeVolumeOptions(input.options);
  const displacementOptions = mergeDisplacementOptions(input.options);

  if (!isValidZone(zone) || !Number.isFinite(input.currentPrice)) {
    return noReaction(input, latestCandle, 'Invalid zone or current price');
  }

  if (zone.invalidated) {
    return noReaction(input, latestCandle, 'Zone is invalidated');
  }

  if (!latestCandle || !isValidCandle(latestCandle)) {
    return noReaction(input, latestCandle, 'No valid candle available for reaction evaluation');
  }

  const touchedZone = candleTouchesZone(zone, latestCandle, input.currentPrice);
  const touchedMidpoint = candleTouchesMidpoint(zone, latestCandle, input.currentPrice);
  const volumeConfirmation = evaluateVolumeConfirmation(input.candles, volumeOptions);
  const volumeAllowed = !volumeOptions.requiredForOutput || volumeConfirmation.passed;

  const tier = evaluateTier({
    zone,
    candle: latestCandle,
    candles: input.candles,
    touchedZone,
    touchedMidpoint,
    displacementOptions,
  });

  // Volume gate: if required and not met, suppress the winner without
  // dropping the tier diagnostics — operators can still see why the
  // reaction was rejected.
  let winner: IctReactionWinner = tier.winner;
  let score = tier.score;
  if (!volumeAllowed && winner !== 'NONE') {
    winner = 'NONE';
    score = SCORE_NONE;
  }

  const output: IctReactionOutput = winner === 'BUY' || winner === 'SELL' ? winner : 'NONE';
  const reactionKind: IctReactionKind = winner === 'BUY'
    ? 'BULLISH_REACTION'
    : winner === 'SELL'
      ? 'BEARISH_REACTION'
      : 'NO_REACTION';

  const bodyCloseConfirmation = evaluateBodyCloseConfirmation(winner, latestCandle, zone);

  const checks = {
    returnToZone: makeCheck(
      touchedZone,
      touchedZone ? 'Price traded into the zone range' : 'Price has not returned to the zone range',
    ),
    midpointInteraction: makeCheck(
      touchedMidpoint,
      touchedMidpoint
        ? 'Price interacted with the zone midpoint'
        : 'Price has not interacted with the zone midpoint',
    ),
    bodyCloseConfirmation,
    volumeConfirmation,
  };

  return {
    zoneId: zone.id,
    zoneDirection: zone.direction,
    reaction: reactionKind,
    output,
    confidence: score,
    currentPrice: input.currentPrice,
    evaluatedAt: latestCandle.timestamp.toISOString(),
    checks,
    reasons: buildReasons(tier, winner, score, volumeOptions, volumeConfirmation.passed),
    reactionType: tier.tier,
    midpointResult: tier.midpointResult,
    boundaryCloseResult: tier.boundaryCloseResult,
    displacementReaction: tier.displacementReaction,
    reactionWinner: winner,
    reactionScore: score,
  };
}

export const evaluateZoneReaction = evaluateReaction;

function evaluateTier(params: {
  zone: IctZoneBase;
  candle: Candle;
  candles: readonly Candle[];
  touchedZone: boolean;
  touchedMidpoint: boolean;
  displacementOptions: Required<IctDisplacementOptions>;
}): TierEvaluation {
  const { zone, candle, candles, touchedZone, touchedMidpoint, displacementOptions } = params;
  const close = candle.close;

  const midpointResult: IctReactionMidpointResult = !touchedMidpoint
    ? 'NOT_EVALUATED'
    : close > zone.midpoint
      ? 'BULLISH'
      : close < zone.midpoint
        ? 'BEARISH'
        : 'NEUTRAL';

  const boundaryCloseResult: IctReactionBoundaryResult = close > zone.high
    ? 'BULLISH'
    : close < zone.low
      ? 'BEARISH'
      : 'NEUTRAL';

  const displacementMet = displacementOptions.enabled
    && isDisplacementCandle(candle, candles, displacementOptions);
  const displacementReaction: IctReactionDisplacementResult = displacementMet && close > zone.high
    ? 'BULLISH'
    : displacementMet && close < zone.low
      ? 'BEARISH'
      : 'NONE';

  if (!touchedZone && !touchedMidpoint) {
    return {
      tier: 'NONE',
      winner: 'NONE',
      score: SCORE_NONE,
      midpointResult: 'NOT_EVALUATED',
      boundaryCloseResult: 'NOT_EVALUATED',
      displacementReaction: 'NONE',
    };
  }

  if (displacementReaction === 'BULLISH') {
    return {
      tier: 'DISPLACEMENT',
      winner: 'BUY',
      score: SCORE_DISPLACEMENT,
      midpointResult,
      boundaryCloseResult,
      displacementReaction,
    };
  }

  if (displacementReaction === 'BEARISH') {
    return {
      tier: 'DISPLACEMENT',
      winner: 'SELL',
      score: SCORE_DISPLACEMENT,
      midpointResult,
      boundaryCloseResult,
      displacementReaction,
    };
  }

  if (boundaryCloseResult === 'BULLISH') {
    return {
      tier: 'BOUNDARY',
      winner: 'BUY',
      score: SCORE_BOUNDARY,
      midpointResult,
      boundaryCloseResult,
      displacementReaction,
    };
  }

  if (boundaryCloseResult === 'BEARISH') {
    return {
      tier: 'BOUNDARY',
      winner: 'SELL',
      score: SCORE_BOUNDARY,
      midpointResult,
      boundaryCloseResult,
      displacementReaction,
    };
  }

  return {
    tier: 'TOUCH',
    winner: 'NONE',
    score: SCORE_TOUCH,
    midpointResult,
    boundaryCloseResult,
    displacementReaction,
  };
}

function candleTouchesZone(zone: IctZoneBase, candle: Candle, currentPrice: number): boolean {
  const candleTouched = candle.low <= zone.high && candle.high >= zone.low;
  const priceInside = currentPrice >= zone.low && currentPrice <= zone.high;
  return candleTouched || priceInside;
}

function candleTouchesMidpoint(zone: IctZoneBase, candle: Candle, currentPrice: number): boolean {
  const candleTouched = candle.low <= zone.midpoint && candle.high >= zone.midpoint;
  const priceAtMid = currentPrice === zone.midpoint;
  return candleTouched || priceAtMid;
}

function isDisplacementCandle(
  candle: Candle,
  candles: readonly Candle[],
  options: Required<IctDisplacementOptions>,
): boolean {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (range <= 0) return false;

  const bodyToRange = body / range;
  if (bodyToRange < options.bodyToRangeMin) return false;

  const priorCandles = candles
    .slice(Math.max(0, candles.length - 1 - options.lookback), candles.length - 1)
    .filter(isValidCandle);

  if (priorCandles.length === 0) return false;

  const averageRange = priorCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / priorCandles.length;
  if (averageRange <= 0) return false;

  return range / averageRange >= options.rangeMultiplier;
}

function evaluateBodyCloseConfirmation(
  winner: IctReactionWinner,
  candle: Candle,
  zone: IctZoneBase,
): IctReactionCheck {
  const passed = (winner === 'BUY' && candle.close > candle.open && candle.close > zone.high)
    || (winner === 'SELL' && candle.close < candle.open && candle.close < zone.low);

  return {
    status: passed ? 'PASS' : 'FAIL',
    passed,
    detail: passed
      ? `Body close confirms ${winner} reaction beyond FVG boundary`
      : 'Body close did not confirm the winning side',
  };
}

function evaluateVolumeConfirmation(
  candles: readonly Candle[],
  options: Required<IctVolumeConfirmationOptions>,
): IctReactionCheck {
  if (!options.enabled) {
    return {
      status: 'NOT_EVALUATED',
      passed: false,
      detail: 'Volume confirmation disabled',
    };
  }

  const latest = candles[candles.length - 1];
  const prior = candles.slice(Math.max(0, candles.length - 1 - options.lookback), candles.length - 1);

  if (!latest || prior.length === 0) {
    return {
      status: 'FAIL',
      passed: false,
      detail: 'Not enough prior candles for volume confirmation',
    };
  }

  const averageVolume = prior.reduce((sum, c) => sum + c.volume, 0) / prior.length;
  const required = averageVolume * options.multiplier;
  const passed = latest.volume >= required;

  return {
    status: passed ? 'PASS' : 'FAIL',
    passed,
    detail: passed
      ? `Latest volume ${formatNumber(latest.volume)} met required ${formatNumber(required)}`
      : `Latest volume ${formatNumber(latest.volume)} did not meet required ${formatNumber(required)}`,
  };
}

function buildReasons(
  tier: TierEvaluation,
  winner: IctReactionWinner,
  score: number,
  volumeOptions: Required<IctVolumeConfirmationOptions>,
  volumePassed: boolean,
): string[] {
  const reasons: string[] = [`Reaction tier ${tier.tier} (score ${score})`];
  if (tier.midpointResult !== 'NOT_EVALUATED') {
    reasons.push(`Midpoint observed ${tier.midpointResult.toLowerCase()} but not scored`);
  }
  if (tier.boundaryCloseResult !== 'NEUTRAL' && tier.boundaryCloseResult !== 'NOT_EVALUATED') {
    reasons.push(`Boundary close ${tier.boundaryCloseResult.toLowerCase()}`);
  }
  if (tier.displacementReaction !== 'NONE') {
    reasons.push(`Displacement candle closed ${tier.displacementReaction.toLowerCase()} beyond boundary`);
  }
  reasons.push(`Reaction winner ${winner}`);
  if (volumeOptions.enabled) {
    reasons.push(volumePassed ? 'Volume confirmed' : 'Volume did not confirm');
  }
  if (volumeOptions.requiredForOutput && !volumePassed) {
    reasons.push('Volume confirmation was required for output and did not pass');
  }
  return reasons;
}

function noReaction(
  input: IctReactionInput,
  latestCandle: Candle | null,
  reason: string,
): IctReactionResult {
  const failedCheck: IctReactionCheck = {
    status: 'FAIL',
    passed: false,
    detail: reason,
  };
  const notEvaluatedCheck: IctReactionCheck = {
    status: 'NOT_EVALUATED',
    passed: false,
    detail: 'Not evaluated',
  };

  return {
    zoneId: input.zone.id,
    zoneDirection: input.zone.direction,
    reaction: 'NO_REACTION',
    output: 'NONE',
    confidence: 0,
    currentPrice: input.currentPrice,
    evaluatedAt: latestCandle?.timestamp.toISOString() ?? null,
    checks: {
      returnToZone: failedCheck,
      midpointInteraction: notEvaluatedCheck,
      bodyCloseConfirmation: notEvaluatedCheck,
      volumeConfirmation: notEvaluatedCheck,
    },
    reasons: [reason],
    reactionType: 'NONE',
    midpointResult: 'NOT_EVALUATED',
    boundaryCloseResult: 'NOT_EVALUATED',
    displacementReaction: 'NONE',
    reactionWinner: 'NONE',
    reactionScore: 0,
  };
}

function makeCheck(passed: boolean, detail: string): IctReactionCheck {
  return {
    status: passed ? 'PASS' : 'FAIL',
    passed,
    detail,
  };
}

function mergeVolumeOptions(options: IctReactionOptions | undefined): Required<IctVolumeConfirmationOptions> {
  return { ...DEFAULT_VOLUME_OPTIONS, ...(options?.volume ?? {}) };
}

function mergeDisplacementOptions(options: IctReactionOptions | undefined): Required<IctDisplacementOptions> {
  return { ...DEFAULT_DISPLACEMENT_OPTIONS, ...(options?.displacement ?? {}) };
}

function isValidZone(zone: IctZoneBase): boolean {
  return typeof zone.id === 'string'
    && zone.id.length > 0
    && (zone.direction === 'BULLISH' || zone.direction === 'BEARISH')
    && Number.isFinite(zone.high)
    && Number.isFinite(zone.low)
    && Number.isFinite(zone.midpoint)
    && zone.high >= zone.low
    && zone.midpoint >= zone.low
    && zone.midpoint <= zone.high;
}

function isValidCandle(candle: Candle): boolean {
  return Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && Number.isFinite(candle.volume)
    && candle.high >= candle.low
    && candle.timestamp instanceof Date
    && !Number.isNaN(candle.timestamp.getTime());
}

function formatNumber(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

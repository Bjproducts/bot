import {
  IctSignalInput,
  IctSignalOptions,
  IctSignalResult,
} from './ictSignalTypes';

export const DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE = 75;

export function createIctSignal(input: IctSignalInput): IctSignalResult {
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
  const score = effectiveReactionScore(input);

  if (winner !== 'BUY' && winner !== 'SELL') {
    return noneSignal(
      input,
      minConfidence,
      evaluatedAt,
      `Reaction winner is ${winner}`,
    );
  }

  if (score < minConfidence) {
    return noneSignal(
      input,
      minConfidence,
      evaluatedAt,
      `Reaction score ${formatNumber(score)} is below minimum ${formatNumber(minConfidence)}`,
    );
  }

  const attribution = confidenceAttribution(input);
  const reason = attribution
    ? `Reaction winner ${winner} met score threshold; ${attribution}`
    : `Reaction winner ${winner} met score threshold`;
  return signal(input, minConfidence, evaluatedAt, winner, reason, score);
}

export const evaluateIctSignal = createIctSignal;

function signal(
  input: IctSignalInput,
  minConfidence: number,
  evaluatedAt: string,
  action: 'BUY' | 'SELL',
  reason: string,
  confidence: number,
): IctSignalResult {
  return {
    signal: action,
    confidence,
    reason,
    sourceZoneType: input.zone.type,
    zoneId: input.zone.id,
    reactionOutput: input.reaction.output,
    minConfidence,
    evaluatedAt,
  };
}

function noneSignal(
  input: IctSignalInput,
  minConfidence: number,
  evaluatedAt: string,
  reason: string,
): IctSignalResult {
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

function effectiveReactionScore(input: IctSignalInput): number {
  const override = input.zone.type === 'IFVG' ? input.zone.confidenceOverride : undefined;
  if (Number.isFinite(override)) {
    return Math.max(input.reaction.reactionScore, Math.min(100, Math.max(0, override as number)));
  }
  return input.reaction.reactionScore;
}

function confidenceAttribution(input: IctSignalInput): string {
  if (input.zone.type !== 'IFVG') return '';
  return input.zone.confidenceAttribution ?? '';
}

function normalizeMinConfidence(options: IctSignalOptions | undefined): number {
  const value = options?.minConfidence ?? DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE;
  if (!Number.isFinite(value)) return DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE;
  return Math.min(100, Math.max(0, value));
}

function formatNumber(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

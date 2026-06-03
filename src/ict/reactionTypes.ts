import { Candle } from '../signals/types';
import { FVGZone, IFVGZone, IctZoneBase } from './types';

export type IctReactionZone = FVGZone | IFVGZone | IctZoneBase;
export type IctReactionOutput = 'BUY' | 'SELL' | 'NONE';
export type IctReactionKind = 'BULLISH_REACTION' | 'BEARISH_REACTION' | 'NO_REACTION';
export type IctReactionCheckStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

// Phase 5f — reaction tier vocabulary. The engine determines which tier the
// price action achieved and which side (BUY/SELL) won that reaction. The bot
// uses reactionWinner + reactionScore (not output/confidence alone) when
// deciding to enter.
export type IctReactionTier =
  | 'NONE'           // candle did not touch the zone
  | 'TOUCH'          // touched zone but did not include midpoint
  | 'MIDPOINT'       // candle range included midpoint; close picked a side
  | 'BOUNDARY'       // close crossed the opposite/aligned zone boundary
  | 'DISPLACEMENT';  // displacement candle closed beyond the boundary

export type IctReactionWinner = 'BUY' | 'SELL' | 'NONE' | 'CONTESTED';

export type IctReactionMidpointResult = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NOT_EVALUATED';
export type IctReactionBoundaryResult = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NOT_EVALUATED';
export type IctReactionDisplacementResult = 'BULLISH' | 'BEARISH' | 'NONE';

export interface IctVolumeConfirmationOptions {
  enabled?: boolean;
  lookback?: number;
  multiplier?: number;
  requiredForOutput?: boolean;
}

export interface IctDisplacementOptions {
  enabled?: boolean;
  lookback?: number;
  bodyToRangeMin?: number;
  rangeMultiplier?: number;
}

export interface IctReactionOptions {
  volume?: IctVolumeConfirmationOptions;
  displacement?: IctDisplacementOptions;
}

export interface IctReactionInput {
  zone: IctReactionZone;
  candles: readonly Candle[];
  currentPrice: number;
  options?: IctReactionOptions;
}

export interface IctReactionCheck {
  status: IctReactionCheckStatus;
  passed: boolean;
  detail: string;
}

export interface IctReactionChecks {
  returnToZone: IctReactionCheck;
  midpointInteraction: IctReactionCheck;
  bodyCloseConfirmation: IctReactionCheck;
  volumeConfirmation: IctReactionCheck;
}

export interface IctReactionResult {
  zoneId: string;
  zoneDirection: IctZoneBase['direction'];
  reaction: IctReactionKind;
  output: IctReactionOutput;
  confidence: number;
  currentPrice: number;
  evaluatedAt: string | null;
  checks: IctReactionChecks;
  reasons: string[];
  // Phase 5f tier fields. reactionWinner + reactionScore are canonical;
  // output + confidence are derived aliases kept for back-compat with the
  // signal/selection/attribution consumers that pre-date the tier model.
  reactionType: IctReactionTier;
  midpointResult: IctReactionMidpointResult;
  boundaryCloseResult: IctReactionBoundaryResult;
  displacementReaction: IctReactionDisplacementResult;
  reactionWinner: IctReactionWinner;
  reactionScore: number;
}

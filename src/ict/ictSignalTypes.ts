import { Candle } from '../signals/types';
import { FVGZone, IFVGZone } from './types';
import { IctReactionResult } from './reactionTypes';

export type IctSignalAction = 'BUY' | 'SELL' | 'NONE';
export type IctSignalZone = FVGZone | IFVGZone;

export interface IctSignalOptions {
  minConfidence?: number;
}

export interface IctSignalContext {
  candles?: readonly Candle[];
  evaluatedAt?: string;
}

export interface IctSignalInput {
  zone: IctSignalZone;
  reaction: IctReactionResult;
  context?: IctSignalContext;
  options?: IctSignalOptions;
}

export interface IctSignalResult {
  signal: IctSignalAction;
  confidence: number;
  reason: string;
  sourceZoneType: IctSignalZone['type'];
  zoneId: string;
  reactionOutput: IctReactionResult['output'];
  minConfidence: number;
  evaluatedAt: string;
}

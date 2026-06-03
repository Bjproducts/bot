import { Candle } from '../signals/types';

export type IctZoneDirection = 'BULLISH' | 'BEARISH';

export interface IctZoneBase {
  id: string;
  direction: IctZoneDirection;
  high: number;
  low: number;
  midpoint: number;
  createdAt: string;
  invalidated: boolean;
  filled: boolean;
  flipped: boolean;
}

export interface FVGZone extends IctZoneBase {
  type: 'FVG';
  candle1Index: number;
  candle2Index: number;
  candle3Index: number;
}

export interface IFVGZone extends IctZoneBase {
  type: 'IFVG';
  sourceFvgId: string;
  inversionCandleIndex: number;
  parentFvgId?: string;
  parentFvgRespected?: boolean;
  confidenceOverride?: number;
  confidenceAttribution?: string;
}

export interface DetectionResult<TZone extends IctZoneBase> {
  zones: TZone[];
  logPath: string;
}

export type IctCandle = Candle;

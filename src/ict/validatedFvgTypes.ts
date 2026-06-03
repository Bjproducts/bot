import { Candle } from '../signals/types';
import { FVGZone, IctZoneDirection } from './types';

export type ValidatedFvgCheckStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED';
export type LiquiditySide = 'BUY_SIDE' | 'SELL_SIDE';
export type PremiumDiscountContext = 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' | 'UNKNOWN';

export interface ValidatedFvgCheck {
  status: ValidatedFvgCheckStatus;
  passed: boolean;
  detail: string;
}

export interface LiquiditySweepCheck extends ValidatedFvgCheck {
  sweptSide: LiquiditySide | null;
  sweepCandleIndex: number | null;
  referenceLevel: number | null;
  sweepPrice: number | null;
}

export interface DisplacementCheck extends ValidatedFvgCheck {
  displacementCandleIndex: number | null;
  bodyToRangePercent: number | null;
  rangeMultiple: number | null;
}

export interface MarketStructureShiftCheck extends ValidatedFvgCheck {
  mssCandleIndex: number | null;
  referenceLevel: number | null;
  breakPrice: number | null;
}

export interface PremiumDiscountCheck extends ValidatedFvgCheck {
  context: PremiumDiscountContext;
  equilibrium: number | null;
}

export interface SessionFilterCheck extends ValidatedFvgCheck {
  sessionHourUtc: number | null;
}

export interface ValidatedFvgValidation {
  accepted: boolean;
  rawFvgId: string;
  direction: IctZoneDirection;
  liquiditySweep: LiquiditySweepCheck;
  displacement: DisplacementCheck;
  marketStructureShift: MarketStructureShiftCheck;
  premiumDiscount: PremiumDiscountCheck;
  sessionFilter: SessionFilterCheck;
  rejectionReasons: string[];
}

export interface ValidatedFVGZone extends FVGZone {
  validated: true;
  validation: ValidatedFvgValidation;
}

export interface FvgValidationResult {
  rawFvg: FVGZone;
  accepted: boolean;
  zone: ValidatedFVGZone | null;
  validation: ValidatedFvgValidation;
}

export interface PremiumDiscountOptions {
  enabled?: boolean;
  lookback?: number;
  requireCorrectContext?: boolean;
}

export interface SessionFilterOptions {
  enabled?: boolean;
  allowedUtcHours?: readonly number[];
}

export interface ValidatedFvgOptions {
  liquidityLookback?: number;
  marketStructureLookback?: number;
  displacementBodyToRangeMin?: number;
  displacementRangeMultiplier?: number;
  premiumDiscount?: PremiumDiscountOptions;
  sessionFilter?: SessionFilterOptions;
}

export interface NormalizedValidatedFvgOptions {
  liquidityLookback: number;
  marketStructureLookback: number;
  displacementBodyToRangeMin: number;
  displacementRangeMultiplier: number;
  premiumDiscount: Required<PremiumDiscountOptions>;
  sessionFilter: {
    enabled: boolean;
    allowedUtcHours: readonly number[];
  };
}

export interface ValidatedFvgDetectorInput {
  candles: readonly Candle[];
  options?: ValidatedFvgOptions;
}

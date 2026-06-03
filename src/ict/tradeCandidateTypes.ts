import type { IctReactionResult } from './reactionTypes';
import type { IctSignalAction, IctSignalResult, IctSignalZone } from './ictSignalTypes';
import type { ExitTargetMode, ManagedTarget, TargetSelectionResult } from '../risk/targetSelection';

export type TradeCandidateTargetFit = 'BELOW_MINIMUM' | 'PREFERRED_RANGE' | 'EXTENDED_TARGET';
export type TradeCandidateStatus = 'SELECTED' | 'QUALIFIED' | 'REJECTED';
export type StopSource =
  | 'zoneLow'
  | 'zoneHigh'
  | 'firstCandleLow'
  | 'firstCandleHigh'
  | 'displacementOrigin'
  | 'IFVGOrigin'
  | 'swingLow'
  | 'swingHigh';

export interface TradeSelectionEvaluationInput {
  zone: IctSignalZone;
  signal: IctSignalResult;
  reaction?: IctReactionResult;
  // Phase 5h: when the bot pre-computes target selection per zone, it
  // passes the result here so the selector can rank candidates by their
  // real RR / expected profit / distance penalty.
  targetSelection?: TargetSelectionResult | null;
  stopPrice?: number | null;
  stopSource?: StopSource | null;
}

export interface TradeSelectionOptions {
  minConfidence?: number;
  minExpectedProfitUsd?: number;
  preferredMinProfitUsd?: number;
  preferredMaxProfitUsd?: number;
  // Phase 5h additions for probability-driven ranking.
  minRiskRewardRatio?: number;
  exitTargetMode?: ExitTargetMode;
  // Current bar index in the bot's candle buffer; used for zone freshness.
  currentBarIndex?: number;
}

export interface TradeSelectionInput {
  evaluations: readonly TradeSelectionEvaluationInput[];
  currentPrice: number;
  orderSizeUsd: number;
  takeProfitPct: number;
  options?: TradeSelectionOptions;
  evaluatedAt?: string;
}

export interface TradeCandidate {
  signal: IctSignalResult;
  zone: IctSignalZone;
  reaction?: IctReactionResult;
  signalDirection: IctSignalAction;
  zoneType: IctSignalZone['type'];
  zoneId: string;
  expectedProfitAtTPUsd: number;
  distanceToTPPercent: number;
  distanceToInvalidationPercent: number | null;
  confidence: number;
  reason: string;
  score: number;
  targetFit: TradeCandidateTargetFit;
  extendedTarget: boolean;
  status: TradeCandidateStatus;
  rejectionReason: string;
  reactionConfirmed: boolean;
  volumeConfirmed: boolean;

  // Phase 5h: probability-driven ranking fields.
  targetReachProbability: number;       // 0..100, primary ranking key
  expectedTimeToTargetEstimate: number; // estimated candles to reach target (rough heuristic)
  reactionTierScore: number;            // 0..30 (DISPLACEMENT=30, BOUNDARY=22, MIDPOINT=8, TOUCH/NONE=0)
  displacementScore: number;            // 0..20 from FVG validation rangeMultiple (capped)
  rrFitScore: number;                   // 0..20 RR vs minRR fit
  scalpTargetFitScore: number;          // 0..25 expectedProfit fit to preferred $ band
  zoneFreshnessScore: number;           // 0..15 zone age vs current bar index
  targetDistancePenalty: number;        // 0..30, subtracted from probability

  // Phase 5h: real-target context (when targetSelection was provided).
  targetSelection: TargetSelectionResult | null;
  managedTarget: ManagedTarget | null;
  entryPrice: number;
  stopPrice: number | null;
  stopSource: StopSource | null;
  riskDistance: number | null;
  zoneSize: number;
  realExpectedProfitUsd: number | null;
  realExpectedLossUsd: number | null;
  realRiskRewardRatio: number | null;
}

export interface TradeSelectionResult {
  action: IctSignalAction;
  selectedCandidate: TradeCandidate | null;
  candidates: TradeCandidate[];
  candidatesEvaluated: number;
  rejectionReason: string;
  evaluatedAt: string;
}

import { PositionCloseReason } from '../positionExitTypes';
import { StopSource } from '../ict/tradeCandidateTypes';

export type ScoreComponentKey =
  | 'liquiditySweepScore'
  | 'displacementScore'
  | 'mssScore'
  | 'fvgQualityScore'
  | 'ifvgBonus'
  | 'targetFitScore'
  | 'reactionScore'
  | 'premiumDiscountScore'
  | 'sessionScore'
  | 'confidenceScore'
  // Phase 5h descriptive components — stored on breakdown but excluded
  // from the renormalization sum so the legacy `finalScore` invariant
  // remains intact.
  | 'targetReachProbability'
  | 'reactionTierScore'
  | 'rrFitScore'
  | 'scalpTargetFitScore'
  | 'targetDistancePenalty'
  | 'zoneFreshnessScore';

export interface ScoreBreakdown {
  liquiditySweepScore: number;
  displacementScore: number;
  mssScore: number;
  fvgQualityScore: number;
  ifvgBonus: number;
  targetFitScore: number;
  reactionScore: number;
  premiumDiscountScore: number;
  sessionScore: number;
  confidenceScore: number;
  // Phase 5h descriptive fields (not included in componentTotal):
  targetReachProbability: number;
  reactionTierScore: number;
  rrFitScore: number;
  scalpTargetFitScore: number;
  targetDistancePenalty: number;
  zoneFreshnessScore: number;
}

export interface ScoreAttribution {
  breakdown: ScoreBreakdown;
  finalScore: number;
  componentTotal: number;
  normalizedMultiplier: number;
  rows: ScoreAttributionRow[];
}

export interface ScoreAttributionRow {
  key: ScoreComponentKey;
  label: string;
  value: number;
}

export interface ScoreOutcomeRecord {
  tradeId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryTimestamp: string;
  exitTimestamp: string;
  finalScore: number;
  scoreBreakdown: ScoreBreakdown;
  win: boolean;
  realizedPnlUsd: number;
  tradeDurationMinutes: number;
  exitReason: PositionCloseReason;
  targetReachProbability: number;
  entryPrice: number;
  stopPrice: number | null;
  riskDistance: number | null;
  zoneSize: number | null;
  stopSource: StopSource | null;
}

// Phase 5h: win-rate / PnL grouped by predicted probability buckets so we
// can verify whether targetReachProbability actually predicts outcomes.
export type ProbabilityBucketKey = '0-49' | '50-69' | '70-84' | '85-100';

export interface ProbabilityBucketAnalytics {
  bucket: ProbabilityBucketKey;
  range: [number, number];
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlUsd: number;
  avgProbability: number;
}

export interface FactorAnalytics {
  factor: string;
  componentKey: ScoreComponentKey;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlUsd: number;
  avgScore: number;
}

export interface ScoreAttributionReport {
  generatedAt: string;
  totalTrades: number;
  factors: FactorAnalytics[];
  topPerformingFactors: FactorAnalytics[];
  strongestCorrelations: FactorAnalytics[];
  outcomes: ScoreOutcomeRecord[];
  probabilityBuckets: ProbabilityBucketAnalytics[];
}

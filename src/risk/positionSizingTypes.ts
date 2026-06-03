export type PositionSizingSignal = 'BUY' | 'SELL';
export type PositionSizingStatus = 'ACCEPTED' | 'REJECTED';
export type PositionSizingMode = 'PROFIT_FIRST' | 'RISK_FIRST';

export interface PositionSizingConfig {
  positionSizingMode?: PositionSizingMode;
  targetProfitMinUsd: number;
  targetProfitMaxUsd: number;
  maxRiskPerTradeUsd: number;
  minPositionUsd: number;
  maxPositionUsd: number;
  // Phase 5g: minimum risk/reward gate is now config-driven so HYBRID mode
  // and sizing share a single source of truth.
  minRiskRewardRatio?: number;
  targetRMultiple?: number;
}

export interface PositionSizingInput {
  signal: PositionSizingSignal;
  confidence: number;
  selectionScore: number;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  config: PositionSizingConfig;
}

export interface PositionSizingResult {
  status: PositionSizingStatus;
  rejectionReason: string;
  signal: PositionSizingSignal;
  confidence: number;
  selectionScore: number;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  expectedMovePercent: number;
  rewardDistance: number;
  riskDistance: number;
  riskRewardRatio: number;
  recommendedPositionSizeUsd: number;
  expectedProfitUsd: number;
  expectedLossUsd: number;
  confidenceMultiplier: number;
  scoreMultiplier: number;
  sizingMode: PositionSizingMode;
  targetRMultiple: number;
  riskUtilizationPercent: number;
  riskUtilizationWarning: boolean;
  hardStopPrice: number;
  resolvedTargetPrice: number;
}

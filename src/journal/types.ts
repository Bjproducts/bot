import { PositionCloseReason } from '../positionExitTypes';
import { EntryZoneDirection, EntryZoneType } from '../types';
import { ScoreBreakdown } from '../analytics/scoreAttributionTypes';
import { StopSource } from '../ict/tradeCandidateTypes';

export type TradeAction = 'ENTRY' | 'DCA' | 'BREAKEVEN_ACTIVATED' | PositionCloseReason;

export interface TradeEvent {
  timestamp: string;
  symbol: string;
  marketDataSource: string;
  action: TradeAction;
  side: 'LONG' | 'SHORT';
  price: number;
  size: number;
  investedUsd: number;
  avgEntry: number;
  dcaCount: number;
  realizedPnlUsd: number;
  signalDirection: string;
  signalSource: string;
  ictSignal?: string;
  ictConfidence?: number;
  ictZoneId?: string;
  ictZoneType?: string;
  ictReason?: string;
  entryZoneId?: string;
  entryZoneType?: EntryZoneType;
  entryZoneHigh?: number;
  entryZoneLow?: number;
  entryZoneMidpoint?: number;
  entryZoneDirection?: EntryZoneDirection;
  entryZoneRespected?: boolean;
  targetPrice?: number;
  targetSource?: string;
  targetZoneId?: string;
  targetDisrespected?: boolean;
  stopAtBreakeven?: boolean;
  breakevenActivated?: boolean;
  breakevenActivationPrice?: number;
  breakevenActivationTime?: string;
  positionSizeUsd?: number;
  sizingMode?: string;
  hardStopPrice?: number;
  entryPrice?: number;
  stopPrice?: number;
  riskDistance?: number;
  zoneSize?: number;
  stopSource?: StopSource;
  expectedProfitUsd?: number;
  expectedLossUsd?: number;
  riskRewardRatio?: number;
  riskUtilizationPercent?: number;
  targetRMultiple?: number;
  selectionScore?: number;
  scoreBreakdown?: ScoreBreakdown;
  scoreFinal?: number;
  // Phase 5h: discrete copy of the candidate's targetReachProbability so
  // the report can bucket without requiring a full breakdown.
  targetReachProbability?: number;
  reactionTier?: string;
  disrespectCandleClose?: number;
  zoneBoundaryViolated?: 'HIGH' | 'LOW';
  tradeDurationMinutes?: number;
}

export interface CompletedTrade {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  marketDataSource: string;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  avgEntryPrice: number;
  exitPrice: number;
  dcaCount: number;
  totalInvestedUsd: number;
  realizedPnlUsd: number;
  pnlPct: number;
  reason: PositionCloseReason;
  entryZoneId?: string;
  entryZoneType?: EntryZoneType;
  entryZoneHigh?: number;
  entryZoneLow?: number;
  entryZoneMidpoint?: number;
  entryZoneDirection?: EntryZoneDirection;
  entryZoneRespected?: boolean;
  targetPrice?: number;
  targetSource?: string;
  targetZoneId?: string;
  targetDisrespected?: boolean;
  stopAtBreakeven?: boolean;
  breakevenActivated?: boolean;
  breakevenActivationPrice?: number;
  breakevenActivationTime?: string;
  positionSizeUsd?: number;
  sizingMode?: string;
  hardStopPrice?: number;
  stopPrice?: number;
  riskDistance?: number;
  zoneSize?: number;
  stopSource?: StopSource;
  expectedProfitUsd?: number;
  expectedLossUsd?: number;
  riskRewardRatio?: number;
  riskUtilizationPercent?: number;
  targetRMultiple?: number;
  selectionScore?: number;
  scoreBreakdown?: ScoreBreakdown;
  scoreFinal?: number;
  targetReachProbability?: number;
  reactionTier?: string;
  disrespectCandleClose?: number;
  zoneBoundaryViolated?: 'HIGH' | 'LOW';
  tradeDurationMinutes?: number;
}

export const CSV_HEADER = [
  'timestamp',
  'symbol',
  'marketDataSource',
  'action',
  'side',
  'price',
  'size',
  'investedUsd',
  'avgEntry',
  'dcaCount',
  'realizedPnlUsd',
  'signalDirection',
  'signalSource',
  'ictSignal',
  'ictConfidence',
  'ictZoneId',
  'ictZoneType',
  'ictReason',
  'entryZoneId',
  'entryZoneType',
  'entryZoneHigh',
  'entryZoneLow',
  'entryZoneMidpoint',
  'entryZoneDirection',
  'entryZoneRespected',
  'targetPrice',
  'targetSource',
  'targetZoneId',
  'targetDisrespected',
  'stopAtBreakeven',
  'breakevenActivated',
  'breakevenActivationPrice',
  'breakevenActivationTime',
  'positionSizeUsd',
  'sizingMode',
  'hardStopPrice',
  'entryPrice',
  'stopPrice',
  'riskDistance',
  'zoneSize',
  'stopSource',
  'expectedProfitUsd',
  'expectedLossUsd',
  'riskRewardRatio',
  'riskUtilizationPercent',
  'targetRMultiple',
  'selectionScore',
  'scoreBreakdown',
  'scoreFinal',
  'targetReachProbability',
  'reactionTier',
  'disrespectCandleClose',
  'zoneBoundaryViolated',
  'tradeDurationMinutes',
].join(',');

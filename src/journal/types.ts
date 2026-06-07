import { PositionCloseReason } from '../positionExitTypes';
import { EntryZoneDirection, EntryZoneType } from '../types';
import { ScoreBreakdown } from '../analytics/scoreAttributionTypes';
import { StopSource } from '../ict/tradeCandidateTypes';
import type { SessionGuardEventType, SessionGuardStatus } from '../risk/sessionGuard';

export type TradeAction =
  | 'ENTRY'
  | 'DCA'
  | 'BREAKEVEN_ACTIVATED'
  | 'PARTIAL_CLOSE'
  | 'PARTIAL_CLOSE_SKIPPED'
  | 'OPPOSITE_SIGNAL_BE_PROTECTION'
  | SessionGuardEventType
  | PositionCloseReason;

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
  positionId?: string;
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
  activeStopPrice?: number;
  unrealizedPnlUsd?: number;
  partialCloseDone?: boolean;
  partialClosePrice?: number;
  partialCloseTime?: string;
  partialCloseFraction?: number;
  realizedPartialPnlUsd?: number;
  remainingSizeAfterPartial?: number;
  finalRunnerPnlUsd?: number;
  totalPnlUsd?: number;
  maxFavorableExcursionUsd?: number;
  maxAdverseExcursionUsd?: number;
  positionSizeUsd?: number;
  sizingMode?: string;
  hardStopPrice?: number;
  entryPrice?: number;
  stopPrice?: number;
  riskDistance?: number;
  zoneSize?: number;
  stopSource?: StopSource;
  stopModel?: string;
  originalStopPrice?: number;
  tightStopPrice?: number;
  selectedStopPrice?: number;
  stopTightened?: boolean;
  stopTighteningReason?: string;
  oppositeSignalProtected?: boolean;
  oldSide?: string;
  newSignalSide?: string;
  activeStopBefore?: number;
  activeStopAfter?: number;
  protectionReason?: string;
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
  guardStatus?: SessionGuardStatus;
  pauseStartedAt?: string;
  pauseEndsAt?: string;
  consecutiveLosses?: number;
  rollingWindowTrades?: number;
  rollingWinRate?: number | null;
  rollingPnlUsd?: number | null;
  dailyRealizedPnlUsd?: number;
  maxDailyLossUsd?: number;
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
  positionId?: string;
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
  activeStopPrice?: number;
  unrealizedPnlUsd?: number;
  partialCloseDone?: boolean;
  partialClosePrice?: number;
  partialCloseTime?: string;
  partialCloseFraction?: number;
  realizedPartialPnlUsd?: number;
  remainingSizeAfterPartial?: number;
  finalRunnerPnlUsd?: number;
  totalPnlUsd?: number;
  maxFavorableExcursionUsd?: number;
  maxAdverseExcursionUsd?: number;
  positionSizeUsd?: number;
  sizingMode?: string;
  hardStopPrice?: number;
  stopPrice?: number;
  riskDistance?: number;
  zoneSize?: number;
  stopSource?: StopSource;
  stopModel?: string;
  originalStopPrice?: number;
  tightStopPrice?: number;
  selectedStopPrice?: number;
  stopTightened?: boolean;
  stopTighteningReason?: string;
  oppositeSignalProtected?: boolean;
  oldSide?: string;
  newSignalSide?: string;
  activeStopBefore?: number;
  activeStopAfter?: number;
  protectionReason?: string;
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
  'positionId',
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
  'activeStopPrice',
  'unrealizedPnlUsd',
  'partialCloseDone',
  'partialClosePrice',
  'partialCloseTime',
  'partialCloseFraction',
  'realizedPartialPnlUsd',
  'remainingSizeAfterPartial',
  'finalRunnerPnlUsd',
  'totalPnlUsd',
  'maxFavorableExcursionUsd',
  'maxAdverseExcursionUsd',
  'positionSizeUsd',
  'sizingMode',
  'hardStopPrice',
  'entryPrice',
  'stopPrice',
  'riskDistance',
  'zoneSize',
  'stopSource',
  'stopModel',
  'originalStopPrice',
  'tightStopPrice',
  'selectedStopPrice',
  'stopTightened',
  'stopTighteningReason',
  'oppositeSignalProtected',
  'oldSide',
  'newSignalSide',
  'activeStopBefore',
  'activeStopAfter',
  'protectionReason',
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

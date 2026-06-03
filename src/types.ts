import { Signal } from './signals/types';
import { IctSignalResult } from './ict/ictSignalTypes';
import { TradeSelectionResult } from './ict/tradeCandidateTypes';
import { PositionCloseReason, PositionExitEvaluation } from './positionExitTypes';
import { PositionSizingResult } from './risk/positionSizingTypes';
import { ScoreAttribution } from './analytics/scoreAttributionTypes';
import { ExitTargetMode, ManagedTargetSource, TargetSelectionResult } from './risk/targetSelection';
import { ValidatedFvgRejectionSummary } from './ict/validatedFvgRejectionLog';

// ─── Re-export Candle so the rest of the app imports from one place ───────────
export type { Candle } from './signals/types';
export type { ExitTargetMode, ManagedTargetSource, TargetSelectionResult } from './risk/targetSelection';

export type SignalSource = 'VOLUME_SPIKE' | 'ICT' | 'NONE';
export type MarketDataSourceName = 'SIMULATOR' | 'REAL_PUBLIC' | 'NASDAQ_PUBLIC';
export type BotMode = 'simulation' | 'paper_live' | 'live';
export type EntryZoneType = 'FVG' | 'IFVG';
export type EntryZoneDirection = 'BULLISH' | 'BEARISH';
export type PositionSizingMode = 'PROFIT_FIRST' | 'RISK_FIRST';

// ─── Position state (persisted to position-state.json) ───────────────────────

export interface PositionState {
  id:                 string | null;
  activePositionSize: number;
  averageEntryPrice:  number;
  totalUsdInvested:   number;
  side:               'LONG' | 'SHORT' | 'NONE';
  dcaCount:           number;
  lastDcaPrice:       number;
  openedAt:           string | null;
  entryZoneId:        string | null;
  entryZoneType:      EntryZoneType | null;
  entryZoneHigh:      number | null;
  entryZoneLow:       number | null;
  entryZoneMidpoint:  number | null;
  entryZoneDirection: EntryZoneDirection | null;
  entryZoneRespected: boolean | null;
  targetPrice:        number | null;
  targetSource:       ManagedTargetSource | null;
  targetZoneId:       string | null;
  targetZoneType:     EntryZoneType | null;
  targetZoneHigh:     number | null;
  targetZoneLow:      number | null;
  targetZoneDirection: EntryZoneDirection | null;
  targetDisrespected: boolean | null;
  stopAtBreakeven:    boolean;
  stopMovedToBreakevenAt: string | null;
  hardStopPrice:      number | null;
  hardStopEnabled:    boolean;
  positionSizeUsd:    number | null;
  expectedProfitUsd:  number | null;
  expectedLossUsd:    number | null;
  riskRewardRatio:    number | null;
  sizingMode:         PositionSizingMode | null;
  riskUtilizationPercent: number | null;
  riskUtilizationWarning: boolean | null;
  targetRMultiple:    number | null;
  expectedMovePercent: number | null;
  selectionScore:     number | null;
  scoreAttribution:   ScoreAttribution | null;
  openPositions?:     PositionState[];
}

// ─── Session stats (persisted to session-stats.json) ─────────────────────────

export interface SessionStats {
  startedAt:       string;
  updatedAt:       string;
  symbol:          string;
  side:            'LONG' | 'SHORT';
  dataSource:      string;   // shown in dashboard

  ticks:           number;
  completedTrades: number;
  wins:            number;
  losses:          number;

  realizedPnlUsd:   number;
  unrealizedPnlUsd: number;

  currentDrawdownUsd: number;
  maxDrawdownUsd:     number;
  maxCapitalUsed:     number;

  sessionEquity:   number;
  latestSignal:    Signal | null;
  latestIctSignal: IctSignalResult | null;
  latestTradeSelection: TradeSelectionResult | null;
  latestPositionExit: PositionExitEvaluation | null;
  latestPositionSizing: PositionSizingResult | null;
  latestTargetSelection: TargetSelectionResult | null;
  latestFvgRejectionSummary: ValidatedFvgRejectionSummary | null;
  latestCloseReason: PositionCloseReason | null;
  signalsFired:    number;
  ictEvaluations:  number;
  ictBuyCount:     number;
  ictSellCount:    number;
  ictNoneCount:    number;
  ictAccepted:     number;
  ictRejected:     number;

  // Phase 5d candle buffer integrity counters.
  gapResets:       number;
  lastGapSeconds:  number | null;

  // Calendar-day counters (reset when calendar date changes)
  todayDate:       string;   // 'YYYY-MM-DD' of the running calendar day
  todayPnlUsd:     number;
  todayTrades:     number;

  liveTradingEnabled: boolean;
  exchangeName: string;
  liveArmed: boolean;
  dailyLiveTrades: number;
  dailyLivePnlUsd: number;
  maxDailyLossUsd: number;
  lastLiveOrderStatus: string | null;
  positionSizingSamples: number;
  totalPositionSizeUsd: number;
  totalExpectedProfitUsd: number;
  totalExpectedLossUsd: number;
  positionSizeDistribution: {
    small: number;
    medium: number;
    large: number;
  };
}

// ─── Bot config (loaded from .env, simulation-only) ──────────────────────────

export interface BotConfig {
  botMode: BotMode;
  signalSource: SignalSource;

  // Data source
  marketDataSource: MarketDataSourceName;
  // Phase 5e: REAL_PUBLIC host is configurable so the bot can fall back to
  // the read-only mirror (data-api.binance.vision) when api.binance.com is
  // blocked by region (e.g. AWS Lightsail us-east-2 returns HTTP 451).
  realPublicHost: string;

  symbol: string;
  side:   'LONG' | 'SHORT';

  // Risk controls
  orderSizeUsd:  number;
  maxCapUsd:     number;
  takeProfitPct: number;
  dcaTriggerPct: number;
  profitTargetUsdMin: number;
  profitTargetUsdMax: number;
  maxPositionMinutes: number;
  maxLossUsd: number;
  allowMultiplePositions: boolean;
  maxConcurrentPositions: number;
  targetProfitMinUsd: number;
  targetProfitMaxUsd: number;
  maxRiskPerTradeUsd: number;
  minPositionUsd: number;
  maxPositionUsd: number;
  positionSizingMode: PositionSizingMode;
  hardStopEnabled: boolean;
  debugIctPipeline: boolean;

  // Exit target mode (Phase 5g)
  exitTargetMode: ExitTargetMode;
  targetRMultiple: number;
  minRiskRewardRatio: number;
  maxTargetDistancePercent: number;

  // Signal
  volumeLookback:        number;
  volumeSpikeMultiplier: number;
  reversalDropPercent:   number;

  // ICT signal engine
  ictMinConfidence: number;
  ictTradeOnIfvgFormation: boolean;
  ictTargetSwingLeft: number;
  ictTargetSwingRight: number;
  ictTargetFallbackLookback: number;
  tradingViewSymbol: string;

  // Live execution safety settings. These do not place orders by themselves.
  liveTradingEnabled: boolean;
  exchangeName: string;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  exchangeApiPassphrase: string;
  liveSymbol: string;
  liveOrderSizeUsd: number;
  maxLiveOrderSizeUsd: number;
  maxDailyLossUsd: number;
  maxDailyTrades: number;
  allowShorts: boolean;
  requireManualArm: boolean;
  liveArmConfirm: string;

  // Simulator tuning (used by SIMULATOR source; startPrice is also the
  // fallback initial price for REAL_PUBLIC before first fetch)
  startPrice:      number;
  tickIntervalMs:  number;
  priceVolatility: number;
  priceDrift:      number;
  baseVolume:      number;

  startingCapital: number;
}

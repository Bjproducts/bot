import * as fs from 'fs';
import * as path from 'path';
import { BotConfig, PositionState, SessionStats, Candle, TargetSelectionResult } from './types';
import { ManagedTarget, selectManagedTarget } from './risk/targetSelection';
import {
  emptyPositionState,
  loadOpenPositions,
  recordDcaEntry,
  saveOpenPositions,
} from './state';
import { IMarketDataSource } from './marketData/types';
import { evaluate as evalSignal } from './signals/volumeSpikeReversal';
import { Signal } from './signals/types';
import { TradeJournal } from './journal/tradeJournal';
import { TradeEvent, CompletedTrade } from './journal/types';
import { EntryZoneDisrespectEvaluation, PositionCloseReason } from './positionExitTypes';
import { evaluatePositionLifecycleExit } from './positionExitManager';
import { calculatePositionSizing } from './risk/positionSizing';
import { PositionSizingResult } from './risk/positionSizingTypes';
import { appendSizingRejection } from './risk/sizingRejectionLog';
import { createScoreAttribution } from './analytics/scoreAttribution';
import { generateScoreAttributionReports } from './analytics/tradeOutcomeAnalytics';
import { ScoreAttribution } from './analytics/scoreAttributionTypes';
import { detectIFVGs } from './ict/ifvgDetector';
import { detectFVGs } from './ict/fvgDetector';
import { detectValidatedFVGs, validateFVGs } from './ict/validatedFvgDetector';
import { ValidatedFVGZone } from './ict/validatedFvgTypes';
import { ValidatedFvgRejectionLog } from './ict/validatedFvgRejectionLog';
import {
  DEFAULT_MAX_GAP_SECONDS,
  appendGapResetEvent,
  clearIctStateForGap,
  detectCandleGap,
} from './ict/candleBufferGap';
import { evaluateReaction } from './ict/reactionEngine';
import { createIctSignal } from './ict/ictSignalEngine';
import { IctSignalResult, IctSignalZone } from './ict/ictSignalTypes';
import { selectTradeCandidate } from './ict/tradeSelectionEngine';
import { StopSource, TradeCandidate, TradeSelectionResult } from './ict/tradeCandidateTypes';
import { resolveStopAttribution } from './ict/stopAttribution';
import {
  IctSignalAuditLog,
  makeIctSignalAuditRecord,
  summarizeIctSignalAudit,
} from './ict/ictSignalAuditLog';
import {
  createSessionStats,
  updateUnrealized,
  recordClosedTrade,
  saveSessionStats,
} from './sessionStats';

type TradeSide = 'LONG' | 'SHORT';

interface EntryTrigger {
  side: TradeSide;
  signalDirection: string;
  detail: string;
  entryZone?: IctSignalZone;
  positionSizeUsd?: number;
  managedTarget?: ManagedTarget;
  sizing?: PositionSizingResult;
  scoreAttribution?: ScoreAttribution;
  stopSource?: StopSource | null;
  stopRiskDistance?: number | null;
  stopZoneSize?: number | null;
}

interface IctEvaluation {
  zone: IctSignalZone;
  signal: IctSignalResult;
  reaction: ReturnType<typeof evaluateReaction>;
  targetSelection: TargetSelectionResult | null;
  stopPrice: number | null;
  stopSource: StopSource | null;
}

const MAX_ICT_CANDLE_BUFFER = 500;
const ICT_PIPELINE_DEBUG_PATH = path.resolve(__dirname, '../logs/ict-pipeline-debug.log');

/**
 * Paper trading simulation loop.
 *
 * This engine records simulated entries, DCA fills, and closes only. It does
 * not contain wallet, private key, exchange order, or Nado integration logic.
 */
export class BotEngine {
  private position: PositionState;
  private positions: PositionState[] = [];
  private stats: SessionStats;
  private lastPrice: number;
  private tick: number = 0;
  private running: boolean = false;

  private candleBuffer: Candle[] = [];
  private ictCandleBuffer: Candle[] = [];
  private latestSignal: Signal | null = null;
  private latestIctSignal: IctSignalResult | null = null;
  private latestTradeSelection: TradeSelectionResult | null = null;
  private latestIctZones: IctSignalZone[] = [];
  private readonly ictSignalAuditLog = new IctSignalAuditLog();
  private readonly fvgRejectionLog = new ValidatedFvgRejectionLog();
  private lastIctPipelineDebugTick: number = 0;

  private tradeEntryTime: Date | null = null;
  private tradeEntryPrice: number = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly dataSource: IMarketDataSource,
    private readonly journal: TradeJournal,
  ) {
    this.positions = loadOpenPositions();
    this.position = this.aggregatePositions();
    if (this.positions.some(position => position.side !== 'NONE' && !position.openedAt)) {
      this.positions = this.positions.map(position => position.side !== 'NONE' && !position.openedAt
        ? { ...position, openedAt: new Date().toISOString() }
        : position);
      this.persistPositions();
    }
    this.stats = createSessionStats(config, dataSource.sourceName);
    this.lastPrice = config.startPrice;
    this.tradeEntryTime = this.position.openedAt ? new Date(this.position.openedAt) : null;
    this.tradeEntryPrice = this.position.averageEntryPrice;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
    saveSessionStats(this.stats);
  }

  snapshot(): {
    stats: SessionStats;
    position: PositionState;
    price: number;
    signal: Signal | null;
    ictSignal: IctSignalResult | null;
    tradeSelection: TradeSelectionResult | null;
  } {
    return {
      stats: this.stats,
      position: this.position,
      price: this.lastPrice,
      signal: this.latestSignal,
      ictSignal: this.latestIctSignal,
      tradeSelection: this.latestTradeSelection,
    };
  }

  private scheduleTick(): void {
    setTimeout(async () => {
      if (!this.running) return;
      try {
        await this.processTick();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  !  [${ts()}] Unhandled tick error: ${msg}`);
      }
      this.scheduleTick();
    }, this.config.tickIntervalMs);
  }

  private async processTick(): Promise<void> {
    const candle = await this.dataSource.nextCandle();
    this.lastPrice = this.dataSource.currentPrice();

    this.tick++;
    this.stats = { ...this.stats, ticks: this.tick };
    this.position = this.aggregatePositions();
    this.stats = this.updatePortfolioUnrealized(this.stats, this.lastPrice);

    if (candle !== null) {
      this.rememberCandle(candle);
      this.processConfiguredSignalSource();
    } else {
      this.debugIctPipeline('NO_NEW_CANDLE', {
        throttleTicks: 30,
      });
    }

    if (this.positions.length > 0) {
      this.managePositions(this.lastPrice, candle);
    }
    this.position = this.aggregatePositions();
  }

  private rememberCandle(candle: Candle): void {
    // Phase 5d: detect candle-stream gaps (laptop sleep, exchange outage,
    // process pause) BEFORE buffering the new candle. If the previous ICT
    // buffer entry is more than DEFAULT_MAX_GAP_SECONDS old vs the incoming
    // candle, clear every persistent ICT cache so analysis cannot bridge
    // the discontinuity.
    const lastIctCandle = this.ictCandleBuffer[this.ictCandleBuffer.length - 1] ?? null;
    const gap = detectCandleGap(lastIctCandle?.timestamp ?? null, candle.timestamp);
    if (gap.gapDetected) {
      const summary = clearIctStateForGap({
        ictCandleBuffer: this.ictCandleBuffer,
        latestIctZones: this.latestIctZones,
        latestTradeSelection: this.latestTradeSelection,
      });
      this.latestIctSignal = null;
      this.latestTradeSelection = null;
      this.stats = {
        ...this.stats,
        gapResets: this.stats.gapResets + 1,
        lastGapSeconds: gap.gapSeconds,
        latestIctSignal: null,
        latestTradeSelection: null,
        latestFvgRejectionSummary: null,
      };
      const event = {
        timestamp: new Date().toISOString(),
        symbol: this.config.symbol,
        gapSeconds: gap.gapSeconds,
        thresholdSeconds: gap.thresholdSeconds,
        reason: gap.reason,
        oldBufferSize: summary.oldBufferSize,
        oldZoneCount: summary.oldZoneCount,
        oldFvgCount: summary.oldFvgCount,
        oldIfvgCount: summary.oldIfvgCount,
        oldCandidateCount: summary.oldCandidateCount,
      };
      appendGapResetEvent(event);
      console.log(
        `  GAP_RESET ${gap.reason}  oldBuffer=${summary.oldBufferSize}`
        + `  clearedZones=${summary.oldZoneCount} (FVG=${summary.oldFvgCount} IFVG=${summary.oldIfvgCount})`
        + `  clearedCandidates=${summary.oldCandidateCount}`,
      );
    }

    this.candleBuffer.push(candle);
    const maxVolumeBuffer = this.config.volumeLookback + 2;
    if (this.candleBuffer.length > maxVolumeBuffer) this.candleBuffer.shift();

    this.ictCandleBuffer.push(candle);
    if (this.ictCandleBuffer.length > MAX_ICT_CANDLE_BUFFER) this.ictCandleBuffer.shift();
  }

  private processConfiguredSignalSource(): void {
    if (this.config.signalSource === 'VOLUME_SPIKE') {
      this.latestIctZones = [];
      this.processVolumeSpikeSignal();
      return;
    }

    if (this.config.signalSource === 'ICT') {
      this.processIctSignal();
      return;
    }

    this.latestSignal = null;
    this.latestIctSignal = null;
    this.latestIctZones = [];
    this.stats = {
      ...this.stats,
      latestSignal: null,
      latestIctSignal: null,
      latestTradeSelection: null,
      latestPositionSizing: null,
    };
  }

  private processVolumeSpikeSignal(): void {
    const signal = evalSignal(this.candleBuffer, this.config);
    this.latestSignal = signal;
    this.latestIctSignal = null;
    this.latestTradeSelection = null;

    this.stats = {
      ...this.stats,
      latestSignal: signal,
      latestIctSignal: null,
      latestTradeSelection: null,
      latestPositionSizing: null,
      signalsFired: signal.direction === 'BUY'
        ? this.stats.signalsFired + 1
        : this.stats.signalsFired,
    };

    if (this.position.side === 'NONE' && signal.direction === 'BUY') {
      this.openInitialPosition(this.lastPrice, {
        side: this.config.side,
        signalDirection: signal.direction,
        detail: `VOLUME_SPIKE drop=${(signal.priceDrop * 100).toFixed(2)}% vol=${signal.volumeRatio.toFixed(1)}x`,
      });
    }
  }

  private processIctSignal(): void {
    const tradeSelection = this.evaluateLatestIctTradeSelection();
    const ictSignal = tradeSelection.selectedCandidate?.signal ?? null;
    this.latestSignal = null;
    this.latestIctSignal = ictSignal;
    this.latestTradeSelection = tradeSelection;

    this.stats = {
      ...this.stats,
      latestSignal: null,
      latestIctSignal: ictSignal,
      latestTradeSelection: tradeSelection,
      signalsFired: tradeSelection.action !== 'NONE'
        ? this.stats.signalsFired + 1
        : this.stats.signalsFired,
    };

    const selectedCandidate = tradeSelection.selectedCandidate;
    if (!selectedCandidate || tradeSelection.action === 'NONE') {
      return;
    }

    const side = tradeSelection.action === 'BUY' ? 'LONG' : 'SHORT';
    const entryPrice = this.lastPrice;
    const scoreAttribution = createScoreAttribution(selectedCandidate);
    const stopPrice = selectedCandidate.stopPrice
      ?? (side === 'LONG' ? selectedCandidate.zone.low : selectedCandidate.zone.high);
    // Phase 5h: the selector ran target selection per zone, so reuse the
    // candidate's targetSelection rather than recomputing here.
    const targetSelection = selectedCandidate.targetSelection
      ?? this.runTargetSelection(side, entryPrice, stopPrice);
    this.stats = { ...this.stats, latestTargetSelection: targetSelection };
    const managedTarget = targetSelection.selectedTarget;
    if (!managedTarget) {
      this.stats = { ...this.stats, latestPositionSizing: null };
      logEvent('ENTRY_SKIP', side, this.tick, `no valid managed target (${targetSelection.selectedTargetReason})`);
      return;
    }

    const sizing = calculatePositionSizing({
      signal: tradeSelection.action,
      confidence: selectedCandidate.confidence,
      selectionScore: selectedCandidate.score,
      entryPrice,
      targetPrice: managedTarget.price,
      stopPrice,
      config: this.config,
    });
    this.stats = { ...this.stats, latestPositionSizing: sizing };
    this.debugIctPipeline('SIZING_EVALUATED', {
      candidateCount: tradeSelection.candidates.length,
      sizingEvaluations: 1,
    });

    if (sizing.status === 'REJECTED') {
      // Phase 7C: structured per-rejection log written to
      // logs/sizing-rejections.log so we can audit every refused entry
      // with full sizing context.
      appendSizingRejection(sizing, {
        symbol: this.config.symbol,
        signalSource: this.config.signalSource,
        side,
        targetProfitMinUsd: this.config.targetProfitMinUsd,
        targetProfitMaxUsd: this.config.targetProfitMaxUsd,
        maxRiskPerTradeUsd: this.config.maxRiskPerTradeUsd,
        maxPositionUsd: this.config.maxPositionUsd,
      });
      this.stats = {
        ...this.stats,
        sizingRejections: this.stats.sizingRejections + 1,
        lastSizingRejectionReason: sizing.rejectionReason,
      };
      logEvent(
        'ENTRY_SKIP',
        side,
        this.tick,
        `position sizing rejected: ${sizing.rejectionReason} entry=${sizing.entryPrice.toFixed(2)} stop=${sizing.stopPrice.toFixed(2)} risk=${sizing.riskDistance.toFixed(4)} size=$${sizing.recommendedPositionSizeUsd.toFixed(2)} expProfit=$${sizing.expectedProfitUsd.toFixed(4)} expLoss=$${sizing.expectedLossUsd.toFixed(4)} rr=${sizing.riskRewardRatio.toFixed(2)}`,
      );
      return;
    }

    if (!this.canOpenNewPosition()) {
      logEvent(
        'ENTRY_SKIP',
        side,
        this.tick,
        `max active positions reached (${this.positions.length}/${this.config.maxConcurrentPositions})`,
      );
      return;
    }

    this.openInitialPosition(this.lastPrice, {
      side,
      signalDirection: tradeSelection.action,
      detail: `ICT ${tradeSelection.action} score=${selectedCandidate.score.toFixed(2)} size=$${sizing.recommendedPositionSizeUsd.toFixed(2)} sizingMode=${sizing.sizingMode} expectedProfit=$${sizing.expectedProfitUsd.toFixed(2)} expectedLoss=$${sizing.expectedLossUsd.toFixed(2)} riskUtilization=${sizing.riskUtilizationPercent.toFixed(2)}% hardStop=$${sizing.hardStopPrice.toFixed(2)} targetR=${sizing.targetRMultiple.toFixed(2)} rr=${sizing.riskRewardRatio.toFixed(2)} confidence=${selectedCandidate.confidence.toFixed(2)} zone=${selectedCandidate.zoneType}:${selectedCandidate.zoneId} target=${managedTarget.source}:$${sizing.resolvedTargetPrice.toFixed(2)} mode=${targetSelection.exitTargetMode} reason="${selectedCandidate.reason}"`,
      entryZone: selectedCandidate.zone,
      positionSizeUsd: sizing.recommendedPositionSizeUsd,
      managedTarget: { ...managedTarget, price: sizing.resolvedTargetPrice },
      sizing,
      scoreAttribution,
      stopSource: selectedCandidate.stopSource,
      stopRiskDistance: selectedCandidate.riskDistance,
      stopZoneSize: selectedCandidate.zoneSize,
    });
  }

  private evaluateLatestIctTradeSelection(): TradeSelectionResult {
    if (this.ictCandleBuffer.length < 3) {
      this.latestIctZones = [];
      const tradeSelection = selectTradeCandidate({
        evaluations: [],
        currentPrice: this.lastPrice,
        orderSizeUsd: this.config.orderSizeUsd,
        takeProfitPct: this.config.takeProfitPct,
        options: {
          minExpectedProfitUsd: this.config.targetProfitMinUsd,
          preferredMinProfitUsd: this.config.targetProfitMinUsd,
          preferredMaxProfitUsd: this.config.targetProfitMaxUsd,
        },
      });
      this.debugIctPipeline('INSUFFICIENT_CANDLES', {
        candidateCount: tradeSelection.candidates.length,
        sizingEvaluations: 0,
      });
      return tradeSelection;
    }

    const rawFvgs = detectFVGs(this.ictCandleBuffer);
    // Phase 5c: run validation once so we can capture rejection diagnostics
    // alongside the accepted set. validateFVGs returns every raw FVG with
    // its full validation result; detectValidatedFVGs is the accepted-only
    // filter on top of that.
    const validationResults = validateFVGs(this.ictCandleBuffer);
    const fvgs: ValidatedFVGZone[] = validationResults
      .filter(r => r.accepted && r.zone !== null)
      .map(r => r.zone as ValidatedFVGZone);
    const ifvgs = detectIFVGs(fvgs, this.ictCandleBuffer);
    const zones: IctSignalZone[] = [...fvgs, ...ifvgs];
    this.latestIctZones = zones;

    if (this.config.debugIctPipeline && validationResults.length > 0) {
      const { summary } = this.fvgRejectionLog.recordValidationResults(validationResults, {
        symbol: this.config.symbol,
        timestamp: new Date().toISOString(),
      });
      this.stats = { ...this.stats, latestFvgRejectionSummary: summary };
    }

    const evaluations = zones.map((zone) => {
      // Phase 5f: every zone — FVG and IFVG, fresh or aged — goes through
      // the same reaction-tier evaluation. Phase 5h: each zone also runs
      // its own target selection so the selector can rank by real RR /
      // expected profit / distance penalty (targetReachProbability).
      const reaction = evaluateReaction({
        zone,
        candles: this.ictCandleBuffer,
        currentPrice: this.lastPrice,
      });
      const signal = createIctSignal({
        zone,
        reaction,
        context: {
          candles: this.ictCandleBuffer,
          evaluatedAt: reaction.evaluatedAt ?? new Date().toISOString(),
        },
        options: {
          minConfidence: this.config.ictMinConfidence,
        },
      });

      let targetSelection: TargetSelectionResult | null = null;
      let stopPrice: number | null = null;
      let stopSource: StopSource | null = null;
      if (signal.signal === 'BUY' || signal.signal === 'SELL') {
        const side: TradeSide = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
        const stop = resolveStopAttribution({
          zone,
          signal: signal.signal,
          entryPrice: this.lastPrice,
          candles: this.ictCandleBuffer,
        });
        stopPrice = stop.stopPrice;
        stopSource = stop.stopSource;
        if (stopPrice !== null) {
          targetSelection = this.runTargetSelection(side, this.lastPrice, stopPrice);
        }
      }

      return { zone, signal, reaction, targetSelection, stopPrice, stopSource };
    });

    const tradeSelection = selectTradeCandidate({
      evaluations,
      currentPrice: this.lastPrice,
      orderSizeUsd: this.config.orderSizeUsd,
      takeProfitPct: this.config.takeProfitPct,
      options: {
        minConfidence: this.config.ictMinConfidence,
        minExpectedProfitUsd: this.config.targetProfitMinUsd,
        preferredMinProfitUsd: this.config.targetProfitMinUsd,
        preferredMaxProfitUsd: this.config.targetProfitMaxUsd,
        minRiskRewardRatio: this.config.minRiskRewardRatio,
        exitTargetMode: this.config.exitTargetMode,
        currentBarIndex: this.ictCandleBuffer.length - 1,
      },
    });
    this.auditIctEvaluations(evaluations, tradeSelection);
    this.debugIctPipeline('ICT_EVALUATED', {
      rawFvgCount: rawFvgs.length,
      validatedFvgCount: fvgs.length,
      ifvgCount: ifvgs.length,
      zonesPassedToReaction: zones.length,
      reactionEvaluations: evaluations.length,
      signalEvaluations: evaluations.length,
      candidateCount: tradeSelection.candidates.length,
      sizingEvaluations: 0,
    });

    return tradeSelection;
  }

  private auditIctEvaluations(
    evaluations: readonly IctEvaluation[],
    tradeSelection: TradeSelectionResult,
  ): void {
    const candidatesByZoneId = new Map<string, TradeCandidate>(
      tradeSelection.candidates.map(candidate => [candidate.zoneId, candidate]),
    );
    const records = evaluations.map((evaluation) => makeIctSignalAuditRecord({
      signal: evaluation.signal,
      symbol: this.config.symbol,
      price: this.lastPrice,
      signalSource: this.config.signalSource,
      marketDataSource: this.dataSource.sourceName,
      tradeCandidate: candidatesByZoneId.get(evaluation.signal.zoneId),
    }));

    for (const record of records) {
      this.ictSignalAuditLog.log(record);
    }

    const summary = summarizeIctSignalAudit(records);
    this.stats = {
      ...this.stats,
      ictEvaluations: this.stats.ictEvaluations + summary.totalEvaluations,
      ictBuyCount: this.stats.ictBuyCount + summary.buyCount,
      ictSellCount: this.stats.ictSellCount + summary.sellCount,
      ictNoneCount: this.stats.ictNoneCount + summary.noneCount,
      ictAccepted: this.stats.ictAccepted + summary.acceptedCount,
      ictRejected: this.stats.ictRejected + summary.rejectedCount,
    };
  }

  private debugIctPipeline(
    stage: string,
    overrides: {
      rawFvgCount?: number;
      validatedFvgCount?: number;
      ifvgCount?: number;
      zonesPassedToReaction?: number;
      reactionEvaluations?: number;
      signalEvaluations?: number;
      candidateCount?: number;
      sizingEvaluations?: number;
      throttleTicks?: number;
    } = {},
  ): void {
    if (!this.config.debugIctPipeline || this.config.signalSource !== 'ICT') return;

    const throttleTicks = overrides.throttleTicks ?? 1;
    if (
      throttleTicks > 1
      && this.tick - this.lastIctPipelineDebugTick < throttleTicks
    ) {
      return;
    }
    this.lastIctPipelineDebugTick = this.tick;

    const latestCandle = this.ictCandleBuffer[this.ictCandleBuffer.length - 1] ?? null;
    const latestTimestamp = latestCandle?.timestamp.toISOString() ?? '--';
    const latestAgeSeconds = latestCandle
      ? Math.max(0, Math.round((Date.now() - latestCandle.timestamp.getTime()) / 1000))
      : null;
    const rawFvgCount = overrides.rawFvgCount
      ?? (this.ictCandleBuffer.length >= 3 ? detectFVGs(this.ictCandleBuffer).length : 0);
    const validatedFvgCount = overrides.validatedFvgCount
      ?? this.latestIctZones.filter(zone => zone.type === 'FVG').length;
    const ifvgCount = overrides.ifvgCount
      ?? this.latestIctZones.filter(zone => zone.type === 'IFVG').length;
    const zonesPassedToReaction = overrides.zonesPassedToReaction
      ?? this.latestIctZones.length;
    const reactionEvaluations = overrides.reactionEvaluations ?? zonesPassedToReaction;
    const signalEvaluations = overrides.signalEvaluations ?? reactionEvaluations;
    const candidateCount = overrides.candidateCount
      ?? this.latestTradeSelection?.candidates.length
      ?? 0;
    const sizingEvaluations = overrides.sizingEvaluations
      ?? (this.stats.latestPositionSizing ? 1 : 0);

    const line =
      `[${new Date().toISOString()}] stage=${stage}` +
      ` tick=${this.tick}` +
      ` candleCount=${this.ictCandleBuffer.length}` +
      ` latestCandle=${latestTimestamp}` +
      ` latestCandleAgeSec=${latestAgeSeconds ?? '--'}` +
      ` rawFVG=${rawFvgCount}` +
      ` validatedFVG=${validatedFvgCount}` +
      ` IFVG=${ifvgCount}` +
      ` zonesToReaction=${zonesPassedToReaction}` +
      ` reactionEvaluations=${reactionEvaluations}` +
      ` signalEvaluations=${signalEvaluations}` +
      ` candidates=${candidateCount}` +
      ` sizingEvaluations=${sizingEvaluations}`;

    console.log(`  ICT_PIPELINE ${line}`);
    try {
      fs.mkdirSync(path.dirname(ICT_PIPELINE_DEBUG_PATH), { recursive: true });
      fs.appendFileSync(ICT_PIPELINE_DEBUG_PATH, line + '\n', 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  [${ts()}] ICT pipeline debug log failed: ${msg}`);
    }
  }

  private runTargetSelection(
    side: TradeSide,
    entryPrice: number,
    stopPrice: number,
  ): TargetSelectionResult {
    const swing = this.findSwingTarget(side, entryPrice);
    return selectManagedTarget({
      side,
      entryPrice,
      stopPrice,
      opposingZones: this.latestIctZones,
      swingTargetPrice: swing,
      config: {
        exitTargetMode: this.config.exitTargetMode,
        targetRMultiple: this.config.targetRMultiple,
        minRiskRewardRatio: this.config.minRiskRewardRatio,
        maxTargetDistancePercent: this.config.maxTargetDistancePercent,
      },
    });
  }

  private findOpposingZoneTarget(side: TradeSide, entryPrice: number): ManagedTarget | null {
    let selected: ManagedTarget | null = null;

    for (const zone of this.latestIctZones) {
      if (zone.invalidated) continue;

      const buyTarget = side === 'LONG' && zone.direction === 'BEARISH' && zone.low > entryPrice;
      const sellTarget = side === 'SHORT' && zone.direction === 'BULLISH' && zone.high < entryPrice;

      if (buyTarget) {
        if (!selected || zone.low < selected.price) {
          selected = { price: zone.low, source: 'OPPOSING_FVG', zone };
        }
      }

      if (sellTarget) {
        if (!selected || zone.high > selected.price) {
          selected = { price: zone.high, source: 'OPPOSING_FVG', zone };
        }
      }
    }

    return selected;
  }

  private findSwingTarget(side: TradeSide, entryPrice: number): number | null {
    const confirmedSwing = side === 'LONG'
      ? this.findLatestConfirmedSwingHigh(entryPrice)
      : this.findLatestConfirmedSwingLow(entryPrice);

    if (confirmedSwing !== null) return confirmedSwing;

    const fallbackCandles = this.ictCandleBuffer.slice(-this.config.ictTargetFallbackLookback);
    if (fallbackCandles.length === 0) return null;

    return side === 'LONG'
      ? Math.max(...fallbackCandles.map(candle => candle.high))
      : Math.min(...fallbackCandles.map(candle => candle.low));
  }

  private findLatestConfirmedSwingHigh(entryPrice: number): number | null {
    const { ictTargetSwingLeft: left, ictTargetSwingRight: right } = this.config;
    for (let i = this.ictCandleBuffer.length - 1 - right; i >= left; i--) {
      const candidate = this.ictCandleBuffer[i];
      if (!candidate || candidate.high <= entryPrice) continue;

      const window = this.ictCandleBuffer.slice(i - left, i + right + 1);
      if (window.every(candle => candidate.high >= candle.high)) {
        return candidate.high;
      }
    }

    return null;
  }

  private findLatestConfirmedSwingLow(entryPrice: number): number | null {
    const { ictTargetSwingLeft: left, ictTargetSwingRight: right } = this.config;
    for (let i = this.ictCandleBuffer.length - 1 - right; i >= left; i--) {
      const candidate = this.ictCandleBuffer[i];
      if (!candidate || candidate.low >= entryPrice) continue;

      const window = this.ictCandleBuffer.slice(i - left, i + right + 1);
      if (window.every(candle => candidate.low <= candle.low)) {
        return candidate.low;
      }
    }

    return null;
  }

  private makeManagedTargetState(target: ManagedTarget): Partial<PositionState> {
    return {
      targetPrice: target.price,
      targetSource: target.source,
      targetZoneId: target.zone?.id ?? null,
      targetZoneType: target.zone?.type ?? null,
      targetZoneHigh: target.zone?.high ?? null,
      targetZoneLow: target.zone?.low ?? null,
      targetZoneDirection: target.zone?.direction ?? null,
      targetDisrespected: false,
      stopAtBreakeven: false,
      stopMovedToBreakevenAt: null,
    };
  }

  private openInitialPosition(price: number, trigger: EntryTrigger): void {
    const positionSizeUsd = trigger.positionSizeUsd ?? this.config.orderSizeUsd;
    const fillAmount = positionSizeUsd / price;
    let position = recordDcaEntry(
      {
        ...emptyPositionState(),
        id: makePositionId(this.tick),
      },
      price,
      fillAmount,
      positionSizeUsd,
      trigger.side,
      { persist: false },
    );

    this.tradeEntryTime = position.openedAt ? new Date(position.openedAt) : new Date();
    this.tradeEntryPrice = price;

    // Attribution + sizing attach unconditionally so they survive even if a
    // future code path opens a position without an entry zone. Without this,
    // scoreAttribution / positionSizeUsd were silently dropped whenever
    // trigger.entryZone was absent, which is the root cause of completed
    // trades missing scoreBreakdown / scoreFinal.
    if (trigger.sizing || trigger.scoreAttribution || trigger.positionSizeUsd !== undefined) {
      position = {
        ...position,
        positionSizeUsd,
        expectedProfitUsd: trigger.sizing?.expectedProfitUsd ?? position.expectedProfitUsd,
        expectedLossUsd: trigger.sizing?.expectedLossUsd ?? position.expectedLossUsd,
        riskRewardRatio: trigger.sizing?.riskRewardRatio ?? position.riskRewardRatio,
        sizingMode: trigger.sizing?.sizingMode ?? position.sizingMode,
        hardStopPrice: trigger.sizing?.hardStopPrice ?? position.hardStopPrice,
        hardStopEnabled: trigger.sizing ? this.config.hardStopEnabled : position.hardStopEnabled,
        stopPrice: trigger.sizing?.hardStopPrice ?? position.stopPrice,
        stopSource: trigger.stopSource ?? position.stopSource,
        stopRiskDistance: trigger.stopRiskDistance ?? position.stopRiskDistance,
        stopZoneSize: trigger.stopZoneSize ?? position.stopZoneSize,
        riskUtilizationPercent: trigger.sizing?.riskUtilizationPercent ?? position.riskUtilizationPercent,
        riskUtilizationWarning: trigger.sizing?.riskUtilizationWarning ?? position.riskUtilizationWarning,
        targetRMultiple: trigger.sizing?.targetRMultiple ?? position.targetRMultiple,
        expectedMovePercent: trigger.sizing?.expectedMovePercent ?? position.expectedMovePercent,
        selectionScore: trigger.sizing?.selectionScore ?? position.selectionScore,
        scoreAttribution: trigger.scoreAttribution ?? position.scoreAttribution,
      };
    }

    if (trigger.entryZone) {
      // Stop is the far edge of the entry zone (LONG → zone.low, SHORT → zone.high).
      // Used only when trigger.managedTarget is absent (legacy / volume-spike fallback).
      const fallbackStop = trigger.side === 'LONG'
        ? trigger.entryZone.low
        : trigger.entryZone.high;
      const managedTarget = trigger.managedTarget
        ?? this.runTargetSelection(trigger.side, price, fallbackStop).selectedTarget;
      position = {
        ...position,
        entryZoneId: trigger.entryZone.id,
        entryZoneType: trigger.entryZone.type,
        entryZoneHigh: trigger.entryZone.high,
        entryZoneLow: trigger.entryZone.low,
        entryZoneMidpoint: trigger.entryZone.midpoint,
        entryZoneDirection: trigger.entryZone.direction,
        entryZoneRespected: true,
        ...(managedTarget ? this.makeManagedTargetState(managedTarget) : {}),
      };
    }

    this.positions = this.config.allowMultiplePositions
      ? [...this.positions, position]
      : [position];
    this.persistPositions();
    this.position = this.aggregatePositions();
    if (trigger.sizing) {
      this.recordPositionSizingAnalytics(trigger.sizing);
    }

    const fallbackTp = price * (1 + (trigger.side === 'LONG' ? 1 : -1) * this.config.takeProfitPct);
    const tp = position.targetPrice ?? fallbackTp;
    const targetDetail = position.targetSource
      ? `  target=${position.targetSource} $${fp(tp)}`
      : `  TP=$${fp(tp)}`;

    logEvent(
      'ENTRY',
      trigger.side,
      this.tick,
      `$${fp(price)}  size=${fmtToken(fillAmount, this.config.symbol)}${targetDetail}  [${trigger.detail}]`,
    );

    this.journal.logEvent(this.makeEvent('ENTRY', price, fillAmount, 0, trigger.signalDirection, undefined, undefined, position));
  }

  private managePositions(price: number, candle: Candle | null): void {
    for (const position of [...this.positions]) {
      this.managePosition(position, price, candle);
    }
  }

  private managePosition(position: PositionState, price: number, candle: Candle | null): void {
    const { config } = this;
    if (position.side === 'NONE') return;

    if (this.config.signalSource === 'ICT') {
      this.updateIctTradeManagement(position, candle);
    }

    const latestPosition = this.positions.find(active => active.id === position.id) ?? position;
    const lifecycleExit = evaluatePositionLifecycleExit(latestPosition, price, candle, {
      takeProfitPct: config.takeProfitPct,
      profitTargetUsdMin: config.profitTargetUsdMin,
      profitTargetUsdMax: config.profitTargetUsdMax,
      maxPositionMinutes: config.maxPositionMinutes,
      maxLossUsd: config.maxLossUsd,
      // Phase 5g: quick-profit exit is always enabled. Previously it was
      // suppressed whenever an ICT-managed target existed, which meant the
      // bot could not book the $0.50-$1.50 objective even when reached.
      useQuickProfitExit: true,
    });
    const disrespectEvaluation = lifecycleExit.entryZoneDisrespect;
    if (
      latestPosition.entryZoneType
      && disrespectEvaluation.entryZoneRespected !== latestPosition.entryZoneRespected
    ) {
      this.updatePosition({
        ...latestPosition,
        entryZoneRespected: disrespectEvaluation.entryZoneRespected,
      });
    }

    this.stats = {
      ...this.stats,
      latestPositionExit: lifecycleExit.positionExit,
    };

    if (lifecycleExit.shouldClose && lifecycleExit.reason) {
      this.closePosition(
        latestPosition,
        price,
        lifecycleExit.reason,
        disrespectEvaluation.shouldClose ? disrespectEvaluation : undefined,
      );
      return;
    }

    const activePosition = this.positions.find(active => active.id === position.id) ?? latestPosition;
    if (activePosition.side === 'NONE') return;
    const activeSide = activePosition.side;
    const nextDcaPrice = activeSide === 'LONG'
      ? activePosition.lastDcaPrice * (1 - config.dcaTriggerPct)
      : activePosition.lastDcaPrice * (1 + config.dcaTriggerPct);

    const dcaTriggered = activeSide === 'LONG'
      ? price <= nextDcaPrice
      : price >= nextDcaPrice;

    const canDca = activePosition.totalUsdInvested + config.orderSizeUsd <= config.maxCapUsd;
    if (dcaTriggered && canDca && this.canAddPaperEntry(activeSide)) {
      this.executeDca(activePosition, price);
    }
  }

  private updateIctTradeManagement(position: PositionState, candle: Candle | null): void {
    if (position.side === 'NONE' || !candle) return;

    const side = position.side;
    let updatedPosition = position;
    let stateChanged = false;

    // Phase 5g: in SCALP mode the R-multiple target is fixed for the life of
    // the trade — do not retroactively upgrade to an opposing FVG. STRUCTURE
    // and HYBRID still upgrade because their model is structure-aware.
    const allowOpposingUpgrade = this.config.exitTargetMode !== 'SCALP'
      && updatedPosition.targetSource !== 'OPPOSING_FVG'
      && updatedPosition.targetSource !== 'SCALP_R';

    if (allowOpposingUpgrade) {
      const opposingTarget = this.findOpposingZoneTarget(side, updatedPosition.averageEntryPrice);
      if (opposingTarget) {
        updatedPosition = {
          ...updatedPosition,
          ...this.makeManagedTargetState(opposingTarget),
          stopAtBreakeven: true,
          stopMovedToBreakevenAt: updatedPosition.stopMovedToBreakevenAt ?? candle.timestamp.toISOString(),
        };
        stateChanged = true;
        logEvent(
          'TARGET',
          side,
          this.tick,
          `opposing ${opposingTarget.zone?.type ?? 'zone'} target=$${fp(opposingTarget.price)}  SL=BE`,
        );
      }
    }

    if (
      updatedPosition.targetSource === 'OPPOSING_FVG'
      && this.opposingTargetEncountered(updatedPosition, candle)
      && !updatedPosition.stopAtBreakeven
    ) {
      updatedPosition = {
        ...updatedPosition,
        stopAtBreakeven: true,
        stopMovedToBreakevenAt: candle.timestamp.toISOString(),
      };
      stateChanged = true;
      logEvent('BREAKEVEN', side, this.tick, `opposing FVG encountered  SL=BE @ $${fp(updatedPosition.averageEntryPrice)}`);
    }

    if (
      updatedPosition.targetSource === 'OPPOSING_FVG'
      && this.opposingTargetDisrespected(updatedPosition, candle)
    ) {
      const swingTargetPrice = this.findSwingTarget(side, updatedPosition.averageEntryPrice);
      const validSwingTarget = swingTargetPrice !== null && (
        side === 'LONG'
          ? swingTargetPrice > updatedPosition.averageEntryPrice
          : swingTargetPrice < updatedPosition.averageEntryPrice
      );

      if (validSwingTarget) {
        updatedPosition = {
          ...updatedPosition,
          targetPrice: swingTargetPrice,
          targetSource: 'SWING',
          targetZoneId: null,
          targetZoneType: null,
          targetZoneHigh: null,
          targetZoneLow: null,
          targetZoneDirection: null,
          targetDisrespected: true,
          stopAtBreakeven: true,
          stopMovedToBreakevenAt: updatedPosition.stopMovedToBreakevenAt ?? candle.timestamp.toISOString(),
        };
        stateChanged = true;
        logEvent('TARGET', side, this.tick, `opposing FVG disrespected; retarget swing=$${fp(swingTargetPrice)}  SL=BE`);
      }
    }

    if (stateChanged) {
      this.updatePosition(updatedPosition);
    }
  }

  private opposingTargetEncountered(position: PositionState, candle: Candle): boolean {
    if (
      position.side === 'NONE'
      || position.targetZoneHigh === null
      || position.targetZoneLow === null
    ) {
      return false;
    }

    return candle.low <= position.targetZoneHigh && candle.high >= position.targetZoneLow;
  }

  private opposingTargetDisrespected(position: PositionState, candle: Candle): boolean {
    if (
      position.side === 'NONE'
      || position.targetZoneHigh === null
      || position.targetZoneLow === null
    ) {
      return false;
    }

    return position.side === 'LONG'
      ? candle.close > position.targetZoneHigh
      : candle.close < position.targetZoneLow;
  }

  private executeDca(position: PositionState, price: number): void {
    if (position.side === 'NONE') return;

    const activeSide = position.side;
    const fillAmount = this.config.orderSizeUsd / price;
    const updatedPosition = recordDcaEntry(
      position,
      price,
      fillAmount,
      this.config.orderSizeUsd,
      activeSide,
      { persist: false },
    );
    this.updatePosition(updatedPosition);

    const maxLevels = Math.floor(this.config.maxCapUsd / this.config.orderSizeUsd);
    const newTp = activeSide === 'LONG'
      ? updatedPosition.averageEntryPrice * (1 + this.config.takeProfitPct)
      : updatedPosition.averageEntryPrice * (1 - this.config.takeProfitPct);

    logEvent(
      'DCA',
      activeSide,
      this.tick,
      `#${this.position.dcaCount}/${maxLevels}  $${fp(price)}  ` +
      `avg=$${fp(updatedPosition.averageEntryPrice)}  new TP=$${fp(newTp)}  ` +
      `invested=$${updatedPosition.totalUsdInvested.toFixed(0)}`,
    );

    this.journal.logEvent(
      this.makeEvent('DCA', price, fillAmount, 0, this.currentSignalDirection(), undefined, undefined, updatedPosition),
    );
  }

  private closePosition(
    position: PositionState,
    price: number,
    reason: PositionCloseReason,
    disrespectEvaluation?: EntryZoneDisrespectEvaluation,
  ): void {
    const { config } = this;
    if (position.side === 'NONE') return;

    const activeSide = position.side;
    const exitValue = position.activePositionSize * price;
    const entryValue = position.activePositionSize * position.averageEntryPrice;
    const pnlUsd = activeSide === 'LONG'
      ? exitValue - entryValue
      : entryValue - exitValue;
    const pnlPct = (pnlUsd / position.totalUsdInvested) * 100;
    const sign = pnlUsd >= 0 ? '+' : '';
    const label = closeReasonLabel(reason);
    const now = new Date();
    const entryTime = position.openedAt
      ? new Date(position.openedAt)
      : this.tradeEntryTime
      ?? (position.openedAt ? new Date(position.openedAt) : now);
    const tradeDurationMinutes = Math.max(0, (now.getTime() - entryTime.getTime()) / 60_000);

    logEvent(
      label,
      activeSide,
      this.tick,
      `$${fp(price)}  PnL=${sign}$${pnlUsd.toFixed(2)} (${sign}${pnlPct.toFixed(3)}%)  ` +
      `duration=${tradeDurationMinutes.toFixed(2)}m  ` +
      `DCAs=${position.dcaCount - 1}  invested=$${position.totalUsdInvested.toFixed(0)}`,
    );

    const closeEvent = this.makeEvent(
      reason,
      price,
      position.activePositionSize,
      pnlUsd,
      this.currentSignalDirection(),
      disrespectEvaluation,
      tradeDurationMinutes,
      position,
    );

    const completed: CompletedTrade = {
      id: `${now.toISOString()}-${config.symbol}-${activeSide}`,
      symbol: config.symbol,
      side: activeSide,
      marketDataSource: this.dataSource.sourceName,
      entryTimestamp: (position.openedAt ? new Date(position.openedAt) : now).toISOString(),
      exitTimestamp: now.toISOString(),
      entryPrice: position.averageEntryPrice,
      avgEntryPrice: position.averageEntryPrice,
      exitPrice: price,
      dcaCount: position.dcaCount - 1,
      totalInvestedUsd: position.totalUsdInvested,
      realizedPnlUsd: pnlUsd,
      pnlPct,
      reason,
      tradeDurationMinutes,
      ...this.makeEntryZoneFields(disrespectEvaluation, position),
      ...this.makeManagedTargetFields(position),
      ...this.makePositionSizingFields(position),
      ...this.makeScoreAttributionFields(position),
    };

    this.journal.logClose(closeEvent, completed);
    generateScoreAttributionReports();

    this.stats = {
      ...recordClosedTrade(this.stats, pnlUsd, config),
      latestCloseReason: reason,
      latestPositionExit: null,
    };
    this.positions = this.positions.filter(active => active.id !== position.id);
    this.persistPositions();
    this.position = this.aggregatePositions();
    this.tradeEntryTime = this.position.openedAt ? new Date(this.position.openedAt) : null;
    this.tradeEntryPrice = this.position.averageEntryPrice;
  }

  private makeEvent(
    action: 'ENTRY' | 'DCA' | PositionCloseReason,
    price: number,
    size: number,
    realizedPnlUsd: number,
    signalDirection: string,
    disrespectEvaluation?: EntryZoneDisrespectEvaluation,
    tradeDurationMinutes?: number,
    positionOverride?: PositionState,
  ): TradeEvent {
    const position = positionOverride ?? this.position;
    const side = position.side === 'NONE' ? this.config.side : position.side;
    const ictSignal = this.latestIctSignal;

    return {
      timestamp: new Date().toISOString(),
      symbol: this.config.symbol,
      marketDataSource: this.dataSource.sourceName,
      action,
      side,
      price,
      size,
      investedUsd: position.totalUsdInvested,
      avgEntry: position.averageEntryPrice,
      dcaCount: Math.max(0, position.dcaCount - 1),
      realizedPnlUsd,
      signalDirection,
      signalSource: this.config.signalSource,
      ictSignal: ictSignal?.signal,
      ictConfidence: ictSignal?.confidence,
      ictZoneId: ictSignal?.zoneId,
      ictZoneType: ictSignal?.sourceZoneType,
      ictReason: ictSignal?.reason,
      tradeDurationMinutes,
      ...this.makeEntryZoneFields(disrespectEvaluation, position),
      ...this.makeManagedTargetFields(position),
      ...this.makePositionSizingFields(position),
      ...this.makeScoreAttributionFields(position),
    };
  }

  private makeManagedTargetFields(position: PositionState = this.position): Partial<TradeEvent> {
    if (position.targetPrice === null) return {};

    return {
      targetPrice: position.targetPrice,
      targetSource: position.targetSource ?? undefined,
      targetZoneId: position.targetZoneId ?? undefined,
      targetDisrespected: position.targetDisrespected ?? undefined,
      stopAtBreakeven: position.stopAtBreakeven,
    };
  }

  private makePositionSizingFields(position: PositionState = this.position): Partial<TradeEvent> {
    if (position.positionSizeUsd === null) return {};

    return {
      positionSizeUsd: position.positionSizeUsd,
      sizingMode: position.sizingMode ?? undefined,
      hardStopPrice: position.hardStopPrice ?? undefined,
      entryPrice: position.averageEntryPrice,
      stopPrice: position.stopPrice ?? position.hardStopPrice ?? undefined,
      stopSource: position.stopSource ?? undefined,
      riskDistance: position.stopRiskDistance ?? undefined,
      zoneSize: position.stopZoneSize ?? undefined,
      expectedProfitUsd: position.expectedProfitUsd ?? undefined,
      expectedLossUsd: position.expectedLossUsd ?? undefined,
      riskRewardRatio: position.riskRewardRatio ?? undefined,
      riskUtilizationPercent: position.riskUtilizationPercent ?? undefined,
      targetRMultiple: position.targetRMultiple ?? undefined,
      selectionScore: position.selectionScore ?? undefined,
    };
  }

  private makeScoreAttributionFields(position: PositionState = this.position): Partial<TradeEvent> {
    if (position.scoreAttribution === null) return {};

    return {
      scoreBreakdown: position.scoreAttribution.breakdown,
      scoreFinal: position.scoreAttribution.finalScore,
      // Phase 5h: discrete copy so report bucketing doesn't need to dig
      // into the breakdown object.
      targetReachProbability: position.scoreAttribution.breakdown.targetReachProbability ?? undefined,
    };
  }

  private makeEntryZoneFields(
    disrespectEvaluation?: EntryZoneDisrespectEvaluation,
    position: PositionState = this.position,
  ): Partial<TradeEvent> {
    if (!position.entryZoneId) return {};

    return {
      entryZoneId: position.entryZoneId,
      entryZoneType: position.entryZoneType ?? undefined,
      entryZoneHigh: position.entryZoneHigh ?? undefined,
      entryZoneLow: position.entryZoneLow ?? undefined,
      entryZoneMidpoint: position.entryZoneMidpoint ?? undefined,
      entryZoneDirection: position.entryZoneDirection ?? undefined,
      entryZoneRespected: disrespectEvaluation?.entryZoneRespected
        ?? position.entryZoneRespected
        ?? undefined,
      disrespectCandleClose: disrespectEvaluation?.disrespectCandleClose ?? undefined,
      zoneBoundaryViolated: disrespectEvaluation?.zoneBoundaryViolated ?? undefined,
    };
  }

  private currentSignalDirection(): string {
    if (this.config.signalSource === 'ICT') {
      return this.latestIctSignal?.signal ?? 'NONE';
    }

    if (this.config.signalSource === 'VOLUME_SPIKE') {
      return this.latestSignal?.direction ?? 'NONE';
    }

    return 'NONE';
  }

  private canAddPaperEntry(activeSide: TradeSide): boolean {
    if (this.config.signalSource === 'ICT') {
      const signal = this.latestIctSignal?.signal ?? 'NONE';
      return activeSide === 'LONG' ? signal === 'BUY' : signal === 'SELL';
    }

    return this.config.signalSource === 'VOLUME_SPIKE';
  }

  private canOpenNewPosition(): boolean {
    if (!this.config.allowMultiplePositions) {
      return this.positions.length === 0;
    }

    return this.positions.length < this.config.maxConcurrentPositions;
  }

  private recordPositionSizingAnalytics(sizing: PositionSizingResult): void {
    if (sizing.status !== 'ACCEPTED') return;

    const bucket = sizing.recommendedPositionSizeUsd < 100
      ? 'small'
      : sizing.recommendedPositionSizeUsd < 250
        ? 'medium'
        : 'large';

    this.stats = {
      ...this.stats,
      positionSizingSamples: this.stats.positionSizingSamples + 1,
      totalPositionSizeUsd: this.stats.totalPositionSizeUsd + sizing.recommendedPositionSizeUsd,
      totalExpectedProfitUsd: this.stats.totalExpectedProfitUsd + sizing.expectedProfitUsd,
      totalExpectedLossUsd: this.stats.totalExpectedLossUsd + sizing.expectedLossUsd,
      positionSizeDistribution: {
        ...this.stats.positionSizeDistribution,
        [bucket]: this.stats.positionSizeDistribution[bucket] + 1,
      },
    };
  }

  private updatePosition(position: PositionState): void {
    this.positions = this.positions.map(active => active.id === position.id ? position : active);
    this.persistPositions();
    this.position = this.aggregatePositions();
  }

  private persistPositions(): void {
    saveOpenPositions(this.positions);
  }

  private aggregatePositions(): PositionState {
    const activePositions = this.positions.filter(position => position.side !== 'NONE');
    if (activePositions.length === 0) return emptyPositionState();
    if (activePositions.length === 1) return { ...activePositions[0] };

    const totalSize = activePositions.reduce((sum, position) => sum + position.activePositionSize, 0);
    const totalUsd = activePositions.reduce((sum, position) => sum + position.totalUsdInvested, 0);
    const weightedEntry = totalSize > 0
      ? activePositions.reduce((sum, position) => sum + position.averageEntryPrice * position.activePositionSize, 0) / totalSize
      : 0;
    const first = activePositions[0];

    return {
      ...first,
      id: 'AGGREGATE',
      activePositionSize: totalSize,
      averageEntryPrice: weightedEntry,
      totalUsdInvested: totalUsd,
      side: activePositions.every(position => position.side === first.side) ? first.side : first.side,
      dcaCount: activePositions.reduce((sum, position) => sum + position.dcaCount, 0),
      lastDcaPrice: first.lastDcaPrice,
      openedAt: activePositions
        .map(position => position.openedAt)
        .filter((value): value is string => value !== null)
        .sort()[0] ?? null,
      targetPrice: null,
      targetSource: null,
      targetZoneId: null,
      targetZoneType: null,
      targetZoneHigh: null,
      targetZoneLow: null,
      targetZoneDirection: null,
      targetDisrespected: null,
      stopAtBreakeven: activePositions.every(position => position.stopAtBreakeven),
      stopMovedToBreakevenAt: null,
      hardStopPrice: null,
      hardStopEnabled: activePositions.some(position => position.hardStopEnabled),
      stopPrice: null,
      stopSource: null,
      stopRiskDistance: null,
      stopZoneSize: null,
      positionSizeUsd: totalUsd,
      expectedProfitUsd: activePositions.reduce((sum, position) => sum + (position.expectedProfitUsd ?? 0), 0),
      expectedLossUsd: activePositions.reduce((sum, position) => sum + (position.expectedLossUsd ?? 0), 0),
      riskRewardRatio: null,
      sizingMode: activePositions
        .map(position => position.sizingMode)
        .filter((value): value is NonNullable<PositionState['sizingMode']> => value !== null)
        .sort()[0] ?? null,
      riskUtilizationPercent: null,
      riskUtilizationWarning: activePositions.some(position => position.riskUtilizationWarning === true),
      targetRMultiple: null,
      expectedMovePercent: null,
      selectionScore: null,
      openPositions: activePositions,
    };
  }

  private updatePortfolioUnrealized(stats: SessionStats, price: number): SessionStats {
    if (this.positions.length === 0) {
      return updateUnrealized(stats, emptyPositionState(), price);
    }

    const unrealized = this.positions.reduce((sum, position) => {
      const positionValue = position.activePositionSize * price;
      const costBasis = position.activePositionSize * position.averageEntryPrice;
      return sum + (position.side === 'LONG'
        ? positionValue - costBasis
        : costBasis - positionValue);
    }, 0);
    const totalCapital = this.positions.reduce((sum, position) => sum + position.totalUsdInvested, 0);
    const equity = stats.sessionEquity + unrealized;
    const drawdown = Math.max(0, stats.sessionEquity - equity);

    return {
      ...stats,
      unrealizedPnlUsd: unrealized,
      currentDrawdownUsd: drawdown,
      maxDrawdownUsd: Math.max(stats.maxDrawdownUsd, drawdown),
      maxCapitalUsed: Math.max(stats.maxCapitalUsed, totalCapital),
      updatedAt: new Date().toISOString(),
    };
  }
}

function logEvent(type: string, side: string, tick: number, detail: string): void {
  const labels: Record<string, string> = {
    ENTRY: 'ENTRY',
    DCA: 'DCA',
    TARGET: 'TARGET',
    BREAKEVEN: 'BREAKEVEN',
    'TAKE PROFIT': 'TAKE_PROFIT',
    'RISK EXIT': 'RISK_EXIT',
  };
  console.log(`  ${labels[type] ?? type} [${ts()}][tick ${tick}] ${side}  ${detail}`);
}

function closeReasonLabel(reason: PositionCloseReason): string {
  if (reason === 'TAKE_PROFIT') return 'TAKE PROFIT';
  if (reason === 'MANAGED_TARGET_EXIT') return 'MANAGED_TARGET';
  if (reason === 'BREAKEVEN_STOP_EXIT') return 'BREAKEVEN_STOP';
  if (reason === 'HARD_STOP_EXIT') return 'HARD_STOP';
  return reason;
}

function fp(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtToken(n: number, symbol: string): string {
  const dp = symbol === 'BTC' ? 6 : symbol === 'ETH' ? 4 : 3;
  return n.toFixed(dp) + ' ' + symbol;
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

function makePositionId(tick: number): string {
  return `${new Date().toISOString()}-${tick}`;
}

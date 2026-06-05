"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotEngine = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const targetSelection_1 = require("./risk/targetSelection");
const state_1 = require("./state");
const volumeSpikeReversal_1 = require("./signals/volumeSpikeReversal");
const positionExitManager_1 = require("./positionExitManager");
const positionTradeManagement_1 = require("./positionTradeManagement");
const positionSizing_1 = require("./risk/positionSizing");
const sizingRejectionLog_1 = require("./risk/sizingRejectionLog");
const scoreAttribution_1 = require("./analytics/scoreAttribution");
const tradeOutcomeAnalytics_1 = require("./analytics/tradeOutcomeAnalytics");
const ifvgDetector_1 = require("./ict/ifvgDetector");
const fvgDetector_1 = require("./ict/fvgDetector");
const validatedFvgDetector_1 = require("./ict/validatedFvgDetector");
const validatedFvgRejectionLog_1 = require("./ict/validatedFvgRejectionLog");
const candleBufferGap_1 = require("./ict/candleBufferGap");
const oppositeExposureManager_1 = require("./risk/oppositeExposureManager");
const positionSlotManager_1 = require("./risk/positionSlotManager");
const recentSignalWatch_1 = require("./risk/recentSignalWatch");
const reactionEngine_1 = require("./ict/reactionEngine");
const ictSignalEngine_1 = require("./ict/ictSignalEngine");
const tradeSelectionEngine_1 = require("./ict/tradeSelectionEngine");
const stopAttribution_1 = require("./ict/stopAttribution");
const ictSignalAuditLog_1 = require("./ict/ictSignalAuditLog");
const sessionStats_1 = require("./sessionStats");
const MAX_ICT_CANDLE_BUFFER = 500;
const ICT_PIPELINE_DEBUG_PATH = path.resolve(__dirname, '../logs/ict-pipeline-debug.log');
/**
 * Paper trading simulation loop.
 *
 * This engine records simulated entries, DCA fills, and closes only. It does
 * not contain wallet, private key, exchange order, or Nado integration logic.
 */
class BotEngine {
    config;
    dataSource;
    journal;
    position;
    positions = [];
    stats;
    lastPrice;
    tick = 0;
    running = false;
    candleBuffer = [];
    ictCandleBuffer = [];
    latestSignal = null;
    latestIctSignal = null;
    latestTradeSelection = null;
    latestIctZones = [];
    ictSignalAuditLog = new ictSignalAuditLog_1.IctSignalAuditLog();
    fvgRejectionLog = new validatedFvgRejectionLog_1.ValidatedFvgRejectionLog();
    lastIctPipelineDebugTick = 0;
    recentOppositeSignalExpiredLogged = false;
    tradeEntryTime = null;
    tradeEntryPrice = 0;
    constructor(config, dataSource, journal) {
        this.config = config;
        this.dataSource = dataSource;
        this.journal = journal;
        this.positions = (0, state_1.loadOpenPositions)();
        this.position = this.aggregatePositions();
        if (this.positions.some(position => position.side !== 'NONE' && !position.openedAt)) {
            this.positions = this.positions.map(position => position.side !== 'NONE' && !position.openedAt
                ? { ...position, openedAt: new Date().toISOString() }
                : position);
            this.persistPositions();
        }
        this.stats = (0, sessionStats_1.createSessionStats)(config, dataSource.sourceName);
        this.lastPrice = config.startPrice;
        this.tradeEntryTime = this.position.openedAt ? new Date(this.position.openedAt) : null;
        this.tradeEntryPrice = this.position.averageEntryPrice;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        void this.bootstrapAndSchedule();
    }
    stop() {
        this.running = false;
        (0, sessionStats_1.saveSessionStats)(this.statsWithJournalStatus());
    }
    snapshot() {
        return {
            stats: this.statsWithJournalStatus(),
            position: this.position,
            price: this.lastPrice,
            signal: this.latestSignal,
            ictSignal: this.latestIctSignal,
            tradeSelection: this.latestTradeSelection,
        };
    }
    statsWithJournalStatus() {
        const status = this.journal.getStatus();
        return {
            ...this.stats,
            journalStatus: status.status,
            lastJournalWrite: status.lastJournalWrite,
            completedTradesLogged: status.completedTradesLogged,
            tradeEventsLogged: status.tradeEventsLogged,
        };
    }
    scheduleTick() {
        setTimeout(async () => {
            if (!this.running)
                return;
            try {
                await this.processTick();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  !  [${ts()}] Unhandled tick error: ${msg}`);
            }
            this.scheduleTick();
        }, this.config.tickIntervalMs);
    }
    async bootstrapAndSchedule() {
        await this.preloadStartupCandles();
        if (this.running)
            this.scheduleTick();
    }
    async preloadStartupCandles() {
        if (typeof this.dataSource.startupCandles !== 'function')
            return;
        try {
            const candles = await this.dataSource.startupCandles();
            for (const candle of candles) {
                this.rememberCandle(candle);
            }
            if (candles.length > 0) {
                this.lastPrice = candles[candles.length - 1].close;
                console.log(`  STARTUP_LOOKBACK loaded ${candles.length} closed candles`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  STARTUP_LOOKBACK failed: ${msg}`);
        }
    }
    async processTick() {
        const candle = await this.dataSource.nextCandle();
        this.lastPrice = this.dataSource.currentPrice();
        this.tick++;
        this.stats = { ...this.stats, ticks: this.tick };
        this.position = this.aggregatePositions();
        this.stats = this.updatePortfolioUnrealized(this.stats, this.lastPrice);
        if (candle !== null) {
            this.rememberCandle(candle);
            this.processConfiguredSignalSource();
        }
        else {
            this.debugIctPipeline('NO_NEW_CANDLE', {
                throttleTicks: 30,
            });
        }
        if (this.positions.length > 0) {
            this.managePositions(this.lastPrice, candle);
        }
        this.position = this.aggregatePositions();
    }
    rememberCandle(candle) {
        // Phase 5d: detect candle-stream gaps (laptop sleep, exchange outage,
        // process pause) BEFORE buffering the new candle. If the previous ICT
        // buffer entry is more than DEFAULT_MAX_GAP_SECONDS old vs the incoming
        // candle, clear every persistent ICT cache so analysis cannot bridge
        // the discontinuity.
        const lastIctCandle = this.ictCandleBuffer[this.ictCandleBuffer.length - 1] ?? null;
        const gap = (0, candleBufferGap_1.detectCandleGap)(lastIctCandle?.timestamp ?? null, candle.timestamp);
        if (gap.gapDetected) {
            const summary = (0, candleBufferGap_1.clearIctStateForGap)({
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
            (0, candleBufferGap_1.appendGapResetEvent)(event);
            console.log(`  GAP_RESET ${gap.reason}  oldBuffer=${summary.oldBufferSize}`
                + `  clearedZones=${summary.oldZoneCount} (FVG=${summary.oldFvgCount} IFVG=${summary.oldIfvgCount})`
                + `  clearedCandidates=${summary.oldCandidateCount}`);
        }
        this.candleBuffer.push(candle);
        const maxVolumeBuffer = this.config.volumeLookback + 2;
        if (this.candleBuffer.length > maxVolumeBuffer)
            this.candleBuffer.shift();
        this.ictCandleBuffer.push(candle);
        if (this.ictCandleBuffer.length > MAX_ICT_CANDLE_BUFFER)
            this.ictCandleBuffer.shift();
    }
    processConfiguredSignalSource() {
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
    processVolumeSpikeSignal() {
        const signal = (0, volumeSpikeReversal_1.evaluate)(this.candleBuffer, this.config);
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
    processIctSignal() {
        const tradeSelection = this.evaluateLatestIctTradeSelection();
        const ictSignal = tradeSelection.selectedCandidate?.signal ?? null;
        this.updateRecentSignalWatchValidity(tradeSelection);
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
        const scoreAttribution = (0, scoreAttribution_1.createScoreAttribution)(selectedCandidate);
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
        const sizing = (0, positionSizing_1.calculatePositionSizing)({
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
            (0, sizingRejectionLog_1.appendSizingRejection)(sizing, {
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
            logEvent('ENTRY_SKIP', side, this.tick, `position sizing rejected: ${sizing.rejectionReason} entry=${sizing.entryPrice.toFixed(2)} stop=${sizing.stopPrice.toFixed(2)} risk=${sizing.riskDistance.toFixed(4)} size=$${sizing.recommendedPositionSizeUsd.toFixed(2)} expProfit=$${sizing.expectedProfitUsd.toFixed(4)} expLoss=$${sizing.expectedLossUsd.toFixed(4)} rr=${sizing.riskRewardRatio.toFixed(2)}`);
            return;
        }
        const oppositeProtection = this.applyOppositeSignalProtection(side, this.lastPrice, tradeSelection.action, selectedCandidate);
        if (oppositeProtection.closedProfitPosition) {
            logEvent('ENTRY_SKIP_OPPOSITE_PROFIT_EXIT', side, this.tick, 'opposite profitable position closed; storing signal watch and blocking same-tick reversal entry');
            return;
        }
        // Phase 8D: after protect/close has run, if ANY opposite-side position
        // is still open (BE-armed or waiting in the small-loss zone), block
        // the new opposite entry. The bot should only trade in one direction
        // at a time.
        const oppositeGate = this.gateOppositeExposure(side);
        if (oppositeGate.blockNewEntry) {
            logEvent('ENTRY_SKIP_OPPOSITE_EXPOSURE', side, this.tick, oppositeGate.reason);
            return;
        }
        // Phase 8E: position slot gate — protected positions (BE-armed or
        // stop==entry) do not consume a risk slot. Two caps now apply:
        //   MAX_TOTAL_OPEN_POSITIONS (hard ceiling on simultaneous trades)
        //   MAX_ACTIVE_RISK_POSITIONS (only counts unprotected positions)
        const slotGate = this.evaluatePositionSlotGate();
        if (slotGate.blockNewEntry) {
            const eventName = slotGate.blockReasonCode === 'MAX_TOTAL_POSITIONS'
                ? 'ENTRY_SKIP_MAX_TOTAL_POSITIONS'
                : 'ENTRY_SKIP_MAX_RISK_POSITIONS';
            logEvent(eventName, side, this.tick, slotGate.blockReason);
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
            stopModel: selectedCandidate.stopModel,
            originalStopPrice: selectedCandidate.originalStopPrice,
            tightStopPrice: selectedCandidate.tightStopPrice,
            selectedStopPrice: selectedCandidate.selectedStopPrice,
            stopTightened: selectedCandidate.stopTightened,
            stopTighteningReason: selectedCandidate.stopTighteningReason,
        });
    }
    evaluateLatestIctTradeSelection() {
        if (this.ictCandleBuffer.length < 3) {
            this.latestIctZones = [];
            const tradeSelection = (0, tradeSelectionEngine_1.selectTradeCandidate)({
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
        const rawFvgs = (0, fvgDetector_1.detectFVGs)(this.ictCandleBuffer);
        // Phase 5c: run validation once so we can capture rejection diagnostics
        // alongside the accepted set. validateFVGs returns every raw FVG with
        // its full validation result; detectValidatedFVGs is the accepted-only
        // filter on top of that.
        const validationResults = (0, validatedFvgDetector_1.validateFVGs)(this.ictCandleBuffer);
        const fvgs = validationResults
            .filter(r => r.accepted && r.zone !== null)
            .map(r => r.zone);
        const ifvgs = (0, ifvgDetector_1.detectIFVGs)(fvgs, this.ictCandleBuffer);
        const zones = [...fvgs, ...ifvgs];
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
            const reaction = (0, reactionEngine_1.evaluateReaction)({
                zone,
                candles: this.ictCandleBuffer,
                currentPrice: this.lastPrice,
            });
            const signal = (0, ictSignalEngine_1.createIctSignal)({
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
            let targetSelection = null;
            let stopPrice = null;
            let stopSource = null;
            let stopModel = null;
            let originalStopPrice = null;
            let tightStopPrice = null;
            let selectedStopPrice = null;
            let stopTightened = null;
            let stopTighteningReason = null;
            if (signal.signal === 'BUY' || signal.signal === 'SELL') {
                const side = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
                const stop = (0, stopAttribution_1.resolveStopAttribution)({
                    zone,
                    signal: signal.signal,
                    entryPrice: this.lastPrice,
                    candles: this.ictCandleBuffer,
                    stopModel: this.config.stopModel,
                });
                stopPrice = stop.stopPrice;
                stopSource = stop.stopSource;
                stopModel = stop.stopModel;
                originalStopPrice = stop.originalStopPrice;
                tightStopPrice = stop.tightStopPrice;
                selectedStopPrice = stop.selectedStopPrice;
                stopTightened = stop.stopTightened;
                stopTighteningReason = stop.stopTighteningReason;
                if (stopPrice !== null) {
                    targetSelection = this.runTargetSelection(side, this.lastPrice, stopPrice);
                }
            }
            return { zone, signal, reaction, targetSelection, stopPrice, stopSource, stopModel, originalStopPrice, tightStopPrice, selectedStopPrice, stopTightened, stopTighteningReason };
        });
        const tradeSelection = (0, tradeSelectionEngine_1.selectTradeCandidate)({
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
    auditIctEvaluations(evaluations, tradeSelection) {
        const candidatesByZoneId = new Map(tradeSelection.candidates.map(candidate => [candidate.zoneId, candidate]));
        const records = evaluations.map((evaluation) => (0, ictSignalAuditLog_1.makeIctSignalAuditRecord)({
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
        const summary = (0, ictSignalAuditLog_1.summarizeIctSignalAudit)(records);
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
    debugIctPipeline(stage, overrides = {}) {
        if (!this.config.debugIctPipeline || this.config.signalSource !== 'ICT')
            return;
        const throttleTicks = overrides.throttleTicks ?? 1;
        if (throttleTicks > 1
            && this.tick - this.lastIctPipelineDebugTick < throttleTicks) {
            return;
        }
        this.lastIctPipelineDebugTick = this.tick;
        const latestCandle = this.ictCandleBuffer[this.ictCandleBuffer.length - 1] ?? null;
        const latestTimestamp = latestCandle?.timestamp.toISOString() ?? '--';
        const latestAgeSeconds = latestCandle
            ? Math.max(0, Math.round((Date.now() - latestCandle.timestamp.getTime()) / 1000))
            : null;
        const rawFvgCount = overrides.rawFvgCount
            ?? (this.ictCandleBuffer.length >= 3 ? (0, fvgDetector_1.detectFVGs)(this.ictCandleBuffer).length : 0);
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
        const line = `[${new Date().toISOString()}] stage=${stage}` +
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  !  [${ts()}] ICT pipeline debug log failed: ${msg}`);
        }
    }
    runTargetSelection(side, entryPrice, stopPrice) {
        const swing = this.findSwingTarget(side, entryPrice);
        return (0, targetSelection_1.selectManagedTarget)({
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
    findOpposingZoneTarget(side, entryPrice) {
        let selected = null;
        for (const zone of this.latestIctZones) {
            if (zone.invalidated)
                continue;
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
    findSwingTarget(side, entryPrice) {
        const confirmedSwing = side === 'LONG'
            ? this.findLatestConfirmedSwingHigh(entryPrice)
            : this.findLatestConfirmedSwingLow(entryPrice);
        if (confirmedSwing !== null)
            return confirmedSwing;
        const fallbackCandles = this.ictCandleBuffer.slice(-this.config.ictTargetFallbackLookback);
        if (fallbackCandles.length === 0)
            return null;
        return side === 'LONG'
            ? Math.max(...fallbackCandles.map(candle => candle.high))
            : Math.min(...fallbackCandles.map(candle => candle.low));
    }
    findLatestConfirmedSwingHigh(entryPrice) {
        const { ictTargetSwingLeft: left, ictTargetSwingRight: right } = this.config;
        for (let i = this.ictCandleBuffer.length - 1 - right; i >= left; i--) {
            const candidate = this.ictCandleBuffer[i];
            if (!candidate || candidate.high <= entryPrice)
                continue;
            const window = this.ictCandleBuffer.slice(i - left, i + right + 1);
            if (window.every(candle => candidate.high >= candle.high)) {
                return candidate.high;
            }
        }
        return null;
    }
    findLatestConfirmedSwingLow(entryPrice) {
        const { ictTargetSwingLeft: left, ictTargetSwingRight: right } = this.config;
        for (let i = this.ictCandleBuffer.length - 1 - right; i >= left; i--) {
            const candidate = this.ictCandleBuffer[i];
            if (!candidate || candidate.low >= entryPrice)
                continue;
            const window = this.ictCandleBuffer.slice(i - left, i + right + 1);
            if (window.every(candle => candidate.low <= candle.low)) {
                return candidate.low;
            }
        }
        return null;
    }
    makeManagedTargetState(target) {
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
            breakevenActivationPrice: null,
            breakevenActivationTime: null,
        };
    }
    openInitialPosition(price, trigger) {
        const positionSizeUsd = trigger.positionSizeUsd ?? this.config.orderSizeUsd;
        const fillAmount = positionSizeUsd / price;
        let position = (0, state_1.recordDcaEntry)({
            ...(0, state_1.emptyPositionState)(),
            id: makePositionId(this.tick),
        }, price, fillAmount, positionSizeUsd, trigger.side, { persist: false });
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
                stopModel: trigger.stopModel ?? position.stopModel,
                originalStopPrice: trigger.originalStopPrice ?? position.originalStopPrice,
                tightStopPrice: trigger.tightStopPrice ?? position.tightStopPrice,
                selectedStopPrice: trigger.selectedStopPrice ?? trigger.sizing?.hardStopPrice ?? position.selectedStopPrice,
                stopTightened: trigger.stopTightened ?? position.stopTightened,
                stopTighteningReason: trigger.stopTighteningReason ?? position.stopTighteningReason,
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
        logEvent('ENTRY', trigger.side, this.tick, `$${fp(price)}  size=${fmtToken(fillAmount, this.config.symbol)}${targetDetail}  [${trigger.detail}]`);
        this.journal.logEvent(this.makeEvent('ENTRY', price, fillAmount, 0, trigger.signalDirection, undefined, undefined, position));
    }
    managePositions(price, candle) {
        // Phase 8D: mixed-exposure cleanup runs BEFORE per-position management.
        // If both LONG and SHORT positions are open, any unprotected position
        // losing >= oppositeSignalMaxLossUsd is closed with reason
        // MIXED_EXPOSURE_RISK_EXIT. Protected positions (BE-armed, including
        // partial-runner BE) are left alone.
        this.applyMixedExposureCleanup(price);
        for (const position of [...this.positions]) {
            this.managePosition(position, price, candle);
        }
    }
    managePosition(position, price, candle) {
        const { config } = this;
        if (position.side === 'NONE')
            return;
        this.updateExcursions(position, price);
        if (this.config.signalSource === 'ICT') {
            this.updateIctTradeManagement(position, candle);
        }
        let latestPosition = this.positions.find(active => active.id === position.id) ?? position;
        latestPosition = this.activateBreakEvenIfEligible(latestPosition, price, candle?.timestamp ?? new Date());
        latestPosition = this.partialCloseIfEligible(latestPosition, price, candle?.timestamp ?? new Date());
        const lifecycleExit = (0, positionExitManager_1.evaluatePositionLifecycleExit)(latestPosition, price, candle, {
            takeProfitPct: config.takeProfitPct,
            profitTargetUsdMin: config.profitTargetUsdMin,
            profitTargetUsdMax: config.profitTargetUsdMax,
            maxPositionMinutes: config.maxPositionMinutes,
            maxLossUsd: config.maxLossUsd,
            // Phase 7D: retained for settings compatibility; the exit evaluator no
            // longer closes by quick-profit or time-based rules.
            useQuickProfitExit: true,
        });
        const disrespectEvaluation = lifecycleExit.entryZoneDisrespect;
        if (latestPosition.entryZoneType
            && disrespectEvaluation.entryZoneRespected !== latestPosition.entryZoneRespected) {
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
            this.closePosition(latestPosition, price, lifecycleExit.reason, disrespectEvaluation.shouldClose ? disrespectEvaluation : undefined);
            return;
        }
        const activePosition = this.positions.find(active => active.id === position.id) ?? latestPosition;
        if (activePosition.side === 'NONE')
            return;
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
    updateExcursions(position, price) {
        const latest = this.positions.find(active => active.id === position.id) ?? position;
        const unrealizedPnlUsd = (0, positionExitManager_1.calculateUnrealizedPnl)(latest, price);
        const updated = {
            ...latest,
            maxFavorableExcursionUsd: Math.max(latest.maxFavorableExcursionUsd, unrealizedPnlUsd),
            maxAdverseExcursionUsd: Math.min(latest.maxAdverseExcursionUsd, unrealizedPnlUsd),
        };
        if (updated.maxFavorableExcursionUsd !== latest.maxFavorableExcursionUsd
            || updated.maxAdverseExcursionUsd !== latest.maxAdverseExcursionUsd) {
            this.updatePosition(updated);
        }
    }
    updateIctTradeManagement(position, candle) {
        if (position.side === 'NONE' || !candle)
            return;
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
                };
                stateChanged = true;
                logEvent('TARGET', side, this.tick, `opposing ${opposingTarget.zone?.type ?? 'zone'} target=$${fp(opposingTarget.price)}`);
            }
        }
        if (updatedPosition.targetSource === 'OPPOSING_FVG'
            && this.opposingTargetDisrespected(updatedPosition, candle)) {
            const swingTargetPrice = this.findSwingTarget(side, updatedPosition.averageEntryPrice);
            const validSwingTarget = swingTargetPrice !== null && (side === 'LONG'
                ? swingTargetPrice > updatedPosition.averageEntryPrice
                : swingTargetPrice < updatedPosition.averageEntryPrice);
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
                };
                stateChanged = true;
                logEvent('TARGET', side, this.tick, `opposing FVG disrespected; retarget swing=$${fp(swingTargetPrice)}`);
            }
        }
        if (stateChanged) {
            this.updatePosition(updatedPosition);
        }
    }
    activateBreakEvenIfEligible(position, price, activationTime) {
        if (!(0, positionTradeManagement_1.shouldActivateDollarBreakeven)(position, price, {
            breakevenTriggerProfitUsd: this.config.breakevenTriggerProfitUsd,
        }))
            return position;
        const activated = (0, positionTradeManagement_1.activateDollarBreakeven)(position, price, activationTime);
        const activationIso = activated.breakevenActivationTime ?? activationTime.toISOString();
        const unrealizedPnlUsd = (0, positionExitManager_1.calculateUnrealizedPnl)(position, price);
        this.updatePosition(activated);
        logEvent('BREAKEVEN', position.side, this.tick, `BE Activated  positionId=${position.id ?? '--'}  trigger=$${this.config.breakevenTriggerProfitUsd.toFixed(2)}` +
            `  activationPrice=$${fp(price)}  activationTime=${activationIso}` +
            `  pnl=$${unrealizedPnlUsd.toFixed(2)}  stop=entry $${fp(position.averageEntryPrice)}`);
        this.journal.logEvent(this.makeEvent('BREAKEVEN_ACTIVATED', price, position.activePositionSize, 0, this.currentSignalDirection(), undefined, undefined, activated));
        return activated;
    }
    partialCloseIfEligible(position, price, closeTime) {
        const plan = (0, positionTradeManagement_1.planPartialClose)(position, price, {
            partialCloseEnabled: this.config.partialCloseEnabled,
            partialCloseTriggerProfitUsd: this.config.partialCloseTriggerProfitUsd,
            partialCloseLockProfitUsd: this.config.partialCloseLockProfitUsd,
            partialCloseMaxFraction: this.config.partialCloseMaxFraction,
        });
        if (!plan.shouldClosePartial
            && this.config.partialCloseEnabled
            && !position.partialCloseDone
            && plan.unrealizedProfitAtClose >= this.config.partialCloseTriggerProfitUsd - 1e-9
            && position.activePositionSize <= 0) {
            this.journal.logEvent({
                ...this.makeEvent('PARTIAL_CLOSE_SKIPPED', price, position.activePositionSize, 0, this.currentSignalDirection(), undefined, undefined, position),
                protectionReason: 'Partial close skipped because active position size was too small',
            });
        }
        if (!plan.shouldClosePartial)
            return position;
        const updated = (0, positionTradeManagement_1.applyPartialClose)(position, price, closeTime, plan);
        this.updatePosition(updated);
        logEvent('PARTIAL_CLOSE', position.side, this.tick, `positionId=${position.id ?? '--'}  entry=$${fp(position.averageEntryPrice)}` +
            `  current=$${fp(price)}  originalSize=${plan.originalSize.toFixed(8)}` +
            `  closedSize=${plan.closedSize.toFixed(8)}  remainingSize=${plan.remainingSize.toFixed(8)}` +
            `  realizedPartialPnl=$${plan.realizedPartialPnlUsd.toFixed(2)}` +
            `  unrealizedAtClose=$${plan.unrealizedProfitAtClose.toFixed(2)}` +
            `  fraction=${plan.partialCloseFraction.toFixed(4)}`);
        this.journal.logEvent(this.makeEvent('PARTIAL_CLOSE', price, plan.closedSize, plan.realizedPartialPnlUsd, this.currentSignalDirection(), undefined, undefined, updated));
        return updated;
    }
    applyOppositeSignalProtection(newSignalSide, price, signalDirection, selectedCandidate) {
        let closedProfitPosition = false;
        for (const position of [...this.positions]) {
            const latest = this.positions.find(active => active.id === position.id) ?? position;
            const plan = (0, positionTradeManagement_1.planOppositeSignalProtection)(latest, price, newSignalSide, this.config.oppositeSignalMaxLossUsd);
            if (plan.action === 'NONE')
                continue;
            if (plan.action === 'CLOSE_FOR_PROFIT') {
                const activeStopAfter = plan.activeStopBefore;
                this.closePosition(latest, price, 'OPPOSITE_SIGNAL_PROFIT_EXIT', undefined, {
                    oldSide: latest.side,
                    newSignalSide,
                    activeStopBefore: plan.activeStopBefore ?? undefined,
                    activeStopAfter: activeStopAfter ?? undefined,
                    oppositeSignalProtected: true,
                    protectionReason: plan.protectionReason,
                });
                this.storeRecentOppositeSignalWatch(selectedCandidate, signalDirection);
                closedProfitPosition = true;
                continue;
            }
            if (plan.action === 'CLOSE_FOR_RISK') {
                this.closePosition(latest, price, 'OPPOSITE_SIGNAL_RISK_EXIT', undefined, {
                    oldSide: latest.side,
                    newSignalSide,
                    activeStopBefore: plan.activeStopBefore ?? undefined,
                    activeStopAfter: plan.activeStopBefore ?? undefined,
                    oppositeSignalProtected: true,
                    protectionReason: plan.protectionReason,
                });
                continue;
            }
        }
        return { closedProfitPosition };
    }
    storeRecentOppositeSignalWatch(candidate, signalDirection) {
        if (!this.config.recentSignalWatchEnabled)
            return;
        const now = new Date();
        this.recentOppositeSignalExpiredLogged = false;
        this.stats = {
            ...this.stats,
            ...(0, recentSignalWatch_1.createRecentSignalWatch)({
                side: signalDirection === 'BUY' || signalDirection === 'SELL' ? signalDirection : candidate.signalDirection,
                zoneId: candidate.zoneId,
                confidence: candidate.confidence,
                reason: candidate.reason,
                currentTick: this.tick,
                ttlCandles: this.config.recentSignalWatchTtlCandles,
                now,
                tickIntervalMs: this.config.tickIntervalMs,
            }),
        };
    }
    updateRecentSignalWatchValidity(tradeSelection) {
        if (!this.stats.recentOppositeSignalSide || !this.stats.recentOppositeSignalZoneId)
            return;
        const result = (0, recentSignalWatch_1.evaluateRecentSignalWatch)({
            state: this.stats,
            candidates: tradeSelection.candidates,
            currentTick: this.tick,
            ttlCandles: this.config.recentSignalWatchTtlCandles,
        });
        if (!result.expired) {
            this.stats = { ...this.stats, ...result.state };
            return;
        }
        if (!this.recentOppositeSignalExpiredLogged) {
            logEvent('RECENT_SIGNAL_EXPIRED', this.stats.recentOppositeSignalSide, this.tick, `zone=${this.stats.recentOppositeSignalZoneId} age=${result.ageCandles} valid=${result.valid ? 'YES' : 'NO'}`);
            this.recentOppositeSignalExpiredLogged = true;
        }
        this.stats = { ...this.stats, ...result.state };
    }
    /**
     * Phase 8D: post-protection block decision. Builds snapshots of every
     * currently-open position and asks the pure evaluator whether the new
     * opposite-direction entry is allowed.
     */
    gateOppositeExposure(newSignalSide) {
        const snapshots = this.snapshotPositionsForExposure(this.lastPrice);
        const evaluation = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(snapshots, newSignalSide, {
            oppositeMaxLossUsd: this.config.oppositeSignalMaxLossUsd,
        });
        return { blockNewEntry: evaluation.blockNewEntry, reason: evaluation.blockReason };
    }
    /**
     * Phase 8D: every-tick mixed-exposure cleanup. Closes unprotected
     * losing positions that conflict with an opposite-side position.
     */
    applyMixedExposureCleanup(price) {
        const snapshots = this.snapshotPositionsForExposure(price);
        const plan = (0, oppositeExposureManager_1.evaluateMixedExposureCleanup)(snapshots, {
            oppositeMaxLossUsd: this.config.oppositeSignalMaxLossUsd,
        });
        if (!plan.mixedExposureActive || plan.positionsToClose.length === 0)
            return;
        for (const snap of plan.positionsToClose) {
            const position = this.positions.find(p => (p.id ?? '') === snap.id);
            if (!position || position.side === 'NONE')
                continue;
            const opposingIds = snapshots
                .filter(s => s.side !== snap.side)
                .map(s => s.id);
            logEvent('MIXED_EXPOSURE_RISK_EXIT', position.side, this.tick, `positionId=${snap.id}  side=${snap.side}  entry=${snap.averageEntryPrice.toFixed(2)}  ` +
                `price=${price.toFixed(2)}  pnl=$${snap.unrealizedPnlUsd.toFixed(2)}  ` +
                `opposing=[${opposingIds.join(',')}]  reason="mixed exposure with unprotected loss"`);
            this.closePosition(position, price, 'MIXED_EXPOSURE_RISK_EXIT');
        }
    }
    /**
     * Phase 8E: classify every open position into PROTECTED vs RISK and
     * decide whether a new entry is allowed under the two-cap model.
     */
    evaluatePositionSlotGate() {
        const slotInputs = this.positions
            .filter(p => p.side !== 'NONE')
            .map(p => ({
            id: p.id ?? `pos-${p.openedAt ?? 'unknown'}`,
            stopAtBreakeven: p.stopAtBreakeven,
            partialCloseDone: p.partialCloseDone,
            activeStopPrice: (0, positionTradeManagement_1.getActiveStopPrice)(p),
            averageEntryPrice: p.averageEntryPrice,
        }));
        return (0, positionSlotManager_1.evaluatePositionSlotGate)(slotInputs, {
            maxTotal: this.config.maxTotalOpenPositions,
            maxRisk: this.config.maxActiveRiskPositions,
        });
    }
    snapshotPositionsForExposure(price) {
        return this.positions
            .filter(p => p.side !== 'NONE')
            .map(p => ({
            id: p.id ?? `pos-${p.openedAt ?? 'unknown'}`,
            side: p.side,
            unrealizedPnlUsd: (0, positionExitManager_1.calculateUnrealizedPnl)(p, price),
            stopAtBreakeven: p.stopAtBreakeven,
            averageEntryPrice: p.averageEntryPrice,
            partialClosed: p.dcaCount > 1,
        }));
    }
    opposingTargetEncountered(position, candle) {
        if (position.side === 'NONE'
            || position.targetZoneHigh === null
            || position.targetZoneLow === null) {
            return false;
        }
        return candle.low <= position.targetZoneHigh && candle.high >= position.targetZoneLow;
    }
    opposingTargetDisrespected(position, candle) {
        if (position.side === 'NONE'
            || position.targetZoneHigh === null
            || position.targetZoneLow === null) {
            return false;
        }
        return position.side === 'LONG'
            ? candle.close > position.targetZoneHigh
            : candle.close < position.targetZoneLow;
    }
    executeDca(position, price) {
        if (position.side === 'NONE')
            return;
        const activeSide = position.side;
        const fillAmount = this.config.orderSizeUsd / price;
        const updatedPosition = (0, state_1.recordDcaEntry)(position, price, fillAmount, this.config.orderSizeUsd, activeSide, { persist: false });
        this.updatePosition(updatedPosition);
        const maxLevels = Math.floor(this.config.maxCapUsd / this.config.orderSizeUsd);
        const newTp = activeSide === 'LONG'
            ? updatedPosition.averageEntryPrice * (1 + this.config.takeProfitPct)
            : updatedPosition.averageEntryPrice * (1 - this.config.takeProfitPct);
        logEvent('DCA', activeSide, this.tick, `#${this.position.dcaCount}/${maxLevels}  $${fp(price)}  ` +
            `avg=$${fp(updatedPosition.averageEntryPrice)}  new TP=$${fp(newTp)}  ` +
            `invested=$${updatedPosition.totalUsdInvested.toFixed(0)}`);
        this.journal.logEvent(this.makeEvent('DCA', price, fillAmount, 0, this.currentSignalDirection(), undefined, undefined, updatedPosition));
    }
    closePosition(position, price, reason, disrespectEvaluation, protectionFields) {
        const { config } = this;
        if (position.side === 'NONE')
            return;
        const activeSide = position.side;
        const exitValue = position.activePositionSize * price;
        const entryValue = position.activePositionSize * position.averageEntryPrice;
        const pnlUsd = activeSide === 'LONG'
            ? exitValue - entryValue
            : entryValue - exitValue;
        const totalPnlUsd = position.realizedPartialPnlUsd + pnlUsd;
        const pnlPct = (totalPnlUsd / position.totalUsdInvested) * 100;
        const sign = totalPnlUsd >= 0 ? '+' : '';
        const label = closeReasonLabel(reason);
        const now = new Date();
        const entryTime = position.openedAt
            ? new Date(position.openedAt)
            : this.tradeEntryTime
                ?? (position.openedAt ? new Date(position.openedAt) : now);
        const tradeDurationMinutes = Math.max(0, (now.getTime() - entryTime.getTime()) / 60_000);
        logEvent(label, activeSide, this.tick, `positionId=${position.id ?? '--'}  $${fp(price)}  PnL=${sign}$${totalPnlUsd.toFixed(2)} (${sign}${pnlPct.toFixed(3)}%)  ` +
            `runner=${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}  partial=$${position.realizedPartialPnlUsd.toFixed(2)}  ` +
            `duration=${tradeDurationMinutes.toFixed(2)}m  ` +
            `DCAs=${position.dcaCount - 1}  invested=$${position.totalUsdInvested.toFixed(0)}`);
        const closeEvent = this.makeEvent(reason, price, position.activePositionSize, totalPnlUsd, this.currentSignalDirection(), disrespectEvaluation, tradeDurationMinutes, {
            ...position,
            finalRunnerPnlUsd: pnlUsd,
            totalPnlUsd,
            maxFavorableExcursionUsd: position.maxFavorableExcursionUsd,
            maxAdverseExcursionUsd: position.maxAdverseExcursionUsd,
        });
        Object.assign(closeEvent, protectionFields ?? {});
        const completed = {
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
            realizedPnlUsd: totalPnlUsd,
            positionId: position.id ?? undefined,
            pnlPct,
            reason,
            tradeDurationMinutes,
            ...this.makeEntryZoneFields(disrespectEvaluation, position),
            ...this.makeManagedTargetFields({
                ...position,
                finalRunnerPnlUsd: pnlUsd,
                totalPnlUsd,
                maxFavorableExcursionUsd: position.maxFavorableExcursionUsd,
                maxAdverseExcursionUsd: position.maxAdverseExcursionUsd,
            }),
            ...this.makePositionSizingFields(position),
            ...this.makeScoreAttributionFields(position),
            ...protectionFields,
        };
        this.journal.logClose(closeEvent, completed);
        (0, tradeOutcomeAnalytics_1.generateScoreAttributionReports)();
        this.stats = {
            ...(0, sessionStats_1.recordClosedTrade)(this.stats, totalPnlUsd, config),
            latestCloseReason: reason,
            latestPositionExit: null,
        };
        this.positions = this.positions.filter(active => active.id !== position.id);
        this.persistPositions();
        this.position = this.aggregatePositions();
        this.tradeEntryTime = this.position.openedAt ? new Date(this.position.openedAt) : null;
        this.tradeEntryPrice = this.position.averageEntryPrice;
    }
    makeEvent(action, price, size, realizedPnlUsd, signalDirection, disrespectEvaluation, tradeDurationMinutes, positionOverride) {
        const position = positionOverride ?? this.position;
        const side = position.side === 'NONE' ? this.config.side : position.side;
        const ictSignal = this.latestIctSignal;
        const unrealizedPnlUsd = position.side === 'NONE'
            ? 0
            : (0, positionExitManager_1.calculateUnrealizedPnl)(position, price);
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
            positionId: position.id ?? undefined,
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
            activeStopPrice: (0, positionTradeManagement_1.getActiveStopPrice)(position) ?? undefined,
            unrealizedPnlUsd,
            partialCloseDone: position.partialCloseDone,
            partialClosePrice: position.partialClosePrice ?? undefined,
            partialCloseTime: position.partialCloseTime ?? undefined,
            partialCloseFraction: position.partialCloseFraction ?? undefined,
            realizedPartialPnlUsd: position.realizedPartialPnlUsd,
            remainingSizeAfterPartial: position.remainingSizeAfterPartial ?? undefined,
            finalRunnerPnlUsd: position.finalRunnerPnlUsd ?? undefined,
            totalPnlUsd: position.totalPnlUsd ?? undefined,
            maxFavorableExcursionUsd: position.maxFavorableExcursionUsd,
            maxAdverseExcursionUsd: position.maxAdverseExcursionUsd,
        };
    }
    makeManagedTargetFields(position = this.position) {
        return {
            targetPrice: position.targetPrice ?? undefined,
            targetSource: position.targetSource ?? undefined,
            targetZoneId: position.targetZoneId ?? undefined,
            targetDisrespected: position.targetDisrespected ?? undefined,
            stopAtBreakeven: position.stopAtBreakeven,
            breakevenActivated: position.stopAtBreakeven,
            breakevenActivationPrice: position.breakevenActivationPrice ?? undefined,
            breakevenActivationTime: position.breakevenActivationTime ?? undefined,
            partialCloseDone: position.partialCloseDone,
            partialClosePrice: position.partialClosePrice ?? undefined,
            partialCloseTime: position.partialCloseTime ?? undefined,
            partialCloseFraction: position.partialCloseFraction ?? undefined,
            realizedPartialPnlUsd: position.realizedPartialPnlUsd,
            remainingSizeAfterPartial: position.remainingSizeAfterPartial ?? undefined,
            finalRunnerPnlUsd: position.finalRunnerPnlUsd ?? undefined,
            totalPnlUsd: position.totalPnlUsd ?? undefined,
            maxFavorableExcursionUsd: position.maxFavorableExcursionUsd,
            maxAdverseExcursionUsd: position.maxAdverseExcursionUsd,
        };
    }
    makePositionSizingFields(position = this.position) {
        if (position.positionSizeUsd === null)
            return {};
        return {
            positionSizeUsd: position.positionSizeUsd,
            sizingMode: position.sizingMode ?? undefined,
            hardStopPrice: position.hardStopPrice ?? undefined,
            entryPrice: position.averageEntryPrice,
            stopPrice: position.stopPrice ?? position.hardStopPrice ?? undefined,
            stopSource: position.stopSource ?? undefined,
            riskDistance: position.stopRiskDistance ?? undefined,
            zoneSize: position.stopZoneSize ?? undefined,
            stopModel: position.stopModel ?? undefined,
            originalStopPrice: position.originalStopPrice ?? undefined,
            tightStopPrice: position.tightStopPrice ?? undefined,
            selectedStopPrice: position.selectedStopPrice ?? undefined,
            stopTightened: position.stopTightened ?? undefined,
            stopTighteningReason: position.stopTighteningReason ?? undefined,
            oppositeSignalProtected: position.oppositeSignalProtected,
            expectedProfitUsd: position.expectedProfitUsd ?? undefined,
            expectedLossUsd: position.expectedLossUsd ?? undefined,
            riskRewardRatio: position.riskRewardRatio ?? undefined,
            riskUtilizationPercent: position.riskUtilizationPercent ?? undefined,
            targetRMultiple: position.targetRMultiple ?? undefined,
            selectionScore: position.selectionScore ?? undefined,
        };
    }
    makeScoreAttributionFields(position = this.position) {
        if (position.scoreAttribution === null)
            return {};
        return {
            scoreBreakdown: position.scoreAttribution.breakdown,
            scoreFinal: position.scoreAttribution.finalScore,
            // Phase 5h: discrete copy so report bucketing doesn't need to dig
            // into the breakdown object.
            targetReachProbability: position.scoreAttribution.breakdown.targetReachProbability ?? undefined,
        };
    }
    makeEntryZoneFields(disrespectEvaluation, position = this.position) {
        if (!position.entryZoneId)
            return {};
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
    currentSignalDirection() {
        if (this.config.signalSource === 'ICT') {
            return this.latestIctSignal?.signal ?? 'NONE';
        }
        if (this.config.signalSource === 'VOLUME_SPIKE') {
            return this.latestSignal?.direction ?? 'NONE';
        }
        return 'NONE';
    }
    canAddPaperEntry(activeSide) {
        if (this.config.signalSource === 'ICT') {
            const signal = this.latestIctSignal?.signal ?? 'NONE';
            return activeSide === 'LONG' ? signal === 'BUY' : signal === 'SELL';
        }
        return this.config.signalSource === 'VOLUME_SPIKE';
    }
    canOpenNewPosition() {
        if (!this.config.allowMultiplePositions) {
            return this.positions.length === 0;
        }
        return this.positions.length < this.config.maxConcurrentPositions;
    }
    recordPositionSizingAnalytics(sizing) {
        if (sizing.status !== 'ACCEPTED')
            return;
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
    updatePosition(position) {
        this.positions = this.positions.map(active => active.id === position.id ? position : active);
        this.persistPositions();
        this.position = this.aggregatePositions();
    }
    persistPositions() {
        (0, state_1.saveOpenPositions)(this.positions);
    }
    aggregatePositions() {
        const activePositions = this.positions.filter(position => position.side !== 'NONE');
        if (activePositions.length === 0)
            return (0, state_1.emptyPositionState)();
        if (activePositions.length === 1)
            return { ...activePositions[0] };
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
                .filter((value) => value !== null)
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
            breakevenActivationPrice: null,
            breakevenActivationTime: null,
            partialCloseDone: activePositions.every(position => position.partialCloseDone),
            partialClosePrice: null,
            partialCloseTime: null,
            partialCloseFraction: null,
            realizedPartialPnlUsd: activePositions.reduce((sum, position) => sum + position.realizedPartialPnlUsd, 0),
            remainingSizeAfterPartial: null,
            finalRunnerPnlUsd: null,
            totalPnlUsd: null,
            maxFavorableExcursionUsd: activePositions.reduce((max, position) => Math.max(max, position.maxFavorableExcursionUsd), 0),
            maxAdverseExcursionUsd: activePositions.reduce((min, position) => Math.min(min, position.maxAdverseExcursionUsd), 0),
            hardStopPrice: null,
            hardStopEnabled: activePositions.some(position => position.hardStopEnabled),
            stopPrice: null,
            stopSource: null,
            stopRiskDistance: null,
            stopZoneSize: null,
            stopModel: activePositions
                .map(position => position.stopModel)
                .filter((value) => value !== null)
                .sort()[0] ?? null,
            originalStopPrice: null,
            tightStopPrice: null,
            selectedStopPrice: null,
            stopTightened: activePositions.some(position => position.stopTightened === true),
            stopTighteningReason: null,
            oppositeSignalProtected: activePositions.some(position => position.oppositeSignalProtected),
            positionSizeUsd: totalUsd,
            expectedProfitUsd: activePositions.reduce((sum, position) => sum + (position.expectedProfitUsd ?? 0), 0),
            expectedLossUsd: activePositions.reduce((sum, position) => sum + (position.expectedLossUsd ?? 0), 0),
            riskRewardRatio: null,
            sizingMode: activePositions
                .map(position => position.sizingMode)
                .filter((value) => value !== null)
                .sort()[0] ?? null,
            riskUtilizationPercent: null,
            riskUtilizationWarning: activePositions.some(position => position.riskUtilizationWarning === true),
            targetRMultiple: null,
            expectedMovePercent: null,
            selectionScore: null,
            openPositions: activePositions,
        };
    }
    updatePortfolioUnrealized(stats, price) {
        if (this.positions.length === 0) {
            return (0, sessionStats_1.updateUnrealized)(stats, (0, state_1.emptyPositionState)(), price);
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
exports.BotEngine = BotEngine;
function logEvent(type, side, tick, detail) {
    const labels = {
        ENTRY: 'ENTRY',
        DCA: 'DCA',
        TARGET: 'TARGET',
        BREAKEVEN: 'BREAKEVEN',
        'TAKE PROFIT': 'TAKE_PROFIT',
        'RISK EXIT': 'RISK_EXIT',
    };
    console.log(`  ${labels[type] ?? type} [${ts()}][tick ${tick}] ${side}  ${detail}`);
}
function closeReasonLabel(reason) {
    if (reason === 'TAKE_PROFIT')
        return 'TAKE PROFIT';
    if (reason === 'MANAGED_TARGET_EXIT')
        return 'MANAGED_TARGET';
    if (reason === 'BREAKEVEN_STOP_EXIT')
        return 'BREAKEVEN_STOP';
    if (reason === 'HARD_STOP_EXIT')
        return 'HARD_STOP';
    if (reason === 'OPPOSITE_SIGNAL_PROFIT_EXIT')
        return 'OPPOSITE_SIGNAL_PROFIT';
    if (reason === 'OPPOSITE_SIGNAL_RISK_EXIT')
        return 'OPPOSITE_SIGNAL_RISK';
    return reason;
}
function fp(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtToken(n, symbol) {
    const dp = symbol === 'BTC' ? 6 : symbol === 'ETH' ? 4 : 3;
    return n.toFixed(dp) + ' ' + symbol;
}
function ts() {
    return new Date().toTimeString().slice(0, 8);
}
function makePositionId(tick) {
    return `${new Date().toISOString()}-${tick}`;
}

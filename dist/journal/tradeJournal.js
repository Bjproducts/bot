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
exports.TradeJournal = void 0;
exports.repairTradesCsvHeader = repairTradesCsvHeader;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const CSV_PATH = path.join(LOGS_DIR, 'trades.csv');
const EVENT_LOG_PATH = path.join(LOGS_DIR, 'events.log');
const COMPLETED_TRADES_PATH = path.join(LOGS_DIR, 'completed-trades.json');
const TRADE_EVENTS_JSONL_PATH = path.join(LOGS_DIR, 'trade-events.jsonl');
const COMPLETED_TRADES_JSONL_PATH = path.join(LOGS_DIR, 'completed-trades.jsonl');
const DURABLE_EVENT_TYPES = new Set([
    'ENTRY',
    'BREAKEVEN_ACTIVATED',
    'PARTIAL_CLOSE',
    'MANAGED_TARGET_EXIT',
    'BREAKEVEN_STOP_EXIT',
    'ENTRY_ZONE_DISRESPECT_EXIT',
    'HARD_STOP_EXIT',
    'RISK_EXIT',
    'OPPOSITE_SIGNAL_PROFIT_EXIT',
    'OPPOSITE_SIGNAL_BE_PROTECTION',
    'OPPOSITE_SIGNAL_RISK_EXIT',
    'PARTIAL_CLOSE_SKIPPED',
]);
/**
 * TradeJournal — writes every trade event to three log targets:
 *
 *   logs/trades.csv           Append-only CSV, one row per event
 *   logs/events.log           Human-readable timestamped event log
 *   logs/completed-trades.json  Array of fully closed trade records
 *
 * All writes are synchronous and append-only (safe for long sessions).
 * The logs/ directory is created on first use if it doesn't exist.
 */
class TradeJournal {
    logsDir;
    csvPath;
    eventLogPath;
    completedTradesPath;
    tradeEventsJsonlPath;
    completedTradesJsonlPath;
    lastWriteAt = null;
    lastError = null;
    tradeEventsLogged = 0;
    completedTradesLogged = 0;
    constructor(options = {}) {
        this.logsDir = options.logsDir ?? LOGS_DIR;
        this.csvPath = path.join(this.logsDir, 'trades.csv');
        this.eventLogPath = path.join(this.logsDir, 'events.log');
        this.completedTradesPath = path.join(this.logsDir, 'completed-trades.json');
        this.tradeEventsJsonlPath = path.join(this.logsDir, 'trade-events.jsonl');
        this.completedTradesJsonlPath = path.join(this.logsDir, 'completed-trades.jsonl');
        this.ensureLogsDir();
        this.ensureCsvHeader();
        this.ensureCompletedTradesFile();
        this.ensureAppendOnlyFiles();
        this.tradeEventsLogged = countJsonlRows(this.tradeEventsJsonlPath);
        this.completedTradesLogged = countJsonlRows(this.completedTradesJsonlPath);
    }
    // ─── Public API ────────────────────────────────────────────────────────────
    /** Log an ENTRY or DCA event to CSV + events.log. */
    logEvent(event) {
        this.appendCsvRow(event);
        this.appendEventLine(event);
        this.appendTradeEventJsonl(event);
    }
    /** Log a close event and append a CompletedTrade to the JSON file. */
    logClose(event, trade) {
        this.appendCsvRow(event);
        this.appendEventLine(event);
        this.appendTradeEventJsonl(event);
        this.appendCompletedTrade(trade);
        this.appendCompletedTradeJsonl(event, trade);
    }
    getStatus() {
        return {
            status: this.lastError === null ? 'OK' : 'ERROR',
            lastJournalWrite: this.lastWriteAt,
            completedTradesLogged: this.completedTradesLogged,
            tradeEventsLogged: this.tradeEventsLogged,
            lastError: this.lastError,
        };
    }
    // ─── CSV ───────────────────────────────────────────────────────────────────
    appendCsvRow(e) {
        const row = [
            e.timestamp,
            e.symbol,
            csv(e.marketDataSource),
            e.action,
            e.side,
            e.price.toFixed(2),
            e.size.toFixed(8),
            e.investedUsd.toFixed(2),
            e.avgEntry.toFixed(2),
            e.dcaCount,
            e.realizedPnlUsd.toFixed(4),
            csv(e.positionId ?? ''),
            e.signalDirection,
            e.signalSource,
            e.ictSignal ?? '',
            e.ictConfidence !== undefined ? e.ictConfidence.toFixed(2) : '',
            csv(e.ictZoneId ?? ''),
            e.ictZoneType ?? '',
            csv(e.ictReason ?? ''),
            csv(e.entryZoneId ?? ''),
            e.entryZoneType ?? '',
            e.entryZoneHigh !== undefined ? e.entryZoneHigh.toFixed(2) : '',
            e.entryZoneLow !== undefined ? e.entryZoneLow.toFixed(2) : '',
            e.entryZoneMidpoint !== undefined ? e.entryZoneMidpoint.toFixed(2) : '',
            e.entryZoneDirection ?? '',
            e.entryZoneRespected !== undefined ? String(e.entryZoneRespected) : '',
            e.targetPrice !== undefined ? e.targetPrice.toFixed(2) : '',
            e.targetSource ?? '',
            csv(e.targetZoneId ?? ''),
            e.targetDisrespected !== undefined ? String(e.targetDisrespected) : '',
            e.stopAtBreakeven !== undefined ? String(e.stopAtBreakeven) : '',
            e.breakevenActivated !== undefined ? String(e.breakevenActivated) : '',
            e.breakevenActivationPrice !== undefined ? e.breakevenActivationPrice.toFixed(2) : '',
            e.breakevenActivationTime ?? '',
            e.activeStopPrice !== undefined ? e.activeStopPrice.toFixed(2) : '',
            e.unrealizedPnlUsd !== undefined ? e.unrealizedPnlUsd.toFixed(4) : '',
            e.partialCloseDone !== undefined ? String(e.partialCloseDone) : '',
            e.partialClosePrice !== undefined ? e.partialClosePrice.toFixed(2) : '',
            e.partialCloseTime ?? '',
            e.partialCloseFraction !== undefined ? e.partialCloseFraction.toFixed(6) : '',
            e.realizedPartialPnlUsd !== undefined ? e.realizedPartialPnlUsd.toFixed(4) : '',
            e.remainingSizeAfterPartial !== undefined ? e.remainingSizeAfterPartial.toFixed(8) : '',
            e.finalRunnerPnlUsd !== undefined ? e.finalRunnerPnlUsd.toFixed(4) : '',
            e.totalPnlUsd !== undefined ? e.totalPnlUsd.toFixed(4) : '',
            e.maxFavorableExcursionUsd !== undefined ? e.maxFavorableExcursionUsd.toFixed(4) : '',
            e.maxAdverseExcursionUsd !== undefined ? e.maxAdverseExcursionUsd.toFixed(4) : '',
            e.positionSizeUsd !== undefined ? e.positionSizeUsd.toFixed(2) : '',
            e.sizingMode ?? '',
            e.hardStopPrice !== undefined ? e.hardStopPrice.toFixed(2) : '',
            e.entryPrice !== undefined ? e.entryPrice.toFixed(2) : '',
            e.stopPrice !== undefined ? e.stopPrice.toFixed(2) : '',
            e.riskDistance !== undefined ? e.riskDistance.toFixed(4) : '',
            e.zoneSize !== undefined ? e.zoneSize.toFixed(4) : '',
            e.stopSource ?? '',
            e.stopModel ?? '',
            e.originalStopPrice !== undefined ? e.originalStopPrice.toFixed(2) : '',
            e.tightStopPrice !== undefined ? e.tightStopPrice.toFixed(2) : '',
            e.selectedStopPrice !== undefined ? e.selectedStopPrice.toFixed(2) : '',
            e.stopTightened !== undefined ? String(e.stopTightened) : '',
            csv(e.stopTighteningReason ?? ''),
            e.oppositeSignalProtected !== undefined ? String(e.oppositeSignalProtected) : '',
            e.oldSide ?? '',
            e.newSignalSide ?? '',
            e.activeStopBefore !== undefined ? e.activeStopBefore.toFixed(2) : '',
            e.activeStopAfter !== undefined ? e.activeStopAfter.toFixed(2) : '',
            csv(e.protectionReason ?? ''),
            e.expectedProfitUsd !== undefined ? e.expectedProfitUsd.toFixed(4) : '',
            e.expectedLossUsd !== undefined ? e.expectedLossUsd.toFixed(4) : '',
            e.riskRewardRatio !== undefined ? e.riskRewardRatio.toFixed(4) : '',
            e.riskUtilizationPercent !== undefined ? e.riskUtilizationPercent.toFixed(2) : '',
            e.targetRMultiple !== undefined ? e.targetRMultiple.toFixed(2) : '',
            e.selectionScore !== undefined ? e.selectionScore.toFixed(2) : '',
            csv(e.scoreBreakdown !== undefined ? JSON.stringify(e.scoreBreakdown) : ''),
            e.scoreFinal !== undefined ? e.scoreFinal.toFixed(2) : '',
            e.targetReachProbability !== undefined ? e.targetReachProbability.toFixed(2) : '',
            e.reactionTier ?? '',
            e.disrespectCandleClose !== undefined ? e.disrespectCandleClose.toFixed(2) : '',
            e.zoneBoundaryViolated ?? '',
            e.tradeDurationMinutes !== undefined ? e.tradeDurationMinutes.toFixed(2) : '',
        ].join(',');
        try {
            fs.appendFileSync(this.csvPath, row + '\n', 'utf-8');
        }
        catch (err) {
            console.error('  ⚠  Journal: failed to write CSV row:', err);
        }
    }
    // ─── Events log ────────────────────────────────────────────────────────────
    appendEventLine(e) {
        const sign = e.realizedPnlUsd >= 0 ? '+' : '';
        const pnlPart = e.realizedPnlUsd !== 0
            ? `  pnl=${sign}$${e.realizedPnlUsd.toFixed(2)}`
            : '';
        const ictPart = e.ictSignal
            ? `  signalSource=${e.signalSource}` +
                `  ict=${e.ictSignal}` +
                `  confidence=${e.ictConfidence !== undefined ? e.ictConfidence.toFixed(2) : '--'}` +
                `  zone=${e.ictZoneType ?? '--'}:${e.ictZoneId ?? '--'}` +
                `  reason="${e.ictReason ?? ''}"`
            : `  signalSource=${e.signalSource}`;
        const entryZonePart = e.entryZoneId
            ? `  entryZone=${e.entryZoneType ?? '--'}:${e.entryZoneId}` +
                `  entryZoneHigh=${moneyOrDash(e.entryZoneHigh)}` +
                `  entryZoneLow=${moneyOrDash(e.entryZoneLow)}` +
                `  entryZoneRespected=${e.entryZoneRespected !== undefined ? e.entryZoneRespected : '--'}` +
                `  disrespectClose=${moneyOrDash(e.disrespectCandleClose)}` +
                `  boundary=${e.zoneBoundaryViolated ?? '--'}`
            : '';
        const durationPart = e.tradeDurationMinutes !== undefined
            ? `  duration=${e.tradeDurationMinutes.toFixed(2)}m`
            : '';
        const managementPart = `  activeStop=${moneyOrDash(e.activeStopPrice)}` +
            `  unrealized=${moneyOrDash(e.unrealizedPnlUsd)}` +
            `  partialDone=${e.partialCloseDone !== undefined ? e.partialCloseDone : '--'}` +
            `  partialPrice=${moneyOrDash(e.partialClosePrice)}` +
            `  partialTime=${e.partialCloseTime ?? '--'}` +
            `  partialFraction=${e.partialCloseFraction !== undefined ? e.partialCloseFraction.toFixed(4) : '--'}` +
            `  realizedPartial=${moneyOrDash(e.realizedPartialPnlUsd)}` +
            `  remainingAfterPartial=${e.remainingSizeAfterPartial !== undefined ? e.remainingSizeAfterPartial.toFixed(8) : '--'}` +
            `  finalRunner=${moneyOrDash(e.finalRunnerPnlUsd)}` +
            `  totalPnl=${moneyOrDash(e.totalPnlUsd)}` +
            `  mfe=${moneyOrDash(e.maxFavorableExcursionUsd)}` +
            `  mae=${moneyOrDash(e.maxAdverseExcursionUsd)}`;
        const targetPart = e.targetPrice !== undefined
            ? `  target=${e.targetSource ?? '--'}:$${e.targetPrice.toFixed(2)}` +
                `  targetZone=${e.targetZoneId ?? '--'}` +
                `  targetDisrespected=${e.targetDisrespected !== undefined ? e.targetDisrespected : '--'}` +
                `  stopAtBE=${e.stopAtBreakeven !== undefined ? e.stopAtBreakeven : '--'}` +
                `  beActivated=${e.breakevenActivated !== undefined ? e.breakevenActivated : '--'}` +
                `  beActivationPrice=${moneyOrDash(e.breakevenActivationPrice)}` +
                `  beActivationTime=${e.breakevenActivationTime ?? '--'}`
            : '';
        const sizingPart = e.positionSizeUsd !== undefined
            ? `  positionSize=$${e.positionSizeUsd.toFixed(2)}` +
                `  sizingMode=${e.sizingMode ?? '--'}` +
                `  hardStop=${moneyOrDash(e.hardStopPrice)}` +
                `  entry=${moneyOrDash(e.entryPrice)}` +
                `  stop=${moneyOrDash(e.stopPrice)}` +
                `  stopSource=${e.stopSource ?? '--'}` +
                `  stopModel=${e.stopModel ?? '--'}` +
                `  originalStop=${moneyOrDash(e.originalStopPrice)}` +
                `  tightStop=${moneyOrDash(e.tightStopPrice)}` +
                `  selectedStop=${moneyOrDash(e.selectedStopPrice)}` +
                `  stopTightened=${e.stopTightened !== undefined ? e.stopTightened : '--'}` +
                `  stopTighteningReason="${e.stopTighteningReason ?? ''}"` +
                `  oppositeProtected=${e.oppositeSignalProtected !== undefined ? e.oppositeSignalProtected : '--'}` +
                `  oldSide=${e.oldSide ?? '--'}` +
                `  newSignalSide=${e.newSignalSide ?? '--'}` +
                `  activeStopBefore=${moneyOrDash(e.activeStopBefore)}` +
                `  activeStopAfter=${moneyOrDash(e.activeStopAfter)}` +
                `  protectionReason="${e.protectionReason ?? ''}"` +
                `  riskDistance=${e.riskDistance !== undefined ? e.riskDistance.toFixed(4) : '--'}` +
                `  zoneSize=${e.zoneSize !== undefined ? e.zoneSize.toFixed(4) : '--'}` +
                `  expectedProfit=$${money(e.expectedProfitUsd)}` +
                `  expectedLoss=$${money(e.expectedLossUsd)}` +
                `  rr=${e.riskRewardRatio !== undefined ? e.riskRewardRatio.toFixed(2) : '--'}` +
                `  riskUtilization=${e.riskUtilizationPercent !== undefined ? e.riskUtilizationPercent.toFixed(2) + '%' : '--'}` +
                `  targetR=${e.targetRMultiple !== undefined ? e.targetRMultiple.toFixed(2) : '--'}` +
                `  selectionScore=${e.selectionScore !== undefined ? e.selectionScore.toFixed(2) : '--'}`
            : '';
        const scorePart = e.scoreBreakdown !== undefined
            ? `  scoreFinal=${e.scoreFinal !== undefined ? e.scoreFinal.toFixed(2) : '--'}` +
                `  targetReachProbability=${e.targetReachProbability !== undefined ? e.targetReachProbability.toFixed(2) : '--'}` +
                `  reactionTier=${e.reactionTier ?? '--'}` +
                `  scoreBreakdown=${JSON.stringify(e.scoreBreakdown)}`
            : '';
        const line = `[${e.timestamp}] ${e.action.padEnd(12)} ${e.side} ${e.symbol}` +
            `  price=$${e.price.toFixed(2)}` +
            `  size=${e.size.toFixed(6)}` +
            `  invested=$${e.investedUsd.toFixed(2)}` +
            `  avgEntry=$${e.avgEntry.toFixed(2)}` +
            `  positionId=${e.positionId ?? '--'}` +
            `  dca=${e.dcaCount}` +
            `  signal=${e.signalDirection}` +
            ictPart +
            entryZonePart +
            targetPart +
            managementPart +
            sizingPart +
            scorePart +
            durationPart +
            pnlPart +
            `  src=${e.marketDataSource}` +
            '\n';
        try {
            fs.appendFileSync(this.eventLogPath, line, 'utf-8');
            this.markWrite();
        }
        catch (err) {
            console.error('  ⚠  Journal: failed to write event log line:', err);
        }
    }
    // ─── Completed trades ──────────────────────────────────────────────────────
    appendTradeEventJsonl(event) {
        if (!DURABLE_EVENT_TYPES.has(event.action))
            return;
        const record = {
            timestamp: event.timestamp,
            positionId: event.positionId ?? null,
            symbol: event.symbol,
            side: event.side,
            eventType: event.action,
            entryPrice: event.entryPrice ?? event.avgEntry,
            currentPrice: event.price,
            targetPrice: event.targetPrice ?? null,
            hardStopPrice: event.hardStopPrice ?? null,
            activeStopPrice: event.activeStopPrice ?? null,
            positionSizeUsd: event.positionSizeUsd ?? event.investedUsd,
            quantity: event.size,
            unrealizedPnlUsd: event.unrealizedPnlUsd ?? null,
            realizedPnlUsd: event.realizedPnlUsd,
            realizedPartialPnlUsd: event.realizedPartialPnlUsd ?? 0,
            runnerPnlUsd: event.finalRunnerPnlUsd ?? null,
            totalPnlUsd: event.totalPnlUsd ?? event.realizedPnlUsd,
            confidence: event.ictConfidence ?? null,
            zoneId: event.ictZoneId ?? event.entryZoneId ?? null,
            zoneType: event.ictZoneType ?? event.entryZoneType ?? null,
            stopSource: event.stopSource ?? null,
            stopModel: event.stopModel ?? null,
            originalStopPrice: event.originalStopPrice ?? null,
            tightStopPrice: event.tightStopPrice ?? null,
            selectedStopPrice: event.selectedStopPrice ?? null,
            stopTightened: event.stopTightened ?? null,
            stopTighteningReason: event.stopTighteningReason ?? null,
            oppositeSignalProtected: event.oppositeSignalProtected ?? null,
            oldSide: event.oldSide ?? null,
            newSignalSide: event.newSignalSide ?? null,
            activeStopBefore: event.activeStopBefore ?? null,
            activeStopAfter: event.activeStopAfter ?? null,
            reason: event.protectionReason ?? null,
            riskDistance: event.riskDistance ?? null,
            expectedProfitUsd: event.expectedProfitUsd ?? null,
            expectedLossUsd: event.expectedLossUsd ?? null,
            riskRewardRatio: event.riskRewardRatio ?? null,
            exitReason: event.action.endsWith('_EXIT') ? event.action : null,
        };
        this.appendJsonLine(this.tradeEventsJsonlPath, record);
        this.tradeEventsLogged += 1;
    }
    appendCompletedTradeJsonl(event, trade) {
        const record = {
            entryEvent: {
                timestamp: trade.entryTimestamp,
                positionId: trade.positionId ?? event.positionId ?? null,
                symbol: trade.symbol,
                side: trade.side,
                entryPrice: trade.entryPrice,
                confidence: event.ictConfidence ?? null,
                zoneId: event.ictZoneId ?? trade.entryZoneId ?? null,
                zoneType: event.ictZoneType ?? trade.entryZoneType ?? null,
            },
            partialClose: {
                partialCloseDone: trade.partialCloseDone ?? false,
                partialClosePrice: trade.partialClosePrice ?? null,
                partialCloseTime: trade.partialCloseTime ?? null,
                partialCloseFraction: trade.partialCloseFraction ?? null,
                realizedPartialPnlUsd: trade.realizedPartialPnlUsd ?? 0,
                remainingSizeAfterPartial: trade.remainingSizeAfterPartial ?? null,
            },
            breakeven: {
                activated: trade.breakevenActivated ?? trade.stopAtBreakeven ?? false,
                activationPrice: trade.breakevenActivationPrice ?? null,
                activationTime: trade.breakevenActivationTime ?? null,
            },
            finalExit: {
                timestamp: trade.exitTimestamp,
                exitPrice: trade.exitPrice,
                exitReason: trade.reason,
                runnerPnlUsd: trade.finalRunnerPnlUsd ?? null,
                totalPnlUsd: trade.totalPnlUsd ?? trade.realizedPnlUsd,
            },
            finalTotalPnlUsd: trade.totalPnlUsd ?? trade.realizedPnlUsd,
            exitType: trade.reason,
            durationMinutes: trade.tradeDurationMinutes ?? null,
            mfeUsd: trade.maxFavorableExcursionUsd ?? null,
            maeUsd: trade.maxAdverseExcursionUsd ?? null,
            trade,
        };
        this.appendJsonLine(this.completedTradesJsonlPath, record);
        this.completedTradesLogged += 1;
    }
    appendJsonLine(filePath, record) {
        try {
            fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
            this.markWrite();
        }
        catch (err) {
            this.markError(err);
            console.error('  Journal: failed to write JSONL row:', err);
        }
    }
    appendCompletedTrade(trade) {
        try {
            const existing = this.readCompletedTrades();
            existing.push(trade);
            fs.writeFileSync(this.completedTradesPath, JSON.stringify(existing, null, 2), 'utf-8');
            this.markWrite();
        }
        catch (err) {
            console.error('  ⚠  Journal: failed to save completed trade:', err);
        }
    }
    readCompletedTrades() {
        try {
            const raw = fs.readFileSync(this.completedTradesPath, 'utf-8').trim();
            return raw ? JSON.parse(raw) : [];
        }
        catch {
            return [];
        }
    }
    // ─── Init ─────────────────────────────────────────────────────────────────
    ensureLogsDir() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }
    ensureCsvHeader() {
        repairTradesCsvHeader(this.logsDir);
    }
    ensureCompletedTradesFile() {
        if (!fs.existsSync(this.completedTradesPath)) {
            fs.writeFileSync(this.completedTradesPath, '[]', 'utf-8');
        }
    }
    ensureAppendOnlyFiles() {
        for (const filePath of [this.eventLogPath, this.tradeEventsJsonlPath, this.completedTradesJsonlPath]) {
            if (!fs.existsSync(filePath)) {
                fs.closeSync(fs.openSync(filePath, 'a'));
            }
        }
    }
    markWrite() {
        this.lastWriteAt = new Date().toISOString();
        this.lastError = null;
    }
    markError(err) {
        this.lastError = err instanceof Error ? err.message : String(err);
    }
}
exports.TradeJournal = TradeJournal;
function csv(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function moneyOrDash(value) {
    return value !== undefined ? `$${value.toFixed(2)}` : '--';
}
function money(value) {
    return value !== undefined ? value.toFixed(2) : '--';
}
function countJsonlRows(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return 0;
        const raw = fs.readFileSync(filePath, 'utf-8').trim();
        return raw.length === 0 ? 0 : raw.split(/\r?\n/).length;
    }
    catch {
        return 0;
    }
}
function repairTradesCsvHeader(logsDir = LOGS_DIR) {
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const csvPath = path.join(logsDir, 'trades.csv');
    if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
        fs.writeFileSync(csvPath, types_1.CSV_HEADER + '\n', 'utf-8');
        return { csvPath, repaired: false, created: true };
    }
    const raw = fs.readFileSync(csvPath, 'utf-8');
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const currentHeader = lines[0] ?? '';
    if (currentHeader === types_1.CSV_HEADER) {
        return { csvPath, repaired: false, created: false };
    }
    lines[0] = types_1.CSV_HEADER;
    fs.writeFileSync(csvPath, lines.join(newline), 'utf-8');
    return { csvPath, repaired: true, created: false };
}

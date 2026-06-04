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
exports.createSessionStats = createSessionStats;
exports.updateUnrealized = updateUnrealized;
exports.recordClosedTrade = recordClosedTrade;
exports.saveSessionStats = saveSessionStats;
exports.printDashboard = printDashboard;
exports.appendSessionStatsHistory = appendSessionStatsHistory;
exports.formatPerPositionRows = formatPerPositionRows;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const positionExitManager_1 = require("./positionExitManager");
const positionTradeManagement_1 = require("./positionTradeManagement");
const exchangeTypes_1 = require("./execution/exchangeTypes");
const scoreAttribution_1 = require("./analytics/scoreAttribution");
const oppositeExposureManager_1 = require("./risk/oppositeExposureManager");
const positionSlotManager_1 = require("./risk/positionSlotManager");
const STATS_FILE = path.resolve(__dirname, '../session-stats.json');
const SESSION_STATS_HISTORY_FILE = path.resolve(__dirname, '../logs/session-stats-history.jsonl');
const SCORE_ATTRIBUTION_REPORT_FILE = path.resolve(__dirname, '../logs/score-attribution-report.json');
function createSessionStats(config, sourceName) {
    const now = new Date().toISOString();
    return {
        startedAt: now,
        updatedAt: now,
        symbol: config.symbol,
        side: config.side,
        dataSource: sourceName,
        ticks: 0,
        completedTrades: 0,
        wins: 0,
        losses: 0,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        currentDrawdownUsd: 0,
        maxDrawdownUsd: 0,
        maxCapitalUsed: 0,
        sessionEquity: config.startingCapital,
        latestSignal: null,
        latestIctSignal: null,
        latestTradeSelection: null,
        latestPositionExit: null,
        latestPositionSizing: null,
        latestTargetSelection: null,
        latestFvgRejectionSummary: null,
        latestCloseReason: null,
        journalStatus: 'OK',
        lastJournalWrite: null,
        completedTradesLogged: 0,
        tradeEventsLogged: 0,
        signalsFired: 0,
        ictEvaluations: 0,
        ictBuyCount: 0,
        ictSellCount: 0,
        ictNoneCount: 0,
        ictAccepted: 0,
        ictRejected: 0,
        gapResets: 0,
        lastGapSeconds: null,
        sizingRejections: 0,
        lastSizingRejectionReason: null,
        todayDate: todayString(),
        todayPnlUsd: 0,
        todayTrades: 0,
        liveTradingEnabled: config.liveTradingEnabled,
        exchangeName: config.exchangeName,
        liveArmed: !config.requireManualArm || config.liveArmConfirm === exchangeTypes_1.LIVE_ARM_CONFIRMATION,
        dailyLiveTrades: 0,
        dailyLivePnlUsd: 0,
        maxDailyLossUsd: config.maxDailyLossUsd,
        lastLiveOrderStatus: null,
        positionSizingSamples: 0,
        totalPositionSizeUsd: 0,
        totalExpectedProfitUsd: 0,
        totalExpectedLossUsd: 0,
        positionSizeDistribution: {
            small: 0,
            medium: 0,
            large: 0,
        },
    };
}
function updateUnrealized(stats, position, price) {
    if (position.side === 'NONE') {
        return { ...stats, unrealizedPnlUsd: 0, updatedAt: new Date().toISOString() };
    }
    const positionValue = position.activePositionSize * price;
    const costBasis = position.activePositionSize * position.averageEntryPrice;
    const unrealized = position.side === 'LONG'
        ? positionValue - costBasis
        : costBasis - positionValue;
    const equity = stats.sessionEquity + unrealized;
    const drawdown = Math.max(0, stats.sessionEquity - equity);
    const maxDrawdown = Math.max(stats.maxDrawdownUsd, drawdown);
    const maxCap = Math.max(stats.maxCapitalUsed, position.totalUsdInvested);
    return {
        ...stats,
        unrealizedPnlUsd: unrealized,
        currentDrawdownUsd: drawdown,
        maxDrawdownUsd: maxDrawdown,
        maxCapitalUsed: maxCap,
        updatedAt: new Date().toISOString(),
    };
}
function recordClosedTrade(stats, pnlUsd, config) {
    const isWin = pnlUsd > 0;
    const newRealized = stats.realizedPnlUsd + pnlUsd;
    const newEquity = config.startingCapital + newRealized;
    const today = todayString();
    const isSameDay = today === stats.todayDate;
    const todayPnl = (isSameDay ? stats.todayPnlUsd : 0) + pnlUsd;
    const todayTrades = (isSameDay ? stats.todayTrades : 0) + 1;
    return {
        ...stats,
        completedTrades: stats.completedTrades + 1,
        wins: stats.wins + (isWin ? 1 : 0),
        losses: stats.losses + (isWin ? 0 : 1),
        realizedPnlUsd: newRealized,
        unrealizedPnlUsd: 0,
        sessionEquity: newEquity,
        todayDate: today,
        todayPnlUsd: todayPnl,
        todayTrades,
        updatedAt: new Date().toISOString(),
    };
}
function saveSessionStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
    appendSessionStatsHistory(stats);
}
function printDashboard(stats, position, price, config, signal = null, ictSignal = null) {
    const now = new Date().toTimeString().slice(0, 8);
    const maxLvls = Math.floor(config.maxCapUsd / config.orderSizeUsd);
    const uptime = fmtUptime(stats.ticks * (config.tickIntervalMs / 1000));
    const hasPosition = position.side !== 'NONE';
    const activeSide = hasPosition ? position.side : config.side;
    const activePositionCount = position.openPositions?.length ?? (hasPosition ? 1 : 0);
    const tpPrice = hasPosition ? (0, positionExitManager_1.calculateTakeProfitPrice)(position, config.takeProfitPct) : 0;
    const nextDcaPrice = hasPosition
        ? position.lastDcaPrice * (1 + (activeSide === 'LONG' ? -1 : 1) * config.dcaTriggerPct)
        : 0;
    const distToTpUsd = hasPosition ? Math.abs(tpPrice - price) : 0;
    const distToTpPct = hasPosition ? (distToTpUsd / price) * 100 : 0;
    const distToDcaUsd = hasPosition ? Math.abs(nextDcaPrice - price) : 0;
    const distToDcaPct = hasPosition ? (distToDcaUsd / price) * 100 : 0;
    const sig = signal ?? stats.latestSignal;
    const sigDir = sig?.direction ?? 'NONE';
    const sigLine = `${sigDir.padEnd(4)}` +
        `  drop=${sig ? (sig.priceDrop * 100).toFixed(2) + '%' : '--'}` +
        `  vol=${sig ? sig.volumeRatio.toFixed(1) + 'x' : '--'}` +
        `  ${sig ? (sig.closedAbovePrev ? 'close-up' : 'close-down') : ''}` +
        `  (fired: ${stats.signalsFired})`;
    const ict = ictSignal ?? stats.latestIctSignal;
    const tradeSelection = stats.latestTradeSelection;
    const selectedCandidate = tradeSelection?.selectedCandidate ?? null;
    const selectedAttribution = selectedCandidate ? (0, scoreAttribution_1.createScoreAttribution)(selectedCandidate) : null;
    const topFactors = loadTopPerformingFactors();
    const sizing = stats.latestPositionSizing;
    const avgPositionSize = stats.positionSizingSamples > 0
        ? stats.totalPositionSizeUsd / stats.positionSizingSamples
        : 0;
    const avgExpectedProfit = stats.positionSizingSamples > 0
        ? stats.totalExpectedProfitUsd / stats.positionSizingSamples
        : 0;
    const avgExpectedLoss = stats.positionSizingSamples > 0
        ? stats.totalExpectedLossUsd / stats.positionSizingSamples
        : 0;
    const ictLine = `${(ict?.signal ?? 'NONE').padEnd(4)}` +
        `  confidence=${ict ? ict.confidence.toFixed(2) : '--'}` +
        `  zone=${ict ? ict.sourceZoneType : '--'}` +
        `  id=${ict ? shorten(ict.zoneId, 16) : '--'}` +
        `  reason=${ict ? shorten(ict.reason, 22) : '--'}` +
        `  (fired: ${stats.signalsFired})`;
    const unrealUsdSign = stats.unrealizedPnlUsd >= 0 ? '+' : '-';
    const realizedSign = stats.realizedPnlUsd >= 0 ? '+' : '';
    const winRate = stats.completedTrades > 0
        ? `${((stats.wins / stats.completedTrades) * 100).toFixed(0)}%`
        : 'N/A';
    const width = 69;
    const line = (content) => `  |  ${content}${' '.repeat(Math.max(0, width - 4 - content.length))}|`;
    console.log('');
    console.log(`  + DASHBOARD  ${now}  [${uptime}]  ${config.symbol} ${activeSide} ${'-'.repeat(Math.max(0, width - 26 - uptime.length - config.symbol.length))}+`);
    console.log(line(`Data Source     ${stats.dataSource}`));
    console.log(line(`TradingView     ${config.tradingViewSymbol}  1m`));
    console.log(line(`BOT_MODE        ${config.botMode}`));
    console.log(line(`Price           $${fp(price)}`));
    console.log(line(`Signal Source   ${config.signalSource}`));
    console.log(line(`Live Trading    ${config.liveTradingEnabled ? 'ENABLED' : 'disabled'}`));
    console.log(line(`Exchange        ${config.exchangeName || 'NONE'}`));
    console.log(line(`Live Armed      ${stats.liveArmed ? 'YES' : 'NO'}`));
    console.log(line(`Live Trades     ${stats.dailyLiveTrades}/${config.maxDailyTrades}`));
    console.log(line(`Live PnL        ${formatSignedUsd(stats.dailyLivePnlUsd)}`));
    console.log(line(`Max Live Loss   $${config.maxDailyLossUsd.toFixed(2)}`));
    console.log(line(`Last Live Order ${stats.lastLiveOrderStatus ?? 'NONE'}`));
    console.log(line(config.signalSource === 'ICT'
        ? `ICT Signal      ${ictLine}`
        : `Signal          ${sigLine}`));
    if (config.signalSource === 'ICT') {
        console.log(line(`ICT Evaluations ${stats.ictEvaluations}`));
        console.log(line(`ICT Accepted    ${stats.ictAccepted}`));
        console.log(line(`ICT Rejected    ${stats.ictRejected}`));
        console.log(line(`Candidates Eval ${tradeSelection?.candidatesEvaluated ?? 0}`));
        console.log(line(`Selected Cand.  ${selectedCandidate ? `${selectedCandidate.signalDirection} ${selectedCandidate.zoneType} ${shorten(selectedCandidate.zoneId, 18)}` : 'NONE'}`));
        console.log(line(`Cand Entry      ${selectedCandidate ? '$' + fp(selectedCandidate.entryPrice) : '--'}`));
        console.log(line(`Cand Stop       ${selectedCandidate && selectedCandidate.stopPrice !== null ? '$' + fp(selectedCandidate.stopPrice) : '--'}`));
        console.log(line(`Stop Source     ${selectedCandidate?.stopSource ?? '--'}`));
        console.log(line(`Risk Distance   ${selectedCandidate && selectedCandidate.riskDistance !== null ? selectedCandidate.riskDistance.toFixed(4) : '--'}`));
        console.log(line(`Zone Size       ${selectedCandidate ? selectedCandidate.zoneSize.toFixed(4) : '--'}`));
        console.log(line(`Expected TP PnL ${selectedCandidate ? '$' + selectedCandidate.expectedProfitAtTPUsd.toFixed(2) : '--'}`));
        if (selectedAttribution) {
            console.log(line(`Score Final     ${selectedAttribution.finalScore.toFixed(2)}`));
            console.log(line(`Liquidity Sweep +${selectedAttribution.breakdown.liquiditySweepScore.toFixed(2)}`));
            console.log(line(`Displacement    +${selectedAttribution.breakdown.displacementScore.toFixed(2)}`));
            console.log(line(`MSS             +${selectedAttribution.breakdown.mssScore.toFixed(2)}`));
            console.log(line(`FVG Quality     +${selectedAttribution.breakdown.fvgQualityScore.toFixed(2)}`));
            console.log(line(`IFVG Bonus      +${selectedAttribution.breakdown.ifvgBonus.toFixed(2)}`));
            console.log(line(`Target Fit      +${selectedAttribution.breakdown.targetFitScore.toFixed(2)}`));
            console.log(line(`Reaction        +${selectedAttribution.breakdown.reactionScore.toFixed(2)}`));
            console.log(line(`Session         +${selectedAttribution.breakdown.sessionScore.toFixed(2)}`));
            console.log(line(`Confidence      +${selectedAttribution.breakdown.confidenceScore.toFixed(2)}`));
        }
        else {
            console.log(line(`Selection Score --`));
        }
        console.log(line(`Target Profit   $${config.targetProfitMinUsd.toFixed(2)}-$${config.targetProfitMaxUsd.toFixed(2)}`));
        console.log(line(`Sizing Mode     ${config.positionSizingMode}`));
        console.log(line(`Target R        ${config.targetRMultiple.toFixed(2)}`));
        console.log(line(`Expected Profit ${sizing && sizing.status === 'ACCEPTED' ? '$' + sizing.expectedProfitUsd.toFixed(2) : '--'}`));
        console.log(line(`Expected Loss   ${sizing && sizing.status === 'ACCEPTED' ? '$' + sizing.expectedLossUsd.toFixed(2) : '--'}`));
        console.log(line(`Risk Used       ${sizing && sizing.status === 'ACCEPTED' ? sizing.riskUtilizationPercent.toFixed(2) + '%' : '--'}`));
        console.log(line(`Hard Stop       ${sizing && sizing.status === 'ACCEPTED' ? '$' + sizing.hardStopPrice.toFixed(2) : '--'}`));
        console.log(line(`Target Price    ${sizing && sizing.status === 'ACCEPTED' ? '$' + sizing.resolvedTargetPrice.toFixed(2) : '--'}`));
        console.log(line(`Position Size   ${sizing && sizing.status === 'ACCEPTED' ? '$' + sizing.recommendedPositionSizeUsd.toFixed(2) : '--'}`));
        console.log(line(`Risk Reward     ${sizing ? sizing.riskRewardRatio.toFixed(2) : '--'}`));
        console.log(line(`Sizing Status   ${sizing ? sizing.status : '--'}`));
        console.log(line(`Sizing Reject   ${sizing && sizing.status === 'REJECTED' ? shorten(sizing.rejectionReason, 50) : '--'}`));
        console.log(line(`Sizing Rejects  ${stats.sizingRejections}  last: ${stats.lastSizingRejectionReason ? shorten(stats.lastSizingRejectionReason, 36) : '--'}`));
        // Phase 8D — directional exposure summary
        const exposureSnapshots = (position.openPositions ?? [position])
            .filter(p => p.side !== 'NONE')
            .map(p => ({
            id: p.id ?? `pos-${p.openedAt ?? 'unknown'}`,
            side: p.side,
            unrealizedPnlUsd: (0, positionExitManager_1.calculateUnrealizedPnl)(p, price),
            stopAtBreakeven: p.stopAtBreakeven,
            averageEntryPrice: p.averageEntryPrice,
            partialClosed: p.dcaCount > 1,
        }));
        const exposure = (0, oppositeExposureManager_1.assessDirectionalExposure)(exposureSnapshots);
        const cleanup = (0, oppositeExposureManager_1.evaluateMixedExposureCleanup)(exposureSnapshots, {
            oppositeMaxLossUsd: config.oppositeSignalMaxLossUsd,
        });
        const oppositeEntryBlocked = exposure === 'LONG' || exposure === 'SHORT' || exposure === 'MIXED';
        console.log(line(`Directional Exp ${exposure}`));
        console.log(line(`Mixed Exposure  ${cleanup.mixedExposureActive ? 'YES' : 'NO'}`));
        console.log(line(`Opp Entry Block ${oppositeEntryBlocked ? 'YES' : 'NO'}`));
        console.log(line(`Opp Max Loss    $${config.oppositeSignalMaxLossUsd.toFixed(2)}`));
        // Phase 8E — position slot accounting
        const slotInputs = (position.openPositions ?? [position])
            .filter(p => p.side !== 'NONE')
            .map(p => ({
            id: p.id ?? `pos-${p.openedAt ?? 'unknown'}`,
            stopAtBreakeven: p.stopAtBreakeven,
            partialCloseDone: p.partialCloseDone,
            activeStopPrice: typeof p.hardStopPrice === 'number' ? p.hardStopPrice : null,
            averageEntryPrice: p.averageEntryPrice,
        }));
        const slotCounts = (0, positionSlotManager_1.countPositionSlots)(slotInputs);
        console.log(line(`Open Positions  ${slotCounts.total}/${config.maxTotalOpenPositions}`));
        console.log(line(`Risk Positions  ${slotCounts.risk}/${config.maxActiveRiskPositions}`));
        console.log(line(`Protected Pos.  ${slotCounts.protected}`));
        if (!selectedCandidate) {
            console.log(line(`Selection Reject ${shorten(tradeSelection?.rejectionReason ?? 'No selection yet', 36)}`));
        }
        if (config.debugIctPipeline) {
            const rej = stats.latestFvgRejectionSummary;
            console.log(line(`Raw FVGs        ${rej ? rej.totalRawFvgs : '--'}`));
            console.log(line(`Validated FVGs  ${rej ? rej.acceptedValidatedFvgs : '--'}`));
            console.log(line(`Top Rejection   ${rej ? shorten(rej.topRejectionReason, 36) : '--'}`));
        }
    }
    if (hasPosition) {
        const unrPct = position.totalUsdInvested > 0
            ? (stats.unrealizedPnlUsd / position.totalUsdInvested) * 100
            : 0;
        const unrealPctSign = unrPct >= 0 ? '+' : '';
        console.log(line(`Active Positions ${activePositionCount}/${config.maxConcurrentPositions}`));
        console.log(line(`Avg Entry       $${fp(position.averageEntryPrice)}`));
        console.log(line(`Unrealized PnL  ${unrealUsdSign}$${fp(Math.abs(stats.unrealizedPnlUsd))} (${unrealPctSign}${unrPct.toFixed(2)}%)`));
        console.log(line(`TP Price        $${fp(tpPrice)}`));
        console.log(line(`Managed Target  ${formatManagedTarget(position)}`));
        console.log(line(`Sizing Profit   ${formatOptionalUsd(position.expectedProfitUsd)} / Loss ${formatOptionalUsd(position.expectedLossUsd)}`));
        console.log(line(`Sizing RR       ${position.riskRewardRatio !== null ? position.riskRewardRatio.toFixed(2) : '--'}`));
        console.log(line(`Sizing Mode     ${position.sizingMode ?? '--'}`));
        console.log(line(`Risk Used       ${position.riskUtilizationPercent !== null ? position.riskUtilizationPercent.toFixed(2) + '%' : '--'}`));
        console.log(line(`Hard Stop       ${position.hardStopPrice !== null ? '$' + fp(position.hardStopPrice) : '--'}`));
        console.log(line(`Stop Source     ${position.stopSource ?? '--'}`));
        console.log(line(`Risk Distance   ${position.stopRiskDistance !== null ? position.stopRiskDistance.toFixed(4) : '--'}`));
        console.log(line(`Zone Size       ${position.stopZoneSize !== null ? position.stopZoneSize.toFixed(4) : '--'}`));
        console.log(line(`Target R        ${position.targetRMultiple !== null ? position.targetRMultiple.toFixed(2) : '--'}`));
        console.log(line(`Break Even Active ${position.stopAtBreakeven ? 'YES' : 'NO'}`));
        console.log(line(`Break Even Trigger ${formatPercent(50)}`));
        console.log(line(`Progress To TP  ${formatProgress((0, positionExitManager_1.calculateProgressToTargetPercent)(position, price))}`));
        console.log(line(`BE Active Price ${position.breakevenActivationPrice !== null ? '$' + fp(position.breakevenActivationPrice) : '--'}`));
        console.log(line(`BE Active Time  ${formatIsoTime(position.breakevenActivationTime)}`));
        console.log(line(`Max Loss        $${config.maxLossUsd.toFixed(2)}`));
        console.log(line(`Position Age    ${formatPositionAge(position.openedAt)}`));
        console.log(line(`Time Exit       disabled`));
        console.log(line(`Entry Zone Type ${formatEntryZone(position)}`));
        console.log(line(`Zone High       ${formatZonePrice(position.entryZoneHigh)}`));
        console.log(line(`Zone Low        ${formatZonePrice(position.entryZoneLow)}`));
        console.log(line(`Zone Respected  ${formatZoneRespected(position.entryZoneRespected)}`));
        console.log(line(`Last Close      ${stats.latestCloseReason ?? 'NONE'}`));
        console.log(line(`Invested        $${fp(position.totalUsdInvested)}  (DCA ${position.dcaCount - 1}/${maxLvls - 1})`));
        console.log(line(`Dist to TP      $${fp(distToTpUsd)}  (${distToTpPct.toFixed(3)}% away)`));
        console.log(line(`Dist to DCA     $${fp(distToDcaUsd)}  (${distToDcaPct.toFixed(3)}% away)`));
        for (const row of formatPerPositionRows(position, price)) {
            console.log(line(row));
        }
    }
    else {
        console.log(line(`Position        NONE - waiting for ${config.signalSource} signal`));
        console.log(line(`Last Close      ${stats.latestCloseReason ?? 'NONE'}`));
        console.log(line(config.signalSource === 'ICT'
            ? `                minConfidence=${config.ictMinConfidence}`
            : `                lookback=${config.volumeLookback}  spike=${config.volumeSpikeMultiplier}x  drop=${config.reversalDropPercent}%`));
        console.log(line(''));
        console.log(line(''));
        console.log(line(''));
    }
    const todaySign = stats.todayPnlUsd >= 0 ? '+' : '';
    console.log(`  +${'-'.repeat(width - 1)}+`);
    console.log(line(`Today           ${todaySign}$${fp(Math.abs(stats.todayPnlUsd))}  (${stats.todayTrades} trade${stats.todayTrades !== 1 ? 's' : ''})`));
    console.log(line(`Trades  ${String(stats.completedTrades).padEnd(5)}  Wins ${String(stats.wins).padEnd(4)}  Losses ${String(stats.losses).padEnd(4)}  WR ${winRate}`));
    console.log(line(`Realized PnL    ${realizedSign}$${fp(Math.abs(stats.realizedPnlUsd))}`));
    console.log(line(`Avg Size        ${stats.positionSizingSamples > 0 ? '$' + fp(avgPositionSize) : '--'}  Avg TP ${stats.positionSizingSamples > 0 ? '$' + fp(avgExpectedProfit) : '--'}  Avg Risk ${stats.positionSizingSamples > 0 ? '$' + fp(avgExpectedLoss) : '--'}`));
    console.log(line(`Size Dist       S:${stats.positionSizeDistribution.small} M:${stats.positionSizeDistribution.medium} L:${stats.positionSizeDistribution.large}`));
    console.log(line(`Top Factors     ${topFactors.length > 0 ? topFactors.join('  ') : '--'}`));
    console.log(line(`Journal Status  ${stats.journalStatus}`));
    console.log(line(`Last Journal    ${stats.lastJournalWrite ?? '--'}`));
    console.log(line(`Completed Logs  ${stats.completedTradesLogged}`));
    console.log(line(`Trade Events    ${stats.tradeEventsLogged}`));
    console.log(line(`Session Equity  $${fp(stats.sessionEquity)}`));
    console.log(line(`Max Cap Used    $${fp(stats.maxCapitalUsed)}  Max Drawdown $${fp(stats.maxDrawdownUsd)}`));
    console.log(line(`Ticks           ${stats.ticks}`));
    console.log(`  +${'-'.repeat(width - 1)}+`);
}
function appendSessionStatsHistory(stats) {
    try {
        const dir = path.dirname(SESSION_STATS_HISTORY_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(SESSION_STATS_HISTORY_FILE, JSON.stringify({ timestamp: new Date().toISOString(), stats }) + '\n', 'utf-8');
    }
    catch (err) {
        console.error('  Journal: failed to append session stats history:', err);
    }
}
function formatPerPositionRows(position, price) {
    const positions = position.openPositions?.length ? position.openPositions : (position.side !== 'NONE' ? [position] : []);
    return positions.map((active, index) => {
        const pnl = (0, positionExitManager_1.calculateUnrealizedPnl)(active, price);
        const currentR = active.expectedLossUsd && active.expectedLossUsd > 0
            ? (pnl / active.expectedLossUsd)
            : null;
        const progress = (0, positionExitManager_1.calculateProgressToTargetPercent)(active, price);
        const runner = active.partialCloseDone ? ' runner active' : '';
        return `#${index + 1} ${active.side}` +
            ` entry ${fp(active.averageEntryPrice)}` +
            ` current ${fp(price)}` +
            ` target ${active.targetPrice !== null ? fp(active.targetPrice) : '--'}` +
            ` hardStop ${active.hardStopPrice !== null ? fp(active.hardStopPrice) : '--'}` +
            ` activeStop ${formatPlainPrice((0, positionTradeManagement_1.getActiveStopPrice)(active))}` +
            ` currentStop ${formatPlainPrice((0, positionTradeManagement_1.getActiveStopPrice)(active))}` +
            ` originalStop ${formatPlainPrice(active.originalStopPrice)}` +
            ` stopModel ${active.stopModel ?? '--'}` +
            ` tightened ${active.stopTightened === null ? '--' : active.stopTightened ? 'YES' : 'NO'}` +
            ` size $${fp(active.totalUsdInvested)}` +
            ` pnl ${formatSignedUsd(pnl)}` +
            ` ${currentR !== null ? currentR.toFixed(2) + 'R' : '--R'}` +
            ` progress ${progress !== null ? progress.toFixed(0) + '%' : '--'}` +
            ` BE ${active.stopAtBreakeven ? 'YES' : 'NO'}` +
            ` partial ${active.partialCloseDone ? 'YES' : 'NO'}` +
            ` partialPnl ${formatSignedUsd(active.realizedPartialPnlUsd)}` +
            ` runnerSize ${active.remainingSizeAfterPartial !== null ? active.remainingSizeAfterPartial.toFixed(8) : '--'}` +
            ` runnerPnl ${formatSignedUsd(pnl)}` +
            ` protected ${active.oppositeSignalProtected ? 'YES' : 'NO'}` +
            runner +
            ` age ${formatPositionAge(active.openedAt)}` +
            ` zone ${active.entryZoneType ?? '--'}` +
            ` stopSource ${active.stopSource ?? '--'}`;
    });
}
function fp(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatSignedUsd(value) {
    const sign = value >= 0 ? '+' : '-';
    return `${sign}$${fp(Math.abs(value))}`;
}
function todayString() {
    return new Date().toISOString().slice(0, 10);
}
function fmtUptime(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
function shorten(value, maxLength) {
    if (value.length <= maxLength)
        return value;
    return value.slice(0, Math.max(0, maxLength - 3)) + '...';
}
function formatPositionAge(openedAt) {
    if (!openedAt)
        return 'unknown';
    const opened = new Date(openedAt);
    if (Number.isNaN(opened.getTime()))
        return 'unknown';
    const minutes = Math.max(0, (Date.now() - opened.getTime()) / 60_000);
    return `${minutes.toFixed(1)}m`;
}
function formatEntryZone(position) {
    if (!position.entryZoneType)
        return '--';
    return `${position.entryZoneType} ${position.entryZoneDirection ?? '--'}`;
}
function formatZonePrice(value) {
    return value === null ? '--' : `$${fp(value)}`;
}
function formatZoneRespected(value) {
    if (value === null)
        return 'UNKNOWN';
    return value ? 'YES' : 'NO';
}
function formatManagedTarget(position) {
    if (position.targetPrice === null)
        return '--';
    const source = position.targetSource ?? '--';
    const disrespected = position.targetDisrespected ? ' disrespected' : '';
    return `${source} $${fp(position.targetPrice)}${disrespected}`;
}
function formatOptionalUsd(value) {
    return value === null ? '--' : `$${fp(value)}`;
}
function formatPlainPrice(value) {
    return value === null ? '--' : fp(value);
}
function formatPercent(value) {
    return `${value.toFixed(0)}%`;
}
function formatProgress(value) {
    return value === null ? '--' : `${value.toFixed(2)}%`;
}
function formatIsoTime(value) {
    if (!value)
        return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return parsed.toISOString();
}
function loadTopPerformingFactors() {
    try {
        if (!fs.existsSync(SCORE_ATTRIBUTION_REPORT_FILE))
            return [];
        const raw = fs.readFileSync(SCORE_ATTRIBUTION_REPORT_FILE, 'utf-8');
        const report = JSON.parse(raw);
        return report.topPerformingFactors
            .slice(0, 3)
            .map((factor, index) => `#${index + 1} ${factor.factor}`);
    }
    catch {
        return [];
    }
}

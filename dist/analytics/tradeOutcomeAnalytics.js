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
exports.loadCompletedTrades = loadCompletedTrades;
exports.createScoreAttributionReport = createScoreAttributionReport;
exports.writeScoreAttributionReports = writeScoreAttributionReports;
exports.generateScoreAttributionReports = generateScoreAttributionReports;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const COMPLETED_TRADES_PATH = path.join(LOGS_DIR, 'completed-trades.json');
const REPORT_JSON_PATH = path.join(LOGS_DIR, 'score-attribution-report.json');
const REPORT_HTML_PATH = path.join(LOGS_DIR, 'score-attribution-report.html');
const FACTORS = [
    { key: 'liquiditySweepScore', label: 'Liquidity Sweep' },
    { key: 'displacementScore', label: 'Displacement' },
    { key: 'mssScore', label: 'MSS' },
    { key: 'fvgQualityScore', label: 'FVG' },
    { key: 'ifvgBonus', label: 'IFVG' },
    { key: 'premiumDiscountScore', label: 'Premium/Discount' },
    { key: 'sessionScore', label: 'Session' },
    { key: 'targetFitScore', label: 'Target Fit' },
    { key: 'reactionScore', label: 'Reaction' },
    { key: 'confidenceScore', label: 'Confidence' },
];
function loadCompletedTrades(filePath = COMPLETED_TRADES_PATH) {
    if (!fs.existsSync(filePath))
        return [];
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw)
        return [];
    return JSON.parse(raw);
}
function createScoreAttributionReport(trades) {
    const outcomes = trades
        .filter(trade => trade.scoreBreakdown !== undefined)
        .map(toOutcomeRecord);
    const factors = FACTORS.map(factor => summarizeFactor(outcomes, factor.key, factor.label));
    const ranked = [...factors].sort((a, b) => {
        const winDelta = b.winRate - a.winRate;
        if (winDelta !== 0)
            return winDelta;
        return b.avgPnlUsd - a.avgPnlUsd;
    });
    return {
        generatedAt: new Date().toISOString(),
        totalTrades: outcomes.length,
        factors,
        topPerformingFactors: ranked.slice(0, 3),
        strongestCorrelations: ranked,
        outcomes,
        probabilityBuckets: summarizeProbabilityBuckets(outcomes),
    };
}
function writeScoreAttributionReports(report, logsDir = LOGS_DIR) {
    if (!fs.existsSync(logsDir))
        fs.mkdirSync(logsDir, { recursive: true });
    const jsonPath = path.join(logsDir, 'score-attribution-report.json');
    const htmlPath = path.join(logsDir, 'score-attribution-report.html');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(htmlPath, renderHtml(report), 'utf-8');
    return { jsonPath, htmlPath };
}
function generateScoreAttributionReports() {
    const report = createScoreAttributionReport(loadCompletedTrades());
    const paths = writeScoreAttributionReports(report);
    return { report, ...paths };
}
function toOutcomeRecord(trade) {
    return {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryTimestamp: trade.entryTimestamp,
        exitTimestamp: trade.exitTimestamp,
        finalScore: trade.scoreFinal ?? trade.selectionScore ?? 0,
        scoreBreakdown: trade.scoreBreakdown,
        win: trade.realizedPnlUsd > 0,
        realizedPnlUsd: trade.realizedPnlUsd,
        tradeDurationMinutes: trade.tradeDurationMinutes ?? 0,
        exitReason: trade.reason,
        targetReachProbability: trade.targetReachProbability
            ?? trade.scoreBreakdown?.targetReachProbability
            ?? 0,
    };
}
const PROBABILITY_BUCKETS = [
    { bucket: '0-49', range: [0, 49] },
    { bucket: '50-69', range: [50, 69] },
    { bucket: '70-84', range: [70, 84] },
    { bucket: '85-100', range: [85, 100] },
];
function summarizeProbabilityBuckets(outcomes) {
    return PROBABILITY_BUCKETS.map(({ bucket, range }) => {
        const inBucket = outcomes.filter(o => o.targetReachProbability >= range[0] && o.targetReachProbability <= range[1]);
        const wins = inBucket.filter(o => o.win).length;
        const losses = inBucket.length - wins;
        const totalPnl = inBucket.reduce((sum, o) => sum + o.realizedPnlUsd, 0);
        const totalProb = inBucket.reduce((sum, o) => sum + o.targetReachProbability, 0);
        return {
            bucket,
            range,
            trades: inBucket.length,
            wins,
            losses,
            winRate: inBucket.length > 0 ? round((wins / inBucket.length) * 100, 2) : 0,
            avgPnlUsd: inBucket.length > 0 ? round(totalPnl / inBucket.length, 4) : 0,
            avgProbability: inBucket.length > 0 ? round(totalProb / inBucket.length, 2) : 0,
        };
    });
}
function summarizeFactor(outcomes, key, label) {
    const participating = outcomes.filter(outcome => outcome.scoreBreakdown[key] > 0);
    const wins = participating.filter(outcome => outcome.win).length;
    const losses = participating.length - wins;
    const totalPnl = participating.reduce((sum, outcome) => sum + outcome.realizedPnlUsd, 0);
    const totalScore = participating.reduce((sum, outcome) => sum + outcome.scoreBreakdown[key], 0);
    return {
        factor: label,
        componentKey: key,
        trades: participating.length,
        wins,
        losses,
        winRate: participating.length > 0 ? round((wins / participating.length) * 100, 2) : 0,
        avgPnlUsd: participating.length > 0 ? round(totalPnl / participating.length, 4) : 0,
        avgScore: participating.length > 0 ? round(totalScore / participating.length, 2) : 0,
    };
}
function renderHtml(report) {
    const factorRows = report.factors.map(factor => `
    <tr>
      <td>${escapeHtml(factor.factor)}</td>
      <td>${factor.trades}</td>
      <td>${factor.wins}</td>
      <td>${factor.losses}</td>
      <td>${factor.winRate.toFixed(2)}%</td>
      <td>$${factor.avgPnlUsd.toFixed(4)}</td>
    </tr>`).join('');
    const topRows = report.topPerformingFactors.map((factor, index) => `
    <li>#${index + 1} ${escapeHtml(factor.factor)} - ${factor.winRate.toFixed(2)}% WR</li>`).join('');
    const probabilityRows = report.probabilityBuckets.map(b => `
    <tr>
      <td>${b.bucket}</td>
      <td>${b.trades}</td>
      <td>${b.wins}</td>
      <td>${b.losses}</td>
      <td>${b.winRate.toFixed(2)}%</td>
      <td>$${b.avgPnlUsd.toFixed(4)}</td>
      <td>${b.avgProbability.toFixed(2)}</td>
    </tr>`).join('');
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Score Attribution Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #20242a; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d4d7dd; padding: 8px; text-align: left; }
    th { background: #f2f4f7; }
  </style>
</head>
<body>
  <h1>Score Attribution Report</h1>
  <p>Generated: ${escapeHtml(report.generatedAt)}</p>
  <p>Total attributed trades: ${report.totalTrades}</p>
  <h2>Top Performing Factors</h2>
  <ol>${topRows}</ol>
  <h2>Factor Analytics</h2>
  <table>
    <thead>
      <tr><th>Factor</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Avg PnL</th></tr>
    </thead>
    <tbody>${factorRows}</tbody>
  </table>
  <h2>Probability Buckets</h2>
  <table>
    <thead>
      <tr><th>Bucket</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Avg PnL</th><th>Avg Probability</th></tr>
    </thead>
    <tbody>${probabilityRows}</tbody>
  </table>
</body>
</html>`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
if (require.main === module) {
    const { report, jsonPath, htmlPath } = generateScoreAttributionReports();
    console.log(`Score attribution report generated: ${report.totalTrades} attributed trade(s)`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`HTML: ${htmlPath}`);
}

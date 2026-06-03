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
exports.generateLogViewer = generateLogViewer;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tradeJournal_1 = require("../journal/tradeJournal");
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const OUTPUT_PATH = path.join(LOGS_DIR, 'journal-viewer.html');
const FILES = [
    { label: 'Events Log', relativePath: 'logs/events.log' },
    { label: 'Trades CSV', relativePath: 'logs/trades.csv' },
    { label: 'Completed Trades JSON', relativePath: 'logs/completed-trades.json' },
    { label: 'ICT Signals CSV', relativePath: 'logs/ict-signals.csv' },
    { label: 'ICT Signals JSON', relativePath: 'logs/ict-signals.json' },
    { label: 'Session Stats', relativePath: 'session-stats.json' },
    { label: 'Position State', relativePath: 'position-state.json' },
];
function generateLogViewer() {
    ensureLogsDir();
    const csvRepair = (0, tradeJournal_1.repairTradesCsvHeader)(LOGS_DIR);
    const completedTrades = readJson('logs/completed-trades.json', []);
    const ictAudit = readJson('logs/ict-signals.json', {});
    const sessionStats = readJson('session-stats.json', {});
    const positionState = readJson('position-state.json', {});
    const eventsText = readText('logs/events.log');
    const tradeCsvText = readText('logs/trades.csv');
    const realizedPnl = completedTrades.reduce((sum, trade) => sum + numberOrZero(trade.realizedPnlUsd), 0);
    const wins = completedTrades.filter(trade => numberOrZero(trade.realizedPnlUsd) > 0).length;
    const losses = completedTrades.filter(trade => numberOrZero(trade.realizedPnlUsd) <= 0).length;
    const winRate = completedTrades.length > 0 ? (wins / completedTrades.length) * 100 : 0;
    const eventCount = countNonEmptyLines(eventsText);
    const tradeEventCount = Math.max(0, countNonEmptyLines(tradeCsvText) - 1);
    const summary = ictAudit.summary ?? {};
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NADO Bot Journal Viewer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1f2933;
      --muted: #667085;
      --border: #d8dee8;
      --accent: #1664d9;
      --good: #0f7b3f;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }
    header {
      padding: 24px 28px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    main { padding: 20px 28px 32px; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 0 0 18px;
    }
    .card, details {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .card strong { display: block; font-size: 22px; margin-top: 4px; }
    .good { color: var(--good); }
    .bad { color: var(--bad); }
    section { margin: 0 0 20px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      font-size: 13px;
      vertical-align: top;
    }
    th { background: #eef2f7; font-weight: 700; }
    tr:last-child td { border-bottom: 0; }
    code {
      background: #eef2f7;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 4px;
      font-family: Consolas, Monaco, monospace;
      font-size: 12px;
    }
    summary {
      cursor: pointer;
      font-weight: 700;
    }
    pre {
      margin: 12px 0 0;
      padding: 12px;
      max-height: 520px;
      overflow: auto;
      background: #101828;
      color: #f2f4f7;
      border-radius: 6px;
      font: 12px/1.45 Consolas, Monaco, monospace;
      white-space: pre;
    }
    .section-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
  </style>
</head>
<body>
  <header>
    <h1>NADO Bot Journal Viewer</h1>
    <div class="muted">Generated ${escapeHtml(new Date().toISOString())}</div>
    <div class="muted">Workspace: <code>${escapeHtml(ROOT_DIR)}</code></div>
  </header>
  <main>
    <section>
      <h2>Summary</h2>
      <div class="grid">
        ${card('Completed Trades', String(completedTrades.length))}
        ${card('Wins', String(wins), 'good')}
        ${card('Losses', String(losses), losses > wins ? 'bad' : '')}
        ${card('Win Rate', `${winRate.toFixed(2)}%`)}
        ${card('Realized PnL', `${realizedPnl >= 0 ? '+' : '-'}$${Math.abs(realizedPnl).toFixed(4)}`, realizedPnl >= 0 ? 'good' : 'bad')}
        ${card('Trade Events', String(tradeEventCount))}
        ${card('Event Lines', String(eventCount))}
        ${card('ICT Evaluations', String(summary.totalEvaluations ?? 0))}
      </div>
    </section>

    <section class="section-grid">
      <div class="card">
        <h2>Active Position</h2>
        ${objectTable(positionState)}
      </div>
      <div class="card">
        <h2>Session Stats</h2>
        ${objectTable(sessionStats)}
      </div>
      <div class="card">
        <h2>ICT Signal Audit</h2>
        ${objectTable({
        totalEvaluations: summary.totalEvaluations ?? 0,
        buyCount: summary.buyCount ?? 0,
        sellCount: summary.sellCount ?? 0,
        noneCount: summary.noneCount ?? 0,
        acceptedCount: summary.acceptedCount ?? 0,
        rejectedCount: summary.rejectedCount ?? 0,
        recordsInJson: ictAudit.records?.length ?? 0,
    })}
      </div>
    </section>

    <section>
      <h2>Completed Trades</h2>
      ${completedTradesTable(completedTrades)}
    </section>

    <section>
      <h2>Log Files</h2>
      <table>
        <thead>
          <tr><th>File</th><th>Path</th><th>Size</th><th>Updated</th></tr>
        </thead>
        <tbody>
          ${FILES.map(fileRow).join('')}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Raw Logs</h2>
      <p class="muted">Each section below contains the current file content. Large ICT audit files may take a moment to expand in the browser.</p>
      ${FILES.map(rawFileDetails).join('\n')}
    </section>

    <section>
      <h2>CSV Header Repair</h2>
      <p>${csvRepair.created ? 'Created trades.csv with the current header.' : csvRepair.repaired ? 'Repaired trades.csv header in place and preserved all rows.' : 'trades.csv header already matched the current schema.'}</p>
      <p class="muted"><code>${escapeHtml(csvRepair.csvPath)}</code></p>
    </section>
  </main>
</body>
</html>`;
    fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
    return OUTPUT_PATH;
}
if (require.main === module) {
    const outputPath = generateLogViewer();
    console.log('Journal viewer generated');
    console.log(`Output: ${outputPath}`);
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}
function readText(relativePath) {
    const filePath = path.join(ROOT_DIR, relativePath);
    try {
        return fs.readFileSync(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
function readJson(relativePath, fallback) {
    const text = readText(relativePath).trim();
    if (!text)
        return fallback;
    try {
        return JSON.parse(text);
    }
    catch {
        return fallback;
    }
}
function countNonEmptyLines(text) {
    return text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}
function fileRow(file) {
    const filePath = path.join(ROOT_DIR, file.relativePath);
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    return `<tr>
    <td>${escapeHtml(file.label)}</td>
    <td><code>${escapeHtml(filePath)}</code></td>
    <td>${stat ? formatBytes(stat.size) : 'missing'}</td>
    <td>${stat ? escapeHtml(stat.mtime.toISOString()) : 'missing'}</td>
  </tr>`;
}
function rawFileDetails(file) {
    const filePath = path.join(ROOT_DIR, file.relativePath);
    const text = readText(file.relativePath);
    const size = fs.existsSync(filePath) ? formatBytes(fs.statSync(filePath).size) : 'missing';
    return `<details>
    <summary>${escapeHtml(file.label)} - ${escapeHtml(size)}</summary>
    <pre>${escapeHtml(text || '(empty or missing)')}</pre>
  </details>`;
}
function completedTradesTable(trades) {
    if (trades.length === 0) {
        return '<div class="card">No completed trades found.</div>';
    }
    const rows = trades.map(trade => `<tr>
    <td>${escapeHtml(trade.exitTimestamp)}</td>
    <td>${escapeHtml(trade.symbol)}</td>
    <td>${escapeHtml(trade.side)}</td>
    <td>${escapeHtml(trade.reason)}</td>
    <td>${formatUsd(trade.realizedPnlUsd)}</td>
    <td>${money(trade.entryPrice)}</td>
    <td>${money(trade.exitPrice)}</td>
    <td>${formatDuration(trade.tradeDurationMinutes)}</td>
    <td>${escapeHtml(trade.entryZoneType ?? '')}</td>
    <td>${escapeHtml(trade.entryZoneRespected === undefined ? '' : String(trade.entryZoneRespected))}</td>
  </tr>`).join('');
    return `<table>
    <thead>
      <tr>
        <th>Exit Time</th>
        <th>Symbol</th>
        <th>Side</th>
        <th>Reason</th>
        <th>PnL</th>
        <th>Entry</th>
        <th>Exit</th>
        <th>Duration</th>
        <th>Zone</th>
        <th>Respected</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}
function objectTable(value) {
    const entries = Object.entries(value);
    if (entries.length === 0)
        return '<p class="muted">No data.</p>';
    return `<table><tbody>${entries.map(([key, item]) => `<tr>
    <th>${escapeHtml(key)}</th>
    <td>${escapeHtml(formatValue(item))}</td>
  </tr>`).join('')}</tbody></table>`;
}
function card(label, value, className = '') {
    return `<div class="card"><span class="muted">${escapeHtml(label)}</span><strong class="${className}">${escapeHtml(value)}</strong></div>`;
}
function formatValue(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'object')
        return JSON.stringify(value);
    return String(value);
}
function formatUsd(value) {
    return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(4)}`;
}
function formatDuration(value) {
    return value === undefined ? '' : `${value.toFixed(2)}m`;
}
function money(value) {
    return `$${Number(value).toFixed(2)}`;
}
function numberOrZero(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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
exports.VISUAL_VALIDATION_PATH = void 0;
exports.exportVisualValidationReport = exportVisualValidationReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const DETECTED_FVGS_PATH = path.join(LOGS_DIR, 'detected-fvgs.json');
const DETECTED_IFVGS_PATH = path.join(LOGS_DIR, 'detected-ifvgs.json');
exports.VISUAL_VALIDATION_PATH = path.join(LOGS_DIR, 'fvg-ifvg-visual-validation.html');
function exportVisualValidationReport() {
    ensureLogsDir();
    const fvgs = readJsonArray(DETECTED_FVGS_PATH);
    const ifvgs = readJsonArray(DETECTED_IFVGS_PATH);
    const groups = [
        { title: 'Bullish FVGs', zones: fvgs.filter(zone => zone.direction === 'BULLISH') },
        { title: 'Bearish FVGs', zones: fvgs.filter(zone => zone.direction === 'BEARISH') },
        { title: 'Bullish IFVGs', zones: ifvgs.filter(zone => zone.direction === 'BULLISH') },
        { title: 'Bearish IFVGs', zones: ifvgs.filter(zone => zone.direction === 'BEARISH') },
    ];
    const report = {
        generatedAt: new Date().toISOString(),
        outputPath: exports.VISUAL_VALIDATION_PATH,
        fvgPath: DETECTED_FVGS_PATH,
        ifvgPath: DETECTED_IFVGS_PATH,
        counts: {
            bullishFVGs: groups[0].zones.length,
            bearishFVGs: groups[1].zones.length,
            bullishIFVGs: groups[2].zones.length,
            bearishIFVGs: groups[3].zones.length,
            total: groups.reduce((sum, group) => sum + group.zones.length, 0),
        },
    };
    fs.writeFileSync(exports.VISUAL_VALIDATION_PATH, renderHtml(report, groups), 'utf-8');
    return report;
}
if (require.main === module) {
    const report = exportVisualValidationReport();
    console.log('ICT visual validation report generated');
    console.log(`Output: ${report.outputPath}`);
    console.log(`FVG source: ${report.fvgPath}`);
    console.log(`IFVG source: ${report.ifvgPath}`);
    console.log(`Bullish FVGs: ${report.counts.bullishFVGs}`);
    console.log(`Bearish FVGs: ${report.counts.bearishFVGs}`);
    console.log(`Bullish IFVGs: ${report.counts.bullishIFVGs}`);
    console.log(`Bearish IFVGs: ${report.counts.bearishIFVGs}`);
    console.log(`Total zones: ${report.counts.total}`);
}
function readJsonArray(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw)
        return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error(`Expected ${filePath} to contain a JSON array`);
    }
    return parsed;
}
function renderHtml(report, groups) {
    const allZones = groups.flatMap(group => group.zones);
    const minLow = allZones.length > 0 ? Math.min(...allZones.map(zone => zone.low)) : 0;
    const maxHigh = allZones.length > 0 ? Math.max(...allZones.map(zone => zone.high)) : 1;
    const priceRange = Math.max(maxHigh - minLow, 1);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ICT FVG / IFVG Visual Validation</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #667085;
      --line: #d0d5dd;
      --bull: #107c41;
      --bull-soft: #dff3e7;
      --bear: #b42318;
      --bear-soft: #fde3df;
      --ifvg: #175cd3;
      --flag: #7a2e0e;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }

    header {
      padding: 24px 28px 18px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }

    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 700;
    }

    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }

    main {
      padding: 22px 28px 36px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px 18px;
      color: var(--muted);
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 22px;
    }

    .stat,
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .stat {
      padding: 14px;
    }

    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .stat strong {
      display: block;
      margin-top: 5px;
      font-size: 22px;
    }

    section {
      margin-top: 16px;
      overflow: hidden;
    }

    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .count {
      color: var(--muted);
      white-space: nowrap;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }

    th {
      background: #f9fafb;
      color: #344054;
      font-size: 12px;
      text-transform: uppercase;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .id-cell {
      max-width: 300px;
      white-space: normal;
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 12px;
    }

    .pill {
      display: inline-block;
      min-width: 38px;
      padding: 3px 8px;
      border-radius: 999px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }

    .yes {
      background: var(--flag);
      color: #ffffff;
    }

    .no {
      background: #eef2f6;
      color: #344054;
    }

    .BULLISH {
      color: var(--bull);
      font-weight: 700;
    }

    .BEARISH {
      color: var(--bear);
      font-weight: 700;
    }

    .range-cell {
      min-width: 220px;
    }

    .range {
      position: relative;
      height: 18px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f2f4f7;
      overflow: hidden;
    }

    .zone-bar {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 4px;
      opacity: 0.8;
    }

    .zone-bar.bullish {
      background: var(--bull-soft);
      border-right: 2px solid var(--bull);
      border-left: 2px solid var(--bull);
    }

    .zone-bar.bearish {
      background: var(--bear-soft);
      border-right: 2px solid var(--bear);
      border-left: 2px solid var(--bear);
    }

    .midpoint {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--ifvg);
    }

    .empty {
      padding: 18px 16px;
      color: var(--muted);
    }

    @media (max-width: 900px) {
      main,
      header {
        padding-left: 16px;
        padding-right: 16px;
      }

      .table-wrap {
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>ICT FVG / IFVG Visual Validation</h1>
    <div class="meta">
      <div>Generated: ${escapeHtml(report.generatedAt)}</div>
      <div>FVG source: ${escapeHtml(report.fvgPath)}</div>
      <div>IFVG source: ${escapeHtml(report.ifvgPath)}</div>
      <div>Price scale: ${formatNumber(minLow)} to ${formatNumber(maxHigh)}</div>
    </div>
  </header>
  <main>
    <div class="summary">
      ${renderStat('Bullish FVGs', report.counts.bullishFVGs)}
      ${renderStat('Bearish FVGs', report.counts.bearishFVGs)}
      ${renderStat('Bullish IFVGs', report.counts.bullishIFVGs)}
      ${renderStat('Bearish IFVGs', report.counts.bearishIFVGs)}
      ${renderStat('Total Zones', report.counts.total)}
    </div>
    ${groups.map(group => renderGroup(group, minLow, priceRange)).join('\n')}
  </main>
</body>
</html>
`;
}
function renderStat(label, value) {
    return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}
function renderGroup(group, minLow, priceRange) {
    return `<section>
  <div class="section-head">
    <h2>${escapeHtml(group.title)}</h2>
    <div class="count">${group.zones.length} zone${group.zones.length === 1 ? '' : 's'}</div>
  </div>
  ${group.zones.length > 0 ? renderTable(group.zones, minLow, priceRange) : '<div class="empty">No zones detected in this group.</div>'}
</section>`;
}
function renderTable(zones, minLow, priceRange) {
    return `<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Direction</th>
        <th>High</th>
        <th>Low</th>
        <th>Midpoint</th>
        <th>Created At</th>
        <th>Invalidated</th>
        <th>Filled</th>
        <th>Flipped</th>
        <th>Range</th>
        <th>ID</th>
      </tr>
    </thead>
    <tbody>
      ${zones.map(zone => renderRow(zone, minLow, priceRange)).join('\n')}
    </tbody>
  </table>
</div>`;
}
function renderRow(zone, minLow, priceRange) {
    return `<tr>
  <td class="${zone.direction}">${zone.direction}</td>
  <td>${formatNumber(zone.high)}</td>
  <td>${formatNumber(zone.low)}</td>
  <td>${formatNumber(zone.midpoint)}</td>
  <td>${escapeHtml(zone.createdAt)}</td>
  <td>${renderBoolean(zone.invalidated)}</td>
  <td>${renderBoolean(zone.filled)}</td>
  <td>${renderBoolean(zone.flipped)}</td>
  <td class="range-cell">${renderRange(zone, minLow, priceRange)}</td>
  <td class="id-cell">${escapeHtml(zone.id)}</td>
</tr>`;
}
function renderRange(zone, minLow, priceRange) {
    const left = ((zone.low - minLow) / priceRange) * 100;
    const width = ((zone.high - zone.low) / priceRange) * 100;
    const midpointLeft = ((zone.midpoint - minLow) / priceRange) * 100;
    const directionClass = zone.direction === 'BULLISH' ? 'bullish' : 'bearish';
    return `<div class="range" title="low ${formatNumber(zone.low)} / midpoint ${formatNumber(zone.midpoint)} / high ${formatNumber(zone.high)}">
  <div class="zone-bar ${directionClass}" style="left:${left.toFixed(3)}%;width:${Math.max(width, 0.5).toFixed(3)}%;"></div>
  <div class="midpoint" style="left:${midpointLeft.toFixed(3)}%;"></div>
</div>`;
}
function renderBoolean(value) {
    return `<span class="pill ${value ? 'yes' : 'no'}">${value ? 'YES' : 'NO'}</span>`;
}
function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

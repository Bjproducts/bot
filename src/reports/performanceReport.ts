import * as fs from 'fs';
import * as path from 'path';
import { CompletedTrade } from '../journal/types';
import {
  IctSignalAuditRecord,
  loadIctSignalAuditRecords,
  summarizeIctSignalAudit,
} from '../ict/ictSignalAuditLog';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
const CSV_PATH = path.join(LOGS_DIR, 'trades.csv');
const COMPLETED_TRADES_PATH = path.join(LOGS_DIR, 'completed-trades.json');

interface CsvRow {
  timestamp: string;
  symbol: string;
  marketDataSource: string;
  action: string;
  side: string;
  price: number;
  size: number;
  investedUsd: number;
  avgEntry: number;
  dcaCount: number;
  realizedPnlUsd: number;
  signalDirection: string;
}

export function runPerformanceReport(): void {
  const csvExists = fs.existsSync(CSV_PATH);
  const tradesExists = fs.existsSync(COMPLETED_TRADES_PATH);
  const ictSignalRecords = loadIctSignalAuditRecords();

  if (!csvExists && !tradesExists && ictSignalRecords.length === 0) {
    console.log('');
    console.log('  No log files found.');
    console.log('  Run npm run dev first to generate trades or ICT signal audits.');
    console.log(`  Expected: ${CSV_PATH}`);
    console.log('');
    return;
  }

  const events = csvExists ? parseCsv(CSV_PATH) : [];
  const completedTrades = tradesExists ? parseCompletedTrades(COMPLETED_TRADES_PATH) : [];

  if (events.length === 0 && completedTrades.length === 0 && ictSignalRecords.length === 0) {
    console.log('');
    console.log('  Log files exist but contain no data yet.');
    console.log('  Let the simulation run until at least one trade or ICT signal audit exists.');
    console.log('');
    return;
  }

  printReport(events, completedTrades, ictSignalRecords);
}

function parseCsv(filePath: string): CsvRow[] {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return {
      timestamp: cols[0] ?? '',
      symbol: cols[1] ?? '',
      marketDataSource: cols[2] ?? '',
      action: cols[3] ?? '',
      side: cols[4] ?? '',
      price: parseFloat(cols[5] ?? '0'),
      size: parseFloat(cols[6] ?? '0'),
      investedUsd: parseFloat(cols[7] ?? '0'),
      avgEntry: parseFloat(cols[8] ?? '0'),
      dcaCount: parseInt(cols[9] ?? '0', 10),
      realizedPnlUsd: parseFloat(cols[10] ?? '0'),
      signalDirection: cols[11] ?? '',
    };
  });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCompletedTrades(filePath: string): CompletedTrade[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw || raw === '[]') return [];
    return JSON.parse(raw) as CompletedTrade[];
  } catch {
    return [];
  }
}

function printReport(
  events: CsvRow[],
  trades: CompletedTrade[],
  ictSignalRecords: IctSignalAuditRecord[],
): void {
  const totalEvents = events.length;
  const entryCount = events.filter(event => event.action === 'ENTRY').length;
  const dcaCount = events.filter(event => event.action === 'DCA').length;
  const tpCount = events.filter(event => event.action === 'TAKE_PROFIT').length;
  const riskExitCount = events.filter(event => event.action === 'RISK_EXIT').length;

  const symbol = events[0]?.symbol
    ?? trades[0]?.symbol
    ?? ictSignalRecords[0]?.symbol
    ?? 'N/A';
  const source = events[0]?.marketDataSource
    ?? trades[0]?.marketDataSource
    ?? ictSignalRecords[0]?.marketDataSource
    ?? 'N/A';
  const side = events[0]?.side ?? trades[0]?.side ?? 'N/A';
  const firstTs = events[0]?.timestamp
    ?? trades[0]?.entryTimestamp
    ?? ictSignalRecords[0]?.timestamp
    ?? 'N/A';
  const lastTs = events[events.length - 1]?.timestamp
    ?? trades[trades.length - 1]?.exitTimestamp
    ?? ictSignalRecords[ictSignalRecords.length - 1]?.timestamp
    ?? 'N/A';

  const totalTrades = trades.length;
  const wins = trades.filter(trade => trade.realizedPnlUsd > 0).length;
  const losses = trades.filter(trade => trade.realizedPnlUsd <= 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0);
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const pnlValues = trades.map(trade => trade.realizedPnlUsd);
  const largestWin = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
  const largestLoss = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
  const dcaCounts = trades.map(trade => trade.dcaCount);
  const avgDca = dcaCounts.length > 0
    ? dcaCounts.reduce((sum, value) => sum + value, 0) / dcaCounts.length
    : 0;
  const maxDca = dcaCounts.length > 0 ? Math.max(...dcaCounts) : 0;

  const ictSummary = summarizeIctSignalAudit(ictSignalRecords);
  const acceptanceRate = pct(ictSummary.acceptedCount, ictSummary.totalEvaluations);
  const rejectionRate = pct(ictSummary.rejectedCount, ictSummary.totalEvaluations);

  const width = 60;
  const rule = '-'.repeat(width);
  const line = (label: string, value: string): void => {
    const gap = width - label.length - value.length;
    console.log(`  ${label}${' '.repeat(Math.max(1, gap))}${value}`);
  };

  console.log('');
  console.log(`  +${'='.repeat(width)}+`);
  console.log(`  |${'  NADO BOT - PERFORMANCE REPORT'.padEnd(width)}|`);
  console.log(`  +${'='.repeat(width)}+`);
  console.log('');
  line('Symbol', symbol);
  line('Side', side);
  line('Data Source', source);
  line('Period', `${fmtTs(firstTs)} -> ${fmtTs(lastTs)}`);
  console.log(`  ${rule}`);

  console.log('  EVENT BREAKDOWN');
  line('  Total events logged', String(totalEvents));
  line('  ENTRY', String(entryCount));
  line('  DCA', String(dcaCount));
  line('  TAKE_PROFIT', String(tpCount));
  line('  RISK_EXIT', String(riskExitCount));
  console.log(`  ${rule}`);

  console.log('  ICT SIGNAL AUDIT');
  line('  Total Signals Seen', String(ictSummary.totalEvaluations));
  line('  Acceptance Rate', `${acceptanceRate.toFixed(1)}%`);
  line('  Rejection Rate', `${rejectionRate.toFixed(1)}%`);
  line('  BUY Count', String(ictSummary.buyCount));
  line('  SELL Count', String(ictSummary.sellCount));
  line('  NONE Count', String(ictSummary.noneCount));
  console.log(`  ${rule}`);

  if (totalTrades === 0) {
    console.log('  COMPLETED TRADES');
    console.log('  No completed trades yet. Let the simulation run longer.');
  } else {
    console.log('  COMPLETED TRADES');
    line('  Total trades', String(totalTrades));
    line('  Wins', String(wins));
    line('  Losses', String(losses));
    line('  Win rate', `${winRate.toFixed(1)}%`);
    console.log(`  ${rule}`);

    console.log('  PnL');
    line('  Realized PnL', `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
    line('  Average PnL per trade', `${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(2)}`);
    line('  Largest win', `+$${largestWin.toFixed(2)}`);
    line('  Largest loss', largestLoss < 0 ? `-$${Math.abs(largestLoss).toFixed(2)}` : '$0.00');
    console.log(`  ${rule}`);

    console.log('  DCA BEHAVIOUR');
    line('  Average DCA count', avgDca.toFixed(2));
    line('  Max DCA count', String(maxDca));
  }

  console.log(`  ${rule}`);
  console.log('');
}

function fmtTs(iso: string): string {
  if (iso === 'N/A') return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

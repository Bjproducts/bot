import * as fs from 'fs';
import * as path from 'path';
import type { SignalSource } from '../types';
import type { IctSignalAction, IctSignalResult } from './ictSignalTypes';
import type { TradeCandidate } from './tradeCandidateTypes';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
export const ICT_SIGNALS_CSV_PATH = path.join(LOGS_DIR, 'ict-signals.csv');
export const ICT_SIGNALS_JSON_PATH = path.join(LOGS_DIR, 'ict-signals.json');

export interface IctSignalAuditRecord {
  timestamp: string;
  symbol: string;
  price: number;
  signal: IctSignalAction;
  confidence: number;
  zoneType: string;
  zoneId: string;
  reason: string;
  accepted: boolean;
  rejectionReason: string;
  signalSource: SignalSource;
  marketDataSource: string;
  tradeSelectionStatus: string;
  tradeSelectionReason: string;
  entryPrice: number | null;
  stopPrice: number | null;
  riskDistance: number | null;
  zoneSize: number | null;
  stopSource: string;
  expectedProfitAtTPUsd: number | null;
  tradeSelectionScore: number | null;
}

export interface IctSignalAuditSummary {
  totalEvaluations: number;
  buyCount: number;
  sellCount: number;
  noneCount: number;
  acceptedCount: number;
  rejectedCount: number;
}

export interface IctSignalAuditFile {
  updatedAt: string;
  summary: IctSignalAuditSummary;
  records: IctSignalAuditRecord[];
}

const CSV_HEADER = [
  'timestamp',
  'symbol',
  'price',
  'signal',
  'confidence',
  'zoneType',
  'zoneId',
  'reason',
  'accepted',
  'rejectionReason',
  'signalSource',
  'marketDataSource',
  'tradeSelectionStatus',
  'tradeSelectionReason',
  'entryPrice',
  'stopPrice',
  'riskDistance',
  'zoneSize',
  'stopSource',
  'expectedProfitAtTPUsd',
  'tradeSelectionScore',
].join(',');

const EMPTY_SUMMARY: IctSignalAuditSummary = {
  totalEvaluations: 0,
  buyCount: 0,
  sellCount: 0,
  noneCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
};

export class IctSignalAuditLog {
  private records: IctSignalAuditRecord[];

  constructor() {
    ensureLogsDir();
    ensureCsvFile();
    this.records = loadIctSignalAuditRecords();
    this.writeJsonFile();
  }

  log(record: IctSignalAuditRecord): void {
    try {
      fs.appendFileSync(ICT_SIGNALS_CSV_PATH, toCsvRow(record) + '\n', 'utf-8');
      this.records.push(record);
      this.writeJsonFile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  ICT signal audit log write failed: ${msg}`);
    }
  }

  private writeJsonFile(): void {
    const file: IctSignalAuditFile = {
      updatedAt: new Date().toISOString(),
      summary: summarizeIctSignalAudit(this.records),
      records: this.records,
    };

    fs.writeFileSync(ICT_SIGNALS_JSON_PATH, JSON.stringify(file, null, 2), 'utf-8');
  }
}

export function makeIctSignalAuditRecord(input: {
  signal: IctSignalResult;
  symbol: string;
  price: number;
  signalSource: SignalSource;
  marketDataSource: string;
  tradeCandidate?: TradeCandidate;
}): IctSignalAuditRecord {
  const accepted = input.signal.signal === 'BUY' || input.signal.signal === 'SELL';
  const candidate = input.tradeCandidate;
  return {
    timestamp: input.signal.evaluatedAt,
    symbol: input.symbol,
    price: input.price,
    signal: input.signal.signal,
    confidence: input.signal.confidence,
    zoneType: input.signal.sourceZoneType,
    zoneId: input.signal.zoneId,
    reason: input.signal.reason,
    accepted,
    rejectionReason: accepted ? '' : classifyIctRejectionReason(input.signal),
    signalSource: input.signalSource,
    marketDataSource: input.marketDataSource,
    tradeSelectionStatus: candidate?.status ?? (accepted ? 'NOT_EVALUATED' : 'NOT_CANDIDATE'),
    tradeSelectionReason: candidate?.rejectionReason ?? '',
    entryPrice: candidate?.entryPrice ?? null,
    stopPrice: candidate?.stopPrice ?? null,
    riskDistance: candidate?.riskDistance ?? null,
    zoneSize: candidate?.zoneSize ?? null,
    stopSource: candidate?.stopSource ?? '',
    expectedProfitAtTPUsd: candidate?.expectedProfitAtTPUsd ?? null,
    tradeSelectionScore: candidate?.score ?? null,
  };
}

export function classifyIctRejectionReason(signal: IctSignalResult): string {
  if (signal.signal !== 'NONE') return '';

  if (/invalidated/i.test(signal.reason)) {
    return 'Invalidated zone';
  }

  if (/confidence|below minimum/i.test(signal.reason)) {
    return 'Below confidence threshold';
  }

  if (signal.reactionOutput === 'NONE') {
    return 'Missing reaction';
  }

  return signal.reason || 'Other future rejection reason';
}

export function loadIctSignalAuditRecords(): IctSignalAuditRecord[] {
  try {
    if (!fs.existsSync(ICT_SIGNALS_JSON_PATH)) return [];
    const raw = fs.readFileSync(ICT_SIGNALS_JSON_PATH, 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IctSignalAuditFile | IctSignalAuditRecord[];
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export function summarizeIctSignalAudit(
  records: readonly IctSignalAuditRecord[],
): IctSignalAuditSummary {
  return records.reduce<IctSignalAuditSummary>((summary, record) => {
    summary.totalEvaluations += 1;
    if (record.signal === 'BUY') summary.buyCount += 1;
    if (record.signal === 'SELL') summary.sellCount += 1;
    if (record.signal === 'NONE') summary.noneCount += 1;
    if (record.accepted) {
      summary.acceptedCount += 1;
    } else {
      summary.rejectedCount += 1;
    }
    return summary;
  }, { ...EMPTY_SUMMARY });
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function ensureCsvFile(): void {
  const exists = fs.existsSync(ICT_SIGNALS_CSV_PATH);
  const isEmpty = exists ? fs.statSync(ICT_SIGNALS_CSV_PATH).size === 0 : true;
  if (!exists || isEmpty) {
    fs.writeFileSync(ICT_SIGNALS_CSV_PATH, CSV_HEADER + '\n', 'utf-8');
  }
}

function toCsvRow(record: IctSignalAuditRecord): string {
  return [
    record.timestamp,
    record.symbol,
    record.price.toFixed(2),
    record.signal,
    record.confidence.toFixed(2),
    record.zoneType,
    csv(record.zoneId),
    csv(record.reason),
    String(record.accepted),
    csv(record.rejectionReason),
    record.signalSource,
    csv(record.marketDataSource),
    record.tradeSelectionStatus,
    csv(record.tradeSelectionReason),
    record.entryPrice === null ? '' : record.entryPrice.toFixed(2),
    record.stopPrice === null ? '' : record.stopPrice.toFixed(2),
    record.riskDistance === null ? '' : record.riskDistance.toFixed(4),
    record.zoneSize === null ? '' : record.zoneSize.toFixed(4),
    record.stopSource,
    record.expectedProfitAtTPUsd === null ? '' : record.expectedProfitAtTPUsd.toFixed(4),
    record.tradeSelectionScore === null ? '' : record.tradeSelectionScore.toFixed(2),
  ].join(',');
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

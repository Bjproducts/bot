import * as fs from 'fs';
import * as path from 'path';
import { LiveOrderResponse, SafetyGateResult } from './exchangeTypes';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
const LIVE_ORDERS_CSV = 'live-orders.csv';
const LIVE_ORDERS_JSON = 'live-orders.json';

const CSV_HEADER = [
  'timestamp',
  'symbol',
  'side',
  'action',
  'orderType',
  'requestedSizeUsd',
  'executedSizeUsd',
  'requestedPrice',
  'executedPrice',
  'status',
  'exchangeOrderId',
  'reason',
  'safetyGateResult',
].join(',');

export interface LiveOrderJournalRecord extends LiveOrderResponse {
  safetyGateResult: SafetyGateResult;
}

export interface LiveOrderJournalOptions {
  logsDir?: string;
}

export class LiveOrderJournal {
  private readonly logsDir: string;
  private readonly csvPath: string;
  private readonly jsonPath: string;

  constructor(options: LiveOrderJournalOptions = {}) {
    this.logsDir = options.logsDir ?? LOGS_DIR;
    this.csvPath = path.join(this.logsDir, LIVE_ORDERS_CSV);
    this.jsonPath = path.join(this.logsDir, LIVE_ORDERS_JSON);
    this.ensureFiles();
  }

  log(record: LiveOrderJournalRecord): void {
    fs.appendFileSync(this.csvPath, this.toCsvRow(record) + '\n', 'utf-8');

    const existing = this.readJson();
    existing.push(record);
    fs.writeFileSync(this.jsonPath, JSON.stringify(existing, null, 2), 'utf-8');
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
    if (!fs.existsSync(this.csvPath) || fs.statSync(this.csvPath).size === 0) {
      fs.writeFileSync(this.csvPath, CSV_HEADER + '\n', 'utf-8');
    }
    if (!fs.existsSync(this.jsonPath)) {
      fs.writeFileSync(this.jsonPath, '[]', 'utf-8');
    }
  }

  private readJson(): LiveOrderJournalRecord[] {
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf-8').trim();
      return raw ? (JSON.parse(raw) as LiveOrderJournalRecord[]) : [];
    } catch {
      return [];
    }
  }

  private toCsvRow(record: LiveOrderJournalRecord): string {
    const safetyGateResult = record.safetyGateResult.passed
      ? 'PASSED'
      : `FAILED:${record.safetyGateResult.failures.join('|')}`;

    return [
      record.timestamp,
      record.symbol,
      record.side,
      record.action,
      record.orderType,
      record.requestedSizeUsd.toFixed(2),
      record.executedSizeUsd.toFixed(2),
      record.requestedPrice !== undefined ? record.requestedPrice.toFixed(8) : '',
      record.executedPrice !== undefined ? record.executedPrice.toFixed(8) : '',
      record.status,
      csv(record.exchangeOrderId),
      csv(record.reason),
      csv(safetyGateResult),
    ].join(',');
  }
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

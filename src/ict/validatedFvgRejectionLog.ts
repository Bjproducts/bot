import * as fs from 'fs';
import * as path from 'path';
import { FvgValidationResult } from './validatedFvgTypes';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
const DEFAULT_CSV_PATH = path.join(LOGS_DIR, 'validated-fvg-rejections.csv');
const DEFAULT_JSON_PATH = path.join(LOGS_DIR, 'validated-fvg-rejections.json');

// Pulled from validatedFvgDetector DEFAULT_OPTIONS — kept in sync manually
// because this module must NOT change validation thresholds, only report
// against them.
export const BODY_TO_RANGE_PERCENT_REQUIRED = 60;
export const RANGE_MULTIPLE_REQUIRED = 1.2;

export type ValidatedFvgCheckName =
  | 'liquiditySweep'
  | 'displacement'
  | 'mss'
  | 'premiumDiscount'
  | 'session';

export interface RejectedFvgRecord {
  timestamp: string;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH';
  rawFvgId: string;
  zoneHigh: number;
  zoneLow: number;
  zoneMidpoint: number;
  // Per-check pass/fail flags.
  liquiditySweepPassed: boolean;
  displacementPassed: boolean;
  mssPassed: boolean;
  premiumDiscountPassed: boolean;
  sessionPassed: boolean;
  // Measured values from the validation result.
  bodyToRangePercent: number | null;
  bodyToRangeRequiredPercent: number;
  rangeMultiple: number | null;
  rangeMultipleRequired: number;
  sweepDetected: boolean;
  mssDetected: boolean;
  premiumDiscountOk: boolean;
  sessionOk: boolean;
  failedChecks: ValidatedFvgCheckName[];
  rejectionReasons: string[];
}

export interface ValidatedFvgRejectionSummary {
  totalRawFvgs: number;
  acceptedValidatedFvgs: number;
  rejectedFvgs: number;
  rejectedNoSweep: number;
  rejectedNoDisplacement: number;
  rejectedNoMss: number;
  rejectedPremiumDiscount: number;
  rejectedSession: number;
  mostCommonRejectionCombo: string;
  topRejectionReason: string;
}

export interface RejectionContext {
  symbol: string;
  timestamp?: string;
}

const CSV_HEADER = [
  'timestamp',
  'symbol',
  'direction',
  'rawFvgId',
  'zoneHigh',
  'zoneLow',
  'zoneMidpoint',
  'liquiditySweepPassed',
  'displacementPassed',
  'mssPassed',
  'premiumDiscountPassed',
  'sessionPassed',
  'bodyToRangePercent',
  'bodyToRangeRequiredPercent',
  'rangeMultiple',
  'rangeMultipleRequired',
  'sweepDetected',
  'mssDetected',
  'premiumDiscountOk',
  'sessionOk',
  'failedChecks',
  'rejectionReasons',
].join(',');

export function toRejectedFvgRecord(
  result: FvgValidationResult,
  context: RejectionContext,
): RejectedFvgRecord | null {
  if (result.accepted) return null;

  const validation = result.validation;
  const rawFvg = result.rawFvg;
  const failed: ValidatedFvgCheckName[] = [];
  if (!validation.liquiditySweep.passed) failed.push('liquiditySweep');
  if (!validation.displacement.passed) failed.push('displacement');
  if (!validation.marketStructureShift.passed) failed.push('mss');
  if (!validation.premiumDiscount.passed) failed.push('premiumDiscount');
  if (!validation.sessionFilter.passed) failed.push('session');

  return {
    timestamp: context.timestamp ?? new Date().toISOString(),
    symbol: context.symbol,
    direction: rawFvg.direction,
    rawFvgId: rawFvg.id,
    zoneHigh: rawFvg.high,
    zoneLow: rawFvg.low,
    zoneMidpoint: rawFvg.midpoint,
    liquiditySweepPassed: validation.liquiditySweep.passed,
    displacementPassed: validation.displacement.passed,
    mssPassed: validation.marketStructureShift.passed,
    premiumDiscountPassed: validation.premiumDiscount.passed,
    sessionPassed: validation.sessionFilter.passed,
    bodyToRangePercent: validation.displacement.bodyToRangePercent,
    bodyToRangeRequiredPercent: BODY_TO_RANGE_PERCENT_REQUIRED,
    rangeMultiple: validation.displacement.rangeMultiple,
    rangeMultipleRequired: RANGE_MULTIPLE_REQUIRED,
    sweepDetected: validation.liquiditySweep.passed,
    mssDetected: validation.marketStructureShift.passed,
    premiumDiscountOk: validation.premiumDiscount.passed,
    sessionOk: validation.sessionFilter.passed,
    failedChecks: failed,
    rejectionReasons: [...validation.rejectionReasons],
  };
}

export function summarizeValidationResults(
  results: readonly FvgValidationResult[],
): ValidatedFvgRejectionSummary {
  const accepted = results.filter(r => r.accepted).length;
  const rejected = results.filter(r => !r.accepted);
  const total = results.length;

  let rejectedNoSweep = 0;
  let rejectedNoDisplacement = 0;
  let rejectedNoMss = 0;
  let rejectedPremiumDiscount = 0;
  let rejectedSession = 0;
  const comboCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();

  for (const r of rejected) {
    if (!r.validation.liquiditySweep.passed) rejectedNoSweep++;
    if (!r.validation.displacement.passed) rejectedNoDisplacement++;
    if (!r.validation.marketStructureShift.passed) rejectedNoMss++;
    if (!r.validation.premiumDiscount.passed) rejectedPremiumDiscount++;
    if (!r.validation.sessionFilter.passed) rejectedSession++;

    const combo = failureComboOf(r);
    comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1);
    for (const reason of r.validation.rejectionReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    totalRawFvgs: total,
    acceptedValidatedFvgs: accepted,
    rejectedFvgs: rejected.length,
    rejectedNoSweep,
    rejectedNoDisplacement,
    rejectedNoMss,
    rejectedPremiumDiscount,
    rejectedSession,
    mostCommonRejectionCombo: topKey(comboCounts) ?? 'none',
    topRejectionReason: topKey(reasonCounts) ?? 'none',
  };
}

function failureComboOf(result: FvgValidationResult): string {
  const failed: string[] = [];
  if (!result.validation.liquiditySweep.passed) failed.push('liquiditySweep');
  if (!result.validation.displacement.passed) failed.push('displacement');
  if (!result.validation.marketStructureShift.passed) failed.push('mss');
  if (!result.validation.premiumDiscount.passed) failed.push('premiumDiscount');
  if (!result.validation.sessionFilter.passed) failed.push('session');
  return failed.length === 0 ? 'none' : failed.sort().join('+');
}

function topKey(counts: Map<string, number>): string | null {
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey;
}

export interface RejectionLogPaths {
  csvPath: string;
  jsonPath: string;
}

export class ValidatedFvgRejectionLog {
  private readonly csvPath: string;
  private readonly jsonPath: string;
  private readonly logsDir: string;

  constructor(options: { logsDir?: string } = {}) {
    this.logsDir = options.logsDir ?? LOGS_DIR;
    this.csvPath = path.join(this.logsDir, 'validated-fvg-rejections.csv');
    this.jsonPath = path.join(this.logsDir, 'validated-fvg-rejections.json');
  }

  paths(): RejectionLogPaths {
    return { csvPath: this.csvPath, jsonPath: this.jsonPath };
  }

  recordValidationResults(
    results: readonly FvgValidationResult[],
    context: RejectionContext,
  ): { rejected: RejectedFvgRecord[]; summary: ValidatedFvgRejectionSummary } {
    const summary = summarizeValidationResults(results);
    const rejected: RejectedFvgRecord[] = [];
    for (const result of results) {
      const record = toRejectedFvgRecord(result, context);
      if (record !== null) rejected.push(record);
    }
    if (rejected.length > 0) {
      this.ensureFiles();
      for (const record of rejected) {
        this.appendCsv(record);
      }
      this.appendJson(rejected);
    }
    return { rejected, summary };
  }

  private ensureFiles(): void {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
      if (!fs.existsSync(this.csvPath) || fs.statSync(this.csvPath).size === 0) {
        fs.writeFileSync(this.csvPath, CSV_HEADER + '\n', 'utf-8');
      }
      if (!fs.existsSync(this.jsonPath)) {
        fs.writeFileSync(this.jsonPath, '[]', 'utf-8');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  validated-fvg-rejections init failed: ${msg}`);
    }
  }

  private appendCsv(record: RejectedFvgRecord): void {
    const row = [
      record.timestamp,
      record.symbol,
      record.direction,
      csv(record.rawFvgId),
      record.zoneHigh.toFixed(4),
      record.zoneLow.toFixed(4),
      record.zoneMidpoint.toFixed(4),
      String(record.liquiditySweepPassed),
      String(record.displacementPassed),
      String(record.mssPassed),
      String(record.premiumDiscountPassed),
      String(record.sessionPassed),
      record.bodyToRangePercent === null ? '' : record.bodyToRangePercent.toFixed(4),
      record.bodyToRangeRequiredPercent.toFixed(2),
      record.rangeMultiple === null ? '' : record.rangeMultiple.toFixed(4),
      record.rangeMultipleRequired.toFixed(2),
      String(record.sweepDetected),
      String(record.mssDetected),
      String(record.premiumDiscountOk),
      String(record.sessionOk),
      csv(record.failedChecks.join('|')),
      csv(record.rejectionReasons.join('|')),
    ].join(',');
    try {
      fs.appendFileSync(this.csvPath, row + '\n', 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  validated-fvg-rejections CSV write failed: ${msg}`);
    }
  }

  private appendJson(records: readonly RejectedFvgRecord[]): void {
    try {
      const existing = this.readJson();
      existing.push(...records);
      fs.writeFileSync(this.jsonPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  validated-fvg-rejections JSON write failed: ${msg}`);
    }
  }

  private readJson(): RejectedFvgRecord[] {
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf-8').trim();
      return raw ? (JSON.parse(raw) as RejectedFvgRecord[]) : [];
    } catch {
      return [];
    }
  }
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

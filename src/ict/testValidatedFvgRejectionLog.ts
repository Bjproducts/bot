import * as fs from 'fs';
import * as path from 'path';
import { FVGZone } from './types';
import { FvgValidationResult, ValidatedFvgValidation } from './validatedFvgTypes';
import {
  BODY_TO_RANGE_PERCENT_REQUIRED,
  RANGE_MULTIPLE_REQUIRED,
  ValidatedFvgRejectionLog,
  summarizeValidationResults,
  toRejectedFvgRecord,
} from './validatedFvgRejectionLog';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const tmpLogsDir = path.resolve(__dirname, '../../logs/validated-fvg-rejection-test');
if (fs.existsSync(tmpLogsDir)) fs.rmSync(tmpLogsDir, { recursive: true, force: true });

const tests: TestResult[] = [
  test1RejectedFvgRecordsNoSweepReason(),
  test2RejectedFvgRecordsNoDisplacementReason(),
  test3RejectedFvgRecordsNoMssReason(),
  test4AcceptedFvgIsNotLoggedAsRejected(),
  test5SummaryCountsAreCorrect(),
];

let failures = 0;
for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Expected: ${test.expected}`);
  console.log(`Actual:   ${test.actual}`);
  console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
  if (!test.passed) failures++;
}

if (failures > 0) {
  console.error(`Validated FVG rejection tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Validated FVG rejection tests: ${tests.length}/${tests.length} passed`);

function test1RejectedFvgRecordsNoSweepReason(): TestResult {
  const result = rejectedResultWith({ liquiditySweep: false });
  const record = toRejectedFvgRecord(result, { symbol: 'BTC', timestamp: 'T0' });
  return {
    name: 'rejected FVG records no sweep reason',
    expected: 'liquiditySweepPassed=false and failedChecks includes liquiditySweep',
    actual: record
      ? `liquiditySweepPassed=${record.liquiditySweepPassed} failedChecks=${record.failedChecks.join(',')}`
      : 'null',
    passed: !!record && record.liquiditySweepPassed === false && record.failedChecks.includes('liquiditySweep'),
  };
}

function test2RejectedFvgRecordsNoDisplacementReason(): TestResult {
  const result = rejectedResultWith({ displacement: false, bodyToRangePercent: 35, rangeMultiple: 0.8 });
  const record = toRejectedFvgRecord(result, { symbol: 'BTC', timestamp: 'T0' });
  return {
    name: 'rejected FVG records no displacement reason',
    expected: 'displacementPassed=false, bodyToRangePercent=35, rangeMultiple=0.8',
    actual: record
      ? `displacementPassed=${record.displacementPassed} bodyToRangePercent=${record.bodyToRangePercent} rangeMultiple=${record.rangeMultiple} req=${record.bodyToRangeRequiredPercent}/${record.rangeMultipleRequired}`
      : 'null',
    passed: !!record
      && record.displacementPassed === false
      && record.bodyToRangePercent === 35
      && record.rangeMultiple === 0.8
      && record.bodyToRangeRequiredPercent === BODY_TO_RANGE_PERCENT_REQUIRED
      && record.rangeMultipleRequired === RANGE_MULTIPLE_REQUIRED
      && record.failedChecks.includes('displacement'),
  };
}

function test3RejectedFvgRecordsNoMssReason(): TestResult {
  const result = rejectedResultWith({ mss: false });
  const record = toRejectedFvgRecord(result, { symbol: 'BTC', timestamp: 'T0' });
  return {
    name: 'rejected FVG records no MSS reason',
    expected: 'mssPassed=false and failedChecks includes mss',
    actual: record
      ? `mssPassed=${record.mssPassed} failedChecks=${record.failedChecks.join(',')}`
      : 'null',
    passed: !!record && record.mssPassed === false && record.failedChecks.includes('mss'),
  };
}

function test4AcceptedFvgIsNotLoggedAsRejected(): TestResult {
  const result = acceptedResult();
  const inMemoryRecord = toRejectedFvgRecord(result, { symbol: 'BTC', timestamp: 'T0' });

  const log = new ValidatedFvgRejectionLog({ logsDir: tmpLogsDir });
  const { rejected } = log.recordValidationResults([result], { symbol: 'BTC', timestamp: 'T0' });

  const { csvPath, jsonPath } = log.paths();
  // No rejected records → the log should NOT have created the files,
  // because writes are gated by "rejected.length > 0".
  const csvExists = fs.existsSync(csvPath);
  const jsonExists = fs.existsSync(jsonPath);

  return {
    name: 'accepted FVG is not logged as rejected',
    expected: 'toRejectedFvgRecord returns null, rejected list empty, no log files written',
    actual: `record=${inMemoryRecord === null ? 'null' : 'present'} rejected=${rejected.length} csvExists=${csvExists} jsonExists=${jsonExists}`,
    passed: inMemoryRecord === null && rejected.length === 0 && !csvExists && !jsonExists,
  };
}

function test5SummaryCountsAreCorrect(): TestResult {
  const batch: FvgValidationResult[] = [
    acceptedResult(),                                          // accepted
    rejectedResultWith({ liquiditySweep: false }),             // sweep
    rejectedResultWith({ liquiditySweep: false, mss: false }), // sweep+mss combo (2x sweep, 1x mss so far)
    rejectedResultWith({ displacement: false }),               // displacement
  ];
  const summary = summarizeValidationResults(batch);

  const counts = `total=${summary.totalRawFvgs} accepted=${summary.acceptedValidatedFvgs} rejected=${summary.rejectedFvgs}`
    + ` noSweep=${summary.rejectedNoSweep} noDisp=${summary.rejectedNoDisplacement} noMss=${summary.rejectedNoMss}`
    + ` premium=${summary.rejectedPremiumDiscount} session=${summary.rejectedSession}`
    + ` combo=${summary.mostCommonRejectionCombo}`;

  const ok = summary.totalRawFvgs === 4
    && summary.acceptedValidatedFvgs === 1
    && summary.rejectedFvgs === 3
    && summary.rejectedNoSweep === 2
    && summary.rejectedNoDisplacement === 1
    && summary.rejectedNoMss === 1
    && summary.rejectedPremiumDiscount === 0
    && summary.rejectedSession === 0;

  return {
    name: 'summary counts are correct',
    expected: 'total=4 accepted=1 rejected=3 noSweep=2 noDisp=1 noMss=1',
    actual: counts,
    passed: ok,
  };
}

function rawFvg(id: string = 'test-fvg'): FVGZone {
  return {
    id,
    type: 'FVG',
    direction: 'BULLISH',
    high: 102,
    low: 100,
    midpoint: 101,
    createdAt: '2026-06-03T00:00:00.000Z',
    invalidated: false,
    filled: false,
    flipped: false,
    candle1Index: 0,
    candle2Index: 1,
    candle3Index: 2,
  };
}

function check(passed: boolean, detail: string) {
  return {
    status: passed ? ('PASS' as const) : ('FAIL' as const),
    passed,
    detail,
  };
}

function rejectedResultWith(failed: {
  liquiditySweep?: boolean; // pass flag; default true
  displacement?: boolean;
  mss?: boolean;
  premiumDiscount?: boolean;
  session?: boolean;
  bodyToRangePercent?: number;
  rangeMultiple?: number;
}): FvgValidationResult {
  const liquiditySweepPassed = failed.liquiditySweep ?? true;
  const displacementPassed = failed.displacement ?? true;
  const mssPassed = failed.mss ?? true;
  const premiumDiscountPassed = failed.premiumDiscount ?? true;
  const sessionPassed = failed.session ?? true;

  const rejectionReasons: string[] = [];
  if (!liquiditySweepPassed) rejectionReasons.push('Bullish FVG did not sweep sell-side liquidity first');
  if (!displacementPassed) rejectionReasons.push('FVG lacks required bullish displacement');
  if (!mssPassed) rejectionReasons.push('Bullish FVG did not close above prior structure high');
  if (!premiumDiscountPassed) rejectionReasons.push('FVG is not in required discount context');
  if (!sessionPassed) rejectionReasons.push('FVG formed outside allowed UTC hours');

  const validation: ValidatedFvgValidation = {
    accepted: false,
    rawFvgId: 'test-fvg',
    direction: 'BULLISH',
    liquiditySweep: {
      ...check(liquiditySweepPassed, liquiditySweepPassed ? 'swept' : 'no sweep'),
      sweptSide: 'SELL_SIDE',
      sweepCandleIndex: liquiditySweepPassed ? 1 : null,
      referenceLevel: 99.5,
      sweepPrice: liquiditySweepPassed ? 99.0 : 99.6,
    },
    displacement: {
      ...check(displacementPassed, displacementPassed ? 'displacement' : 'no displacement'),
      displacementCandleIndex: 1,
      bodyToRangePercent: failed.bodyToRangePercent ?? (displacementPassed ? 75 : 35),
      rangeMultiple: failed.rangeMultiple ?? (displacementPassed ? 1.5 : 0.8),
    },
    marketStructureShift: {
      ...check(mssPassed, mssPassed ? 'mss' : 'no mss'),
      mssCandleIndex: 2,
      referenceLevel: 101.5,
      breakPrice: mssPassed ? 102 : 101.4,
    },
    premiumDiscount: {
      ...check(premiumDiscountPassed, premiumDiscountPassed ? 'p/d ok' : 'wrong p/d'),
      context: 'DISCOUNT',
      equilibrium: 100,
    },
    sessionFilter: {
      ...check(sessionPassed, sessionPassed ? 'session ok' : 'outside session'),
      sessionHourUtc: 14,
    },
    rejectionReasons,
  };

  return {
    rawFvg: rawFvg(),
    accepted: false,
    zone: null,
    validation,
  };
}

function acceptedResult(): FvgValidationResult {
  const validation: ValidatedFvgValidation = {
    accepted: true,
    rawFvgId: 'accepted-fvg',
    direction: 'BULLISH',
    liquiditySweep: { ...check(true, 'swept'), sweptSide: 'SELL_SIDE', sweepCandleIndex: 1, referenceLevel: 99.5, sweepPrice: 99.0 },
    displacement: { ...check(true, 'displacement'), displacementCandleIndex: 1, bodyToRangePercent: 75, rangeMultiple: 1.5 },
    marketStructureShift: { ...check(true, 'mss'), mssCandleIndex: 2, referenceLevel: 101.5, breakPrice: 102 },
    premiumDiscount: { ...check(true, 'p/d ok'), context: 'DISCOUNT', equilibrium: 100 },
    sessionFilter: { ...check(true, 'session ok'), sessionHourUtc: 14 },
    rejectionReasons: [],
  };
  const accepted = rawFvg('accepted-fvg');
  return {
    rawFvg: accepted,
    accepted: true,
    zone: { ...accepted, validated: true, validation },
    validation,
  };
}

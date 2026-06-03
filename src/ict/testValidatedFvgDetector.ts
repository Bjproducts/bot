import { Candle } from '../signals/types';
import { detectValidatedFVGs, validateFVGs } from './validatedFvgDetector';
import { FvgValidationResult } from './validatedFvgTypes';

interface Fixture {
  name: string;
  candles: Candle[];
  targetIndex: number;
  targetDirection: 'BULLISH' | 'BEARISH';
  expected: {
    foundRawFvg: boolean;
    accepted: boolean;
    validatedCount: number;
    rejectionIncludes?: string;
    liquiditySweep?: 'PASS' | 'FAIL';
    displacement?: 'PASS' | 'FAIL';
    marketStructureShift?: 'PASS' | 'FAIL';
  };
}

interface TestResult {
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

const fixtures: Fixture[] = [
  {
    name: 'random 3-candle gap is rejected',
    candles: randomThreeCandleGap(),
    targetIndex: 7,
    targetDirection: 'BULLISH',
    expected: {
      foundRawFvg: true,
      accepted: false,
      validatedCount: 0,
      rejectionIncludes: 'liquidity',
      liquiditySweep: 'FAIL',
    },
  },
  {
    name: 'bearish FVG after buy-side sweep is accepted',
    candles: bearishAfterBuySideSweep(),
    targetIndex: 7,
    targetDirection: 'BEARISH',
    expected: {
      foundRawFvg: true,
      accepted: true,
      validatedCount: 1,
      liquiditySweep: 'PASS',
      displacement: 'PASS',
      marketStructureShift: 'PASS',
    },
  },
  {
    name: 'bullish FVG after sell-side sweep is accepted',
    candles: bullishAfterSellSideSweep(),
    targetIndex: 7,
    targetDirection: 'BULLISH',
    expected: {
      foundRawFvg: true,
      accepted: true,
      validatedCount: 1,
      liquiditySweep: 'PASS',
      displacement: 'PASS',
      marketStructureShift: 'PASS',
    },
  },
  {
    name: 'FVG without displacement is rejected',
    candles: bullishWithoutDisplacement(),
    targetIndex: 7,
    targetDirection: 'BULLISH',
    expected: {
      foundRawFvg: true,
      accepted: false,
      validatedCount: 0,
      rejectionIncludes: 'displacement',
      displacement: 'FAIL',
    },
  },
  {
    name: 'FVG without MSS is rejected',
    candles: bearishWithoutMss(),
    targetIndex: 7,
    targetDirection: 'BEARISH',
    expected: {
      foundRawFvg: true,
      accepted: false,
      validatedCount: 0,
      rejectionIncludes: 'structure',
      marketStructureShift: 'FAIL',
    },
  },
];

const results = fixtures.map(runFixture);

for (const result of results) {
  console.log(`Test: ${result.name}`);
  console.log(`Expected: ${stableJson(result.expected)}`);
  console.log(`Actual:   ${stableJson(result.actual)}`);
  console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
  console.log('');
}

const failed = results.filter(result => !result.passed);
console.log(`Validated FVG detector tests: ${results.length - failed.length}/${results.length} passed`);

if (failed.length > 0) {
  process.exit(1);
}

function runFixture(fixture: Fixture): TestResult {
  const validations = validateFVGs(fixture.candles);
  const validated = detectValidatedFVGs({ candles: fixture.candles });
  const target = validations.find(result =>
    result.rawFvg.candle3Index === fixture.targetIndex
    && result.rawFvg.direction === fixture.targetDirection
  );
  const actual = summarize(target, validated.length);
  const passed = matchesExpected(actual, fixture.expected);

  return {
    name: fixture.name,
    expected: fixture.expected,
    actual,
    passed,
  };
}

function summarize(target: FvgValidationResult | undefined, validatedCount: number): unknown {
  if (!target) {
    return {
      foundRawFvg: false,
      accepted: false,
      validatedCount,
    };
  }

  return {
    foundRawFvg: true,
    accepted: target.accepted,
    validatedCount,
    direction: target.rawFvg.direction,
    rejectionReasons: target.validation.rejectionReasons,
    liquiditySweep: target.validation.liquiditySweep.status,
    displacement: target.validation.displacement.status,
    marketStructureShift: target.validation.marketStructureShift.status,
  };
}

function matchesExpected(actual: unknown, expected: Fixture['expected']): boolean {
  const value = actual as {
    foundRawFvg?: boolean;
    accepted?: boolean;
    validatedCount?: number;
    rejectionReasons?: string[];
    liquiditySweep?: string;
    displacement?: string;
    marketStructureShift?: string;
  };

  if (value.foundRawFvg !== expected.foundRawFvg) return false;
  if (value.accepted !== expected.accepted) return false;
  if (value.validatedCount !== expected.validatedCount) return false;
  if (expected.liquiditySweep && value.liquiditySweep !== expected.liquiditySweep) return false;
  if (expected.displacement && value.displacement !== expected.displacement) return false;
  if (
    expected.marketStructureShift
    && value.marketStructureShift !== expected.marketStructureShift
  ) {
    return false;
  }
  if (expected.rejectionIncludes) {
    const haystack = (value.rejectionReasons ?? []).join(' ').toLowerCase();
    if (!haystack.includes(expected.rejectionIncludes.toLowerCase())) return false;
  }

  return true;
}

function randomThreeCandleGap(): Candle[] {
  return [
    c(0, 101, 102, 100, 101),
    c(1, 101.2, 102.5, 100.5, 101.5),
    c(2, 101.4, 103, 100.8, 102),
    c(3, 102, 103.5, 101, 103),
    c(4, 102.5, 104, 101.5, 103.5),
    c(5, 103, 104, 102, 103.5),
    c(6, 103.6, 108, 103, 107.5),
    c(7, 107, 109, 105, 108),
  ];
}

function bearishAfterBuySideSweep(): Candle[] {
  return [
    c(0, 101, 102, 100, 101),
    c(1, 101.2, 102.5, 100.5, 101.5),
    c(2, 101.4, 103, 100.8, 102),
    c(3, 102, 103.5, 101, 103),
    c(4, 102.5, 104, 101.5, 103.5),
    c(5, 103.5, 105.5, 104, 104.5),
    c(6, 104.5, 105, 97.5, 98.2),
    c(7, 98.4, 103, 97, 98),
  ];
}

function bullishAfterSellSideSweep(): Candle[] {
  return [
    c(0, 102, 104, 100, 102),
    c(1, 102.2, 103.5, 100.5, 101.5),
    c(2, 101.4, 103.8, 100.8, 102),
    c(3, 102, 104, 101, 103),
    c(4, 102.5, 103.8, 101.5, 102.8),
    c(5, 101, 101.5, 99, 100.2),
    c(6, 100.2, 107, 99.5, 106.5),
    c(7, 106.3, 108, 102, 107),
  ];
}

function bullishWithoutDisplacement(): Candle[] {
  return [
    c(0, 102, 104, 100, 102),
    c(1, 102.2, 103.5, 100.5, 101.5),
    c(2, 101.4, 103.8, 100.8, 102),
    c(3, 102, 104, 101, 103),
    c(4, 102.5, 103.8, 101.5, 102.8),
    c(5, 101, 101.5, 99, 100.2),
    c(6, 100.2, 107, 99.5, 100.8),
    c(7, 106.3, 108, 102, 107),
  ];
}

function bearishWithoutMss(): Candle[] {
  return [
    c(0, 101, 102, 100, 101),
    c(1, 101.2, 102.5, 100.5, 101.5),
    c(2, 101.4, 103, 100.8, 102),
    c(3, 102, 103.5, 101, 103),
    c(4, 102.5, 104, 101.5, 103.5),
    c(5, 103.5, 105.5, 104, 104.5),
    c(6, 104.5, 105, 101.5, 102),
    c(7, 102.4, 103, 101, 102.5),
  ];
}

function c(
  minute: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return {
    timestamp: new Date(Date.UTC(2026, 5, 1, 14, minute, 0)),
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

import {
  bearishFvgPresentFixture,
  bearishIfvgFlipFixture,
  bullishFvgPresentFixture,
  bullishIfvgFlipFixture,
  filledZoneFixture,
  invalidatedZoneFixture,
  noFvgFixture,
} from './fixtures';
import { detectFVGs } from './fvgDetector';
import { detectIFVGs } from './ifvgDetector';
import { Candle } from '../signals/types';
import { FVGZone } from './types';

interface TestResult {
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

const tests: TestResult[] = [
  runTest('bullish FVG present', {
    fixture: bullishFvgPresentFixture,
    expected: {
      totalFVGs: 1,
      bullishFVGs: 1,
      bearishFVGs: 0,
      zone: {
        direction: 'BULLISH',
        high: 102,
        low: 100,
        midpoint: 101,
        invalidated: false,
        filled: false,
        flipped: false,
      },
    },
  }),
  runTest('bearish FVG present', {
    fixture: bearishFvgPresentFixture,
    expected: {
      totalFVGs: 1,
      bullishFVGs: 0,
      bearishFVGs: 1,
      zone: {
        direction: 'BEARISH',
        high: 100,
        low: 98,
        midpoint: 99,
        invalidated: false,
        filled: false,
        flipped: false,
      },
    },
  }),
  runTest('no FVG', {
    fixture: noFvgFixture,
    expected: {
      totalFVGs: 0,
      bullishFVGs: 0,
      bearishFVGs: 0,
    },
  }),
  runTest('bullish IFVG flip', {
    fixture: bullishIfvgFlipFixture,
    expected: {
      totalFVGs: 1,
      totalIFVGs: 1,
      ifvg: {
        direction: 'BULLISH',
        high: 100,
        low: 98,
        midpoint: 99,
        invalidated: false,
        filled: false,
        flipped: false,
      },
      sourceFVG: {
        direction: 'BEARISH',
        invalidated: true,
        filled: true,
        flipped: true,
      },
    },
  }),
  runTest('bearish IFVG flip', {
    fixture: bearishIfvgFlipFixture,
    expected: {
      totalFVGs: 1,
      totalIFVGs: 1,
      ifvg: {
        direction: 'BEARISH',
        high: 102,
        low: 100,
        midpoint: 101,
        invalidated: false,
        filled: false,
        flipped: false,
      },
      sourceFVG: {
        direction: 'BULLISH',
        invalidated: true,
        filled: true,
        flipped: true,
      },
    },
  }),
  runTest('invalidated zone', {
    fixture: invalidatedZoneFixture,
    expected: {
      totalFVGs: 1,
      zone: {
        direction: 'BULLISH',
        invalidated: true,
        filled: true,
        flipped: true,
      },
    },
  }),
  runTest('filled zone', {
    fixture: filledZoneFixture,
    expected: {
      totalFVGs: 1,
      zone: {
        direction: 'BULLISH',
        invalidated: false,
        filled: true,
        flipped: false,
      },
    },
  }),
  testParentFvgConfidenceAttribution(),
];

for (const test of tests) {
  printResult(test);
}

const failed = tests.filter(test => !test.passed);
console.log('');
console.log(`ICT FVG/IFVG fixture tests: ${tests.length - failed.length}/${tests.length} passed`);

if (failed.length > 0) {
  process.exit(1);
}

function runTest(
  name: string,
  input: {
    fixture: { candles: Parameters<typeof detectFVGs>[0] };
    expected: unknown;
  },
): TestResult {
  const fvgs = detectFVGs(input.fixture.candles);
  const ifvgs = detectIFVGs(fvgs, input.fixture.candles);
  const actual = summarize(name, fvgs, ifvgs);
  const passed = stableJson(actual) === stableJson(input.expected);

  return {
    name,
    expected: input.expected,
    actual,
    passed,
  };
}

function summarize(
  name: string,
  fvgs: ReturnType<typeof detectFVGs>,
  ifvgs: ReturnType<typeof detectIFVGs>,
): unknown {
  const firstFVG = fvgs[0];
  const firstIFVG = ifvgs[0];

  switch (name) {
    case 'bullish FVG present':
    case 'bearish FVG present':
      return {
        totalFVGs: fvgs.length,
        bullishFVGs: fvgs.filter(zone => zone.direction === 'BULLISH').length,
        bearishFVGs: fvgs.filter(zone => zone.direction === 'BEARISH').length,
        zone: firstFVG ? zoneSummary(firstFVG) : null,
      };
    case 'no FVG':
      return {
        totalFVGs: fvgs.length,
        bullishFVGs: fvgs.filter(zone => zone.direction === 'BULLISH').length,
        bearishFVGs: fvgs.filter(zone => zone.direction === 'BEARISH').length,
      };
    case 'bullish IFVG flip':
    case 'bearish IFVG flip':
      return {
        totalFVGs: fvgs.length,
        totalIFVGs: ifvgs.length,
        ifvg: firstIFVG ? zoneSummary(firstIFVG) : null,
        sourceFVG: firstFVG ? {
          direction: firstFVG.direction,
          invalidated: firstFVG.invalidated,
          filled: firstFVG.filled,
          flipped: firstFVG.flipped,
        } : null,
      };
    case 'invalidated zone':
    case 'filled zone':
      return {
        totalFVGs: fvgs.length,
        zone: firstFVG ? {
          direction: firstFVG.direction,
          invalidated: firstFVG.invalidated,
          filled: firstFVG.filled,
          flipped: firstFVG.flipped,
        } : null,
      };
    default:
      throw new Error(`Unhandled test: ${name}`);
  }
}

function zoneSummary(zone: {
  direction: string;
  high: number;
  low: number;
  midpoint: number;
  invalidated: boolean;
  filled: boolean;
  flipped: boolean;
}): unknown {
  return {
    direction: zone.direction,
    high: zone.high,
    low: zone.low,
    midpoint: zone.midpoint,
    invalidated: zone.invalidated,
    filled: zone.filled,
    flipped: zone.flipped,
  };
}

function printResult(test: TestResult): void {
  console.log(`Test: ${test.name}`);
  console.log(`Expected: ${stableJson(test.expected)}`);
  console.log(`Actual:   ${stableJson(test.actual)}`);
  console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}`);
  console.log('');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function testParentFvgConfidenceAttribution(): TestResult {
  const candles = [
    c(0, 100, 101, 99, 100),
    c(1, 100, 105, 99.5, 104),
    c(2, 106, 112, 106, 111),
    c(3, 109, 109.5, 105, 108),
    c(4, 108, 109, 104, 105),
    c(5, 105, 105.5, 103, 104.5),
    c(6, 106.2, 108, 104.2, 107),
  ];
  const parent: FVGZone = {
    id: 'parent-bullish',
    type: 'FVG',
    direction: 'BULLISH',
    high: 110,
    low: 100,
    midpoint: 105,
    createdAt: candles[2].timestamp.toISOString(),
    invalidated: false,
    filled: true,
    flipped: false,
    candle1Index: 0,
    candle2Index: 1,
    candle3Index: 2,
  };
  const source: FVGZone = {
    id: 'source-bearish',
    type: 'FVG',
    direction: 'BEARISH',
    high: 106,
    low: 104,
    midpoint: 105,
    createdAt: candles[4].timestamp.toISOString(),
    invalidated: true,
    filled: true,
    flipped: true,
    candle1Index: 2,
    candle2Index: 3,
    candle3Index: 4,
  };
  const ifvg = detectIFVGs([parent, source], candles).find(zone => zone.sourceFvgId === source.id);
  const actual = {
    totalIFVGs: ifvg ? 1 : 0,
    parentFvgId: ifvg?.parentFvgId ?? null,
    parentFvgRespected: ifvg?.parentFvgRespected ?? false,
    confidenceOverride: ifvg?.confidenceOverride ?? null,
  };
  const expected = {
    totalIFVGs: 1,
    parentFvgId: parent.id,
    parentFvgRespected: true,
    confidenceOverride: 100,
  };
  return {
    name: 'IFVG inside respected parent FVG receives confidence attribution',
    expected,
    actual,
    passed: stableJson(actual) === stableJson(expected),
  };
}

function c(minute: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: new Date(Date.UTC(2026, 5, 1, 0, minute, 0)),
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

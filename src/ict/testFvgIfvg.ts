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

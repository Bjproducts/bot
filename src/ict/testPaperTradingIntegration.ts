import { createIctSignal } from './ictSignalEngine';
import { IctSignalResult } from './ictSignalTypes';
import { IctReactionResult } from './reactionTypes';
import { FVGZone, IFVGZone } from './types';

type PaperAction = 'ENTER_LONG' | 'ENTER_SHORT' | 'NO_ENTRY';

interface PaperIntegrationFixture {
  name: string;
  signal: IctSignalResult;
  expected: PaperAction;
}

const fixtures: PaperIntegrationFixture[] = [
  {
    name: 'ICT BUY signal maps to paper LONG entry',
    signal: createIctSignal({
      zone: fvgZone('paper-bullish-fvg', 'BULLISH'),
      reaction: reaction('paper-bullish-fvg', 'BUY', 90),
      options: { minConfidence: 75 },
    }),
    expected: 'ENTER_LONG',
  },
  {
    name: 'ICT SELL signal maps to paper SHORT entry',
    signal: createIctSignal({
      zone: ifvgZone('paper-bearish-ifvg', 'BEARISH'),
      reaction: reaction('paper-bearish-ifvg', 'SELL', 92),
      options: { minConfidence: 75 },
    }),
    expected: 'ENTER_SHORT',
  },
  {
    name: 'ICT NONE signal maps to no paper entry',
    signal: createIctSignal({
      zone: fvgZone('paper-none-fvg', 'BULLISH'),
      reaction: reaction('paper-none-fvg', 'BUY', 60),
      options: { minConfidence: 75 },
    }),
    expected: 'NO_ENTRY',
  },
];

const results = fixtures.map((fixture) => {
  const actual = paperActionForIctSignal(fixture.signal);
  return {
    name: fixture.name,
    expected: fixture.expected,
    actual,
    passed: actual === fixture.expected,
  };
});

for (const result of results) {
  console.log(`Test: ${result.name}`);
  console.log(`Expected: ${result.expected}`);
  console.log(`Actual:   ${result.actual}`);
  console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
  console.log('');
}

const failed = results.filter((result) => !result.passed);
console.log(`ICT paper integration dry-run tests: ${results.length - failed.length}/${results.length} passed`);

if (failed.length > 0) {
  process.exit(1);
}

function paperActionForIctSignal(signal: IctSignalResult): PaperAction {
  if (signal.signal === 'BUY') return 'ENTER_LONG';
  if (signal.signal === 'SELL') return 'ENTER_SHORT';
  return 'NO_ENTRY';
}

function fvgZone(id: string, direction: FVGZone['direction']): FVGZone {
  return {
    id,
    type: 'FVG',
    direction,
    high: 102,
    low: 100,
    midpoint: 101,
    createdAt: '2026-06-01T00:00:00.000Z',
    invalidated: false,
    filled: false,
    flipped: false,
    candle1Index: 0,
    candle2Index: 1,
    candle3Index: 2,
  };
}

function ifvgZone(id: string, direction: IFVGZone['direction']): IFVGZone {
  return {
    id,
    type: 'IFVG',
    direction,
    high: 102,
    low: 100,
    midpoint: 101,
    createdAt: '2026-06-01T00:03:00.000Z',
    invalidated: false,
    filled: false,
    flipped: false,
    sourceFvgId: 'paper-source-fvg',
    inversionCandleIndex: 3,
  };
}

function reaction(
  zoneId: string,
  output: IctReactionResult['output'],
  confidence: number,
): IctReactionResult {
  const winner: IctReactionResult['reactionWinner'] = output === 'BUY' || output === 'SELL' ? output : 'NONE';
  const direction: IctReactionResult['zoneDirection'] = output === 'SELL' ? 'BEARISH' : 'BULLISH';
  return {
    zoneId,
    zoneDirection: direction,
    reaction: output === 'BUY'
      ? 'BULLISH_REACTION'
      : output === 'SELL'
        ? 'BEARISH_REACTION'
        : 'NO_REACTION',
    output,
    confidence,
    currentPrice: 101,
    evaluatedAt: '2026-06-01T00:04:00.000Z',
    checks: {
      returnToZone: check(output !== 'NONE'),
      midpointInteraction: check(output !== 'NONE'),
      bodyCloseConfirmation: check(output !== 'NONE'),
      volumeConfirmation: {
        status: 'NOT_EVALUATED',
        passed: false,
        detail: 'Volume confirmation disabled',
      },
    },
    reasons: [`Fixture reaction ${output}`],
    reactionType: output === 'NONE' ? 'NONE' : 'BOUNDARY',
    midpointResult: output === 'NONE' ? 'NOT_EVALUATED' : direction,
    boundaryCloseResult: output === 'NONE' ? 'NOT_EVALUATED' : direction,
    displacementReaction: 'NONE',
    reactionWinner: winner,
    reactionScore: confidence,
  };
}

function check(passed: boolean): IctReactionResult['checks']['returnToZone'] {
  return {
    status: passed ? 'PASS' : 'FAIL',
    passed,
    detail: passed ? 'Fixture passed' : 'Fixture failed',
  };
}

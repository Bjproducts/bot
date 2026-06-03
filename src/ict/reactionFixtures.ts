import { Candle } from '../signals/types';
import { IctZoneBase } from './types';
import { IctReactionInput, IctReactionTier, IctReactionWinner } from './reactionTypes';

export interface ReactionFixtureExpected {
  output: 'BUY' | 'SELL' | 'NONE';
  reaction: 'BULLISH_REACTION' | 'BEARISH_REACTION' | 'NO_REACTION';
  reactionType: IctReactionTier;
  reactionWinner: IctReactionWinner;
  reactionScore: number;
  midpointResult: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NOT_EVALUATED';
  boundaryCloseResult: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NOT_EVALUATED';
  displacementReaction: 'BULLISH' | 'BEARISH' | 'NONE';
  returnToZone: boolean;
  midpointInteraction: boolean;
}

export interface ReactionFixture {
  name: string;
  input: IctReactionInput;
  expected: ReactionFixtureExpected;
}

const bullishZone = makeZone('fixture-bullish-zone', 'BULLISH');
const bearishZone = makeZone('fixture-bearish-zone', 'BEARISH');
const freshIfvgZone = makeZone('fixture-fresh-ifvg-zone', 'BULLISH');

// Three quiet prior candles establish an average range of ≈0.5 used to
// classify a much larger candle as a displacement.
const quietPrior: Candle[] = [
  candle(0, 100.0, 100.5, 99.8, 100.3),
  candle(1, 100.3, 100.6, 100.1, 100.4),
  candle(2, 100.4, 100.7, 100.2, 100.5),
];

export const reactionFixtures: ReactionFixture[] = [
  {
    name: '1. Bullish FVG touch only returns NONE',
    input: {
      zone: bullishZone,
      candles: [candle(0, 100.7, 100.9, 100.3, 100.6)],
      currentPrice: 100.6,
    },
    expected: {
      output: 'NONE',
      reaction: 'NO_REACTION',
      reactionType: 'TOUCH',
      reactionWinner: 'NONE',
      reactionScore: 20,
      midpointResult: 'NOT_EVALUATED',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: false,
    },
  },
  {
    name: '2. Bullish FVG close above midpoint returns weak BUY (score 45)',
    input: {
      zone: bullishZone,
      candles: [candle(0, 100.5, 101.8, 100.5, 101.5)],
      currentPrice: 101.5,
    },
    expected: {
      output: 'BUY',
      reaction: 'BULLISH_REACTION',
      reactionType: 'MIDPOINT',
      reactionWinner: 'BUY',
      reactionScore: 45,
      midpointResult: 'BULLISH',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '3. Bullish FVG close above FVG high returns BUY (score 75)',
    input: {
      zone: bullishZone,
      candles: [candle(0, 100.5, 102.5, 100.5, 102.3)],
      currentPrice: 102.3,
    },
    expected: {
      output: 'BUY',
      reaction: 'BULLISH_REACTION',
      reactionType: 'BOUNDARY',
      reactionWinner: 'BUY',
      reactionScore: 75,
      midpointResult: 'BULLISH',
      boundaryCloseResult: 'BULLISH',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '4. Bullish FVG displacement above FVG high returns strong BUY (score 100)',
    input: {
      zone: bullishZone,
      candles: [
        ...quietPrior,
        candle(3, 100.4, 103.0, 100.3, 102.8),
      ],
      currentPrice: 102.8,
    },
    expected: {
      output: 'BUY',
      reaction: 'BULLISH_REACTION',
      reactionType: 'DISPLACEMENT',
      reactionWinner: 'BUY',
      reactionScore: 100,
      midpointResult: 'BULLISH',
      boundaryCloseResult: 'BULLISH',
      displacementReaction: 'BULLISH',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '5. Bullish FVG close below midpoint returns SELL bias (bullish failure)',
    input: {
      zone: bullishZone,
      candles: [candle(0, 101.7, 101.9, 100.3, 100.5)],
      currentPrice: 100.5,
    },
    expected: {
      output: 'SELL',
      reaction: 'BEARISH_REACTION',
      reactionType: 'MIDPOINT',
      reactionWinner: 'SELL',
      reactionScore: 45,
      midpointResult: 'BEARISH',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '6. Bearish FVG touch only returns NONE',
    input: {
      zone: bearishZone,
      candles: [candle(0, 100.7, 100.9, 100.3, 100.6)],
      currentPrice: 100.6,
    },
    expected: {
      output: 'NONE',
      reaction: 'NO_REACTION',
      reactionType: 'TOUCH',
      reactionWinner: 'NONE',
      reactionScore: 20,
      midpointResult: 'NOT_EVALUATED',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: false,
    },
  },
  {
    name: '7. Bearish FVG close below midpoint returns weak SELL (score 45)',
    input: {
      zone: bearishZone,
      candles: [candle(0, 101.5, 101.8, 100.3, 100.5)],
      currentPrice: 100.5,
    },
    expected: {
      output: 'SELL',
      reaction: 'BEARISH_REACTION',
      reactionType: 'MIDPOINT',
      reactionWinner: 'SELL',
      reactionScore: 45,
      midpointResult: 'BEARISH',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '8. Bearish FVG close below FVG low returns SELL (score 75)',
    input: {
      zone: bearishZone,
      candles: [candle(0, 101.5, 101.8, 99.5, 99.7)],
      currentPrice: 99.7,
    },
    expected: {
      output: 'SELL',
      reaction: 'BEARISH_REACTION',
      reactionType: 'BOUNDARY',
      reactionWinner: 'SELL',
      reactionScore: 75,
      midpointResult: 'BEARISH',
      boundaryCloseResult: 'BEARISH',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '9. Bearish FVG displacement below FVG low returns strong SELL (score 100)',
    input: {
      zone: bearishZone,
      candles: [
        ...quietPrior,
        candle(3, 101.6, 101.7, 99.0, 99.2),
      ],
      currentPrice: 99.2,
    },
    expected: {
      output: 'SELL',
      reaction: 'BEARISH_REACTION',
      reactionType: 'DISPLACEMENT',
      reactionWinner: 'SELL',
      reactionScore: 100,
      midpointResult: 'BEARISH',
      boundaryCloseResult: 'BEARISH',
      displacementReaction: 'BEARISH',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '10. Bearish FVG close above midpoint returns BUY bias (bearish failure)',
    input: {
      zone: bearishZone,
      candles: [candle(0, 100.3, 101.8, 100.3, 101.5)],
      currentPrice: 101.5,
    },
    expected: {
      output: 'BUY',
      reaction: 'BULLISH_REACTION',
      reactionType: 'MIDPOINT',
      reactionWinner: 'BUY',
      reactionScore: 45,
      midpointResult: 'BULLISH',
      boundaryCloseResult: 'NEUTRAL',
      displacementReaction: 'NONE',
      returnToZone: true,
      midpointInteraction: true,
    },
  },
  {
    name: '11. Fresh IFVG-shaped zone with no candle interaction returns NONE (no auto-100)',
    input: {
      zone: freshIfvgZone,
      candles: [candle(0, 105, 105.5, 104.5, 105.2)],
      currentPrice: 105.2,
    },
    expected: {
      output: 'NONE',
      reaction: 'NO_REACTION',
      reactionType: 'NONE',
      reactionWinner: 'NONE',
      reactionScore: 0,
      midpointResult: 'NOT_EVALUATED',
      boundaryCloseResult: 'NOT_EVALUATED',
      displacementReaction: 'NONE',
      returnToZone: false,
      midpointInteraction: false,
    },
  },
];

function makeZone(id: string, direction: IctZoneBase['direction']): IctZoneBase {
  return {
    id,
    direction,
    high: 102,
    low: 100,
    midpoint: 101,
    createdAt: '2026-06-01T00:00:00.000Z',
    invalidated: false,
    filled: false,
    flipped: false,
  };
}

function candle(
  minute: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle {
  return {
    open,
    high,
    low,
    close,
    volume,
    timestamp: new Date(Date.UTC(2026, 5, 1, 0, minute, 0)),
  };
}

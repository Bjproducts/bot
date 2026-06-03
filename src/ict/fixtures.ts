import { Candle } from '../signals/types';

export interface IctFixture {
  name: string;
  candles: Candle[];
}

export const bullishFvgPresentFixture: IctFixture = {
  name: 'bullish FVG present',
  candles: [
    candle(0, 98, 100, 95, 99),
    candle(1, 100, 105, 99, 104),
    candle(2, 104, 106, 102, 105),
  ],
};

export const bearishFvgPresentFixture: IctFixture = {
  name: 'bearish FVG present',
  candles: [
    candle(0, 104, 105, 100, 101),
    candle(1, 100, 101, 95, 96),
    candle(2, 95, 98, 92, 93),
  ],
};

export const noFvgFixture: IctFixture = {
  name: 'no FVG',
  candles: [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 102, 98, 101),
    candle(2, 101, 101.5, 99.5, 100.5),
  ],
};

export const bullishIfvgFlipFixture: IctFixture = {
  name: 'bullish IFVG flip',
  candles: [
    candle(0, 104, 105, 100, 101),
    candle(1, 100, 101, 95, 96),
    candle(2, 95, 98, 92, 93),
    candle(3, 99, 107, 99, 106),
  ],
};

export const bearishIfvgFlipFixture: IctFixture = {
  name: 'bearish IFVG flip',
  candles: [
    candle(0, 98, 100, 95, 99),
    candle(1, 100, 105, 99, 104),
    candle(2, 104, 106, 102, 105),
    candle(3, 105, 106, 99, 99.5),
  ],
};

export const invalidatedZoneFixture: IctFixture = {
  name: 'invalidated zone',
  candles: [
    candle(0, 98, 100, 95, 99),
    candle(1, 100, 105, 99, 104),
    candle(2, 104, 106, 102, 105),
    candle(3, 105, 106, 98, 99),
  ],
};

export const filledZoneFixture: IctFixture = {
  name: 'filled zone',
  candles: [
    candle(0, 98, 100, 95, 99),
    candle(1, 100, 105, 99, 104),
    candle(2, 104, 106, 102, 105),
    candle(3, 105, 106, 99.5, 100.5),
  ],
};

export const ictFixtures: IctFixture[] = [
  bullishFvgPresentFixture,
  bearishFvgPresentFixture,
  noFvgFixture,
  bullishIfvgFlipFixture,
  bearishIfvgFlipFixture,
  invalidatedZoneFixture,
  filledZoneFixture,
];

function candle(
  minute: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return {
    open,
    high,
    low,
    close,
    volume: 1,
    timestamp: new Date(Date.UTC(2026, 5, 1, 0, minute, 0)),
  };
}

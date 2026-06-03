import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../signals/types';
import { DetectionResult, FVGZone } from './types';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
export const DETECTED_FVGS_PATH = path.join(LOGS_DIR, 'detected-fvgs.json');

export function detectBullishFVG(candles: readonly Candle[], index: number): FVGZone | null {
  const candle1 = candles[index - 2];
  const candle2 = candles[index - 1];
  const candle3 = candles[index];

  if (!candle1 || !candle2 || !candle3) return null;
  if (!isValidCandle(candle1) || !isValidCandle(candle2) || !isValidCandle(candle3)) return null;

  if (candle1.high < candle3.low) {
    const low = candle1.high;
    const high = candle3.low;
    return {
      id: makeFvgId('BULLISH', index - 2, index - 1, index, low, high),
      type: 'FVG',
      direction: 'BULLISH',
      high,
      low,
      midpoint: midpoint(low, high),
      createdAt: candle3.timestamp.toISOString(),
      invalidated: false,
      filled: false,
      flipped: false,
      candle1Index: index - 2,
      candle2Index: index - 1,
      candle3Index: index,
    };
  }

  return null;
}

export function detectBearishFVG(candles: readonly Candle[], index: number): FVGZone | null {
  const candle1 = candles[index - 2];
  const candle2 = candles[index - 1];
  const candle3 = candles[index];

  if (!candle1 || !candle2 || !candle3) return null;
  if (!isValidCandle(candle1) || !isValidCandle(candle2) || !isValidCandle(candle3)) return null;

  if (candle1.low > candle3.high) {
    const low = candle3.high;
    const high = candle1.low;
    return {
      id: makeFvgId('BEARISH', index - 2, index - 1, index, low, high),
      type: 'FVG',
      direction: 'BEARISH',
      high,
      low,
      midpoint: midpoint(low, high),
      createdAt: candle3.timestamp.toISOString(),
      invalidated: false,
      filled: false,
      flipped: false,
      candle1Index: index - 2,
      candle2Index: index - 1,
      candle3Index: index,
    };
  }

  return null;
}

export function detectFVGs(candles: readonly Candle[]): FVGZone[] {
  const zones: FVGZone[] = [];

  for (let index = 2; index < candles.length; index++) {
    const bullish = detectBullishFVG(candles, index);
    if (bullish) zones.push(updateFVGState(bullish, candles));

    const bearish = detectBearishFVG(candles, index);
    if (bearish) zones.push(updateFVGState(bearish, candles));
  }

  return zones;
}

export function detectAndStoreFVGs(candles: readonly Candle[]): DetectionResult<FVGZone> {
  const zones = detectFVGs(candles);
  saveDetectedFVGs(zones);
  return { zones, logPath: DETECTED_FVGS_PATH };
}

export function saveDetectedFVGs(zones: readonly FVGZone[]): void {
  ensureLogsDir();
  fs.writeFileSync(DETECTED_FVGS_PATH, JSON.stringify(zones, null, 2), 'utf-8');
}

export function loadDetectedFVGs(): FVGZone[] {
  try {
    const raw = fs.readFileSync(DETECTED_FVGS_PATH, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as FVGZone[]) : [];
  } catch {
    return [];
  }
}

function updateFVGState(zone: FVGZone, candles: readonly Candle[]): FVGZone {
  let filled = false;
  let invalidated = false;
  let flipped = false;

  for (let i = zone.candle3Index + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle || !isValidCandle(candle)) continue;

    if (zone.direction === 'BULLISH') {
      if (candle.low <= zone.low) filled = true;
      if (bodyClosedBelow(candle, zone.low)) {
        invalidated = true;
        flipped = true;
      }
    } else {
      if (candle.high >= zone.high) filled = true;
      if (bodyClosedAbove(candle, zone.high)) {
        invalidated = true;
        flipped = true;
      }
    }
  }

  return { ...zone, filled, invalidated, flipped };
}

function bodyClosedBelow(candle: Candle, level: number): boolean {
  return candle.open < level && candle.close < level;
}

function bodyClosedAbove(candle: Candle, level: number): boolean {
  return candle.open > level && candle.close > level;
}

function isValidCandle(candle: Candle): boolean {
  return Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.high >= candle.low
    && candle.timestamp instanceof Date
    && !Number.isNaN(candle.timestamp.getTime());
}

function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}

function makeFvgId(
  direction: FVGZone['direction'],
  candle1Index: number,
  candle2Index: number,
  candle3Index: number,
  low: number,
  high: number,
): string {
  return [
    'FVG',
    direction,
    candle1Index,
    candle2Index,
    candle3Index,
    low,
    high,
  ].join(':');
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

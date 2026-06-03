import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../signals/types';
import { DetectionResult, FVGZone, IFVGZone } from './types';

const LOGS_DIR = path.resolve(__dirname, '../../logs');
export const DETECTED_IFVGS_PATH = path.join(LOGS_DIR, 'detected-ifvgs.json');

export function detectBullishIFVG(
  existingFVG: FVGZone,
  candle: Candle,
  candleIndex: number,
): IFVGZone | null {
  if (existingFVG.direction !== 'BEARISH') return null;
  if (!isValidCandle(candle)) return null;

  if (candle.close > existingFVG.high) {
    return {
      id: makeIfvgId('BULLISH', existingFVG.id, candleIndex),
      type: 'IFVG',
      direction: 'BULLISH',
      sourceFvgId: existingFVG.id,
      inversionCandleIndex: candleIndex,
      high: existingFVG.high,
      low: existingFVG.low,
      midpoint: existingFVG.midpoint,
      createdAt: candle.timestamp.toISOString(),
      invalidated: false,
      filled: false,
      flipped: false,
    };
  }

  return null;
}

export function detectBearishIFVG(
  existingFVG: FVGZone,
  candle: Candle,
  candleIndex: number,
): IFVGZone | null {
  if (existingFVG.direction !== 'BULLISH') return null;
  if (!isValidCandle(candle)) return null;

  if (candle.close < existingFVG.low) {
    return {
      id: makeIfvgId('BEARISH', existingFVG.id, candleIndex),
      type: 'IFVG',
      direction: 'BEARISH',
      sourceFvgId: existingFVG.id,
      inversionCandleIndex: candleIndex,
      high: existingFVG.high,
      low: existingFVG.low,
      midpoint: existingFVG.midpoint,
      createdAt: candle.timestamp.toISOString(),
      invalidated: false,
      filled: false,
      flipped: false,
    };
  }

  return null;
}

export function detectIFVGs(fvgs: readonly FVGZone[], candles: readonly Candle[]): IFVGZone[] {
  const zones: IFVGZone[] = [];
  const seenSourceFvgs = new Set<string>();

  for (const fvg of fvgs) {
    if (seenSourceFvgs.has(fvg.id)) continue;

    for (let i = fvg.candle3Index + 1; i < candles.length; i++) {
      const candle = candles[i];
      if (!candle) continue;

      const ifvg = fvg.direction === 'BEARISH'
        ? detectBullishIFVG(fvg, candle, i)
        : detectBearishIFVG(fvg, candle, i);

      if (ifvg) {
        zones.push(updateIFVGState(ifvg, candles));
        seenSourceFvgs.add(fvg.id);
        break;
      }
    }
  }

  return zones;
}

export function detectAndStoreIFVGs(
  fvgs: readonly FVGZone[],
  candles: readonly Candle[],
): DetectionResult<IFVGZone> {
  const zones = detectIFVGs(fvgs, candles);
  saveDetectedIFVGs(zones);
  return { zones, logPath: DETECTED_IFVGS_PATH };
}

export function saveDetectedIFVGs(zones: readonly IFVGZone[]): void {
  ensureLogsDir();
  fs.writeFileSync(DETECTED_IFVGS_PATH, JSON.stringify(zones, null, 2), 'utf-8');
}

export function loadDetectedIFVGs(): IFVGZone[] {
  try {
    const raw = fs.readFileSync(DETECTED_IFVGS_PATH, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as IFVGZone[]) : [];
  } catch {
    return [];
  }
}

function updateIFVGState(zone: IFVGZone, candles: readonly Candle[]): IFVGZone {
  let filled = false;
  let invalidated = false;
  let flipped = false;

  for (let i = zone.inversionCandleIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle || !isValidCandle(candle)) continue;

    const tradesIntoZone = candle.low <= zone.high && candle.high >= zone.low;
    if (tradesIntoZone) filled = true;

    if (zone.direction === 'BULLISH' && candle.close < zone.low) {
      invalidated = true;
      flipped = true;
    }

    if (zone.direction === 'BEARISH' && candle.close > zone.high) {
      invalidated = true;
      flipped = true;
    }
  }

  return { ...zone, filled, invalidated, flipped };
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

function makeIfvgId(
  direction: IFVGZone['direction'],
  sourceFvgId: string,
  inversionCandleIndex: number,
): string {
  return ['IFVG', direction, sourceFvgId, inversionCandleIndex].join(':');
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

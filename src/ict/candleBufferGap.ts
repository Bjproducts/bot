import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../signals/types';
import { IctSignalZone } from './ictSignalTypes';
import { TradeSelectionResult } from './tradeCandidateTypes';

// Phase 5d: gap-detection threshold for 1-minute candles. A normal close→close
// delta is 60s; we tolerate 3 minutes (network hiccup, dashboard pause) before
// declaring the buffer stale.
export const DEFAULT_MAX_GAP_SECONDS = 180;
export const GAP_RESET_LOG_PATH = path.resolve(__dirname, '../../logs/gap-resets.log');

export interface GapDetectionResult {
  gapDetected: boolean;
  gapSeconds: number;
  thresholdSeconds: number;
  reason: string;
}

export function detectCandleGap(
  previousCandleTimestamp: Date | null | undefined,
  newCandleTimestamp: Date,
  maxGapSeconds: number = DEFAULT_MAX_GAP_SECONDS,
): GapDetectionResult {
  if (!previousCandleTimestamp) {
    return {
      gapDetected: false,
      gapSeconds: 0,
      thresholdSeconds: maxGapSeconds,
      reason: 'No previous candle — first candle in buffer',
    };
  }
  const deltaMs = newCandleTimestamp.getTime() - previousCandleTimestamp.getTime();
  const gapSeconds = Math.max(0, Math.round(deltaMs / 1000));
  const detected = gapSeconds > maxGapSeconds;
  return {
    gapDetected: detected,
    gapSeconds,
    thresholdSeconds: maxGapSeconds,
    reason: detected
      ? `Gap ${gapSeconds}s exceeds ${maxGapSeconds}s threshold`
      : `Gap ${gapSeconds}s within ${maxGapSeconds}s threshold`,
  };
}

export interface IctGapResetTargets {
  ictCandleBuffer: Candle[];
  latestIctZones: IctSignalZone[];
  latestTradeSelection: TradeSelectionResult | null;
}

export interface GapResetSummary {
  oldBufferSize: number;
  oldZoneCount: number;
  oldFvgCount: number;
  oldIfvgCount: number;
  oldCandidateCount: number;
}

/**
 * Phase 5d: clears every persistent ICT cache that could leak across a
 * candle-stream gap. Mutates the passed-in arrays in place so callers
 * (BotEngine) can share the same array references throughout the session.
 * Object fields (latestTradeSelection) are not mutated — the caller must
 * reassign them to null after invoking this.
 *
 * Returns counts taken BEFORE the clear, so the gap-reset event can
 * record what was discarded.
 */
export function clearIctStateForGap(state: IctGapResetTargets): GapResetSummary {
  const oldBufferSize = state.ictCandleBuffer.length;
  const oldZoneCount = state.latestIctZones.length;
  const oldFvgCount = state.latestIctZones.filter(z => z?.type === 'FVG').length;
  const oldIfvgCount = state.latestIctZones.filter(z => z?.type === 'IFVG').length;
  const oldCandidateCount = state.latestTradeSelection?.candidates?.length ?? 0;

  // In-place truncation preserves the bot's array references.
  state.ictCandleBuffer.length = 0;
  state.latestIctZones.length = 0;

  return { oldBufferSize, oldZoneCount, oldFvgCount, oldIfvgCount, oldCandidateCount };
}

export interface GapResetEvent {
  timestamp: string;
  symbol: string;
  gapSeconds: number;
  thresholdSeconds: number;
  reason: string;
  oldBufferSize: number;
  oldZoneCount: number;
  oldFvgCount: number;
  oldIfvgCount: number;
  oldCandidateCount: number;
}

export function appendGapResetEvent(event: GapResetEvent, logPath: string = GAP_RESET_LOG_PATH): void {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  !  gap-resets log write failed: ${msg}`);
  }
}

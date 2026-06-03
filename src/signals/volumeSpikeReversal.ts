import { Candle, Signal, SignalConfig, SignalDirection } from './types';

/**
 * Volume Spike Reversal — detects a potential bullish reversal after a drop.
 *
 * All three conditions must be true to emit BUY:
 *
 *   1. PRICE DROP    — window price fell >= reversalDropPercent from start
 *                      of the lookback window to the candle before current
 *   2. VOLUME SPIKE  — current candle volume >= volumeSpikeMultiplier × avg
 *                      volume of the lookback window
 *   3. REVERSAL BAR  — current candle closes above the previous candle's close
 *
 * @param candles  Chronological candle buffer (oldest first).
 *                 Needs at least `volumeLookback + 1` candles.
 * @param config   Signal parameters.
 */
export function evaluate(
  candles: readonly Candle[],
  config:  SignalConfig,
): Signal {
  const { volumeLookback, volumeSpikeMultiplier, reversalDropPercent } = config;

  // Need: lookback window + at least 1 previous candle + current candle
  const minRequired = volumeLookback + 1;

  if (candles.length < minRequired) {
    return noSignal(candles);
  }

  const current  = candles[candles.length - 1]!;
  const previous = candles[candles.length - 2]!;

  // The lookback window is the `volumeLookback` candles BEFORE the current one
  const window   = candles.slice(-(volumeLookback + 1), -1);  // length = volumeLookback

  // ── Condition 1: Price drop ────────────────────────────────────────────────
  // Measure drop from the oldest candle in the window to the newest (previous)
  const windowStart = window[0]!;
  const windowEnd   = window[window.length - 1]!;
  const priceDrop   = (windowEnd.close - windowStart.close) / windowStart.close;
  const dropCondition = priceDrop <= -(reversalDropPercent / 100);

  // ── Condition 2: Volume spike ──────────────────────────────────────────────
  const avgVolume  = window.reduce((sum, c) => sum + c.volume, 0) / window.length;
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : 0;
  const spikeCondition = volumeRatio >= volumeSpikeMultiplier;

  // ── Condition 3: Reversal bar (close above previous close) ────────────────
  const closedAbovePrev  = current.close > previous.close;
  const reversalCondition = closedAbovePrev;

  // ── Decision ───────────────────────────────────────────────────────────────
  const direction: SignalDirection =
    dropCondition && spikeCondition && reversalCondition ? 'BUY' : 'NONE';

  return {
    direction,
    price:     current.close,
    volume:    current.volume,
    timestamp: current.timestamp,
    priceDrop,
    volumeRatio,
    closedAbovePrev,
    dropCondition,
    spikeCondition,
    reversalCondition,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function noSignal(candles: readonly Candle[]): Signal {
  const last = candles[candles.length - 1];
  return {
    direction:        'NONE',
    price:            last?.close ?? 0,
    volume:           last?.volume ?? 0,
    timestamp:        last?.timestamp ?? new Date(),
    priceDrop:        0,
    volumeRatio:      0,
    closedAbovePrev:  false,
    dropCondition:    false,
    spikeCondition:   false,
    reversalCondition: false,
  };
}

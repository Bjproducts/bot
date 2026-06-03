import { Candle } from './signals/types';

/**
 * Scenarios — deterministic candle sequences for backtesting signal logic.
 *
 * Each scenario is designed to test exactly one outcome:
 *
 *   BULLISH_REVERSAL   → all 3 conditions met  → should emit BUY
 *   FLAT_MARKET        → no drop               → should emit NONE
 *   SPIKE_NO_DROP      → spike but no drop     → should emit NONE
 *   DROP_NO_CLOSE      → drop + spike but no reversal bar → should emit NONE
 */

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeCandle(
  close:     number,
  prevClose: number,
  volume:    number,
  minutesAgo: number = 0,
): Candle {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  return {
    open:      prevClose,
    high:      Math.max(prevClose, close) * 1.0005,
    low:       Math.min(prevClose, close) * 0.9995,
    close,
    volume,
    timestamp: ts,
  };
}

/**
 * Build a gradual price path from `startPrice` by `totalDropPct` over `steps` candles.
 * Each candle has `normalVolume`.  Returns candles oldest-first.
 */
function buildDropSequence(
  startPrice:    number,
  totalDropPct:  number,   // e.g. 0.02 = 2% total drop
  steps:         number,
  normalVolume:  number,
): Candle[] {
  const perStepMultiplier = Math.pow(1 - totalDropPct, 1 / steps);
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = steps; i >= 1; i--) {
    const prevPrice = price / perStepMultiplier;
    candles.push(makeCandle(price, prevPrice, normalVolume, i));
    price = prevPrice;
  }

  // Reverse so oldest is first
  candles.reverse();
  return candles;
}

// ─── Scenario 1: Bullish Reversal ─────────────────────────────────────────────
// Price drops 2% over 20 candles, then a volume-spike candle closes above prev.
// Expected: BUY

export const BULLISH_REVERSAL: Candle[] = (() => {
  const START  = 65_000;
  const NORM_V = 500;

  // 20 candles of 2% total drop
  const drop = buildDropSequence(START * 0.98, 0.02, 20, NORM_V);

  // Previous candle (last of the drop)
  const prevClose = drop[drop.length - 1]!.close;

  // Current candle: closes ABOVE previous, volume = 3.2× average (1,600 vs 500)
  const spikeCandle = makeCandle(prevClose * 1.004, prevClose, NORM_V * 3.2, 0);

  return [...drop, spikeCandle];
})();

// ─── Scenario 2: Flat Market ──────────────────────────────────────────────────
// Price stays within ±0.3%.  No DCA drop condition met.
// Expected: NONE

export const FLAT_MARKET: Candle[] = (() => {
  const START  = 65_000;
  const NORM_V = 500;
  const candles: Candle[] = [];
  let price = START;

  for (let i = 21; i >= 0; i--) {
    // Tiny ±0.15% moves
    const noise    = 1 + (Math.random() * 0.003 - 0.0015);
    const newPrice = price * noise;
    candles.push(makeCandle(newPrice, price, NORM_V, i));
    price = newPrice;
  }
  return candles;
})();

// ─── Scenario 3: Volume Spike — No Sufficient Price Drop ─────────────────────
// Price only drops 0.3% (below the 1% threshold).
// Volume spikes but drop condition is not met.
// Expected: NONE

export const SPIKE_NO_DROP: Candle[] = (() => {
  const START  = 65_000;
  const NORM_V = 500;

  // Tiny 0.3% drop over 20 candles
  const drop = buildDropSequence(START * 0.997, 0.003, 20, NORM_V);
  const prevClose = drop[drop.length - 1]!.close;

  // Volume spike: 3.2× — but drop condition not met
  const spikeCandle = makeCandle(prevClose * 1.004, prevClose, NORM_V * 3.2, 0);
  return [...drop, spikeCandle];
})();

// ─── Scenario 4: Drop + Volume Spike — No Reversal Bar ───────────────────────
// Price drops 2%, volume spikes, but current candle closes BELOW previous.
// The reversal bar condition (close > prevClose) is not met.
// Expected: NONE

export const DROP_NO_CLOSE_ABOVE: Candle[] = (() => {
  const START  = 65_000;
  const NORM_V = 500;

  const drop = buildDropSequence(START * 0.98, 0.02, 20, NORM_V);
  const prevClose = drop[drop.length - 1]!.close;

  // Closes BELOW previous — NOT a reversal bar
  const failCandle = makeCandle(prevClose * 0.998, prevClose, NORM_V * 3.2, 0);
  return [...drop, failCandle];
})();

// ─── Scenario registry ────────────────────────────────────────────────────────

export interface ScenarioEntry {
  name:            string;
  candles:         Candle[];
  expectedSignal:  'BUY' | 'NONE';
  description:     string;
}

export const ALL_SCENARIOS: ScenarioEntry[] = [
  {
    name:           'BULLISH_REVERSAL',
    candles:        BULLISH_REVERSAL,
    expectedSignal: 'BUY',
    description:    '2% drop over 20 candles + 3.2× volume spike + closes above prev',
  },
  {
    name:           'FLAT_MARKET',
    candles:        FLAT_MARKET,
    expectedSignal: 'NONE',
    description:    'Price within ±0.3% — no drop condition met',
  },
  {
    name:           'SPIKE_NO_DROP',
    candles:        SPIKE_NO_DROP,
    expectedSignal: 'NONE',
    description:    'Volume spike 3.2× but price only dropped 0.3% (threshold: 1%)',
  },
  {
    name:           'DROP_NO_CLOSE_ABOVE',
    candles:        DROP_NO_CLOSE_ABOVE,
    expectedSignal: 'NONE',
    description:    '2% drop + volume spike but reversal bar closes BELOW previous',
  },
];

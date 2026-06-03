// ─── Candle ───────────────────────────────────────────────────────────────────

export interface Candle {
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  timestamp: Date;
}

// ─── Signal output ────────────────────────────────────────────────────────────

export type SignalDirection = 'BUY' | 'NONE';

export interface Signal {
  direction:       SignalDirection;
  price:           number;
  volume:          number;
  timestamp:       Date;

  // Condition breakdown — useful for dashboard + backtester output
  priceDrop:       number;   // fraction: negative means drop  e.g. -0.02 = -2%
  volumeRatio:     number;   // currentVol / avgVol  e.g. 3.2
  closedAbovePrev: boolean;  // current close > previous close

  // Which conditions passed
  dropCondition:   boolean;
  spikeCondition:  boolean;
  reversalCondition: boolean;
}

// ─── Config subset consumed by the signal engine ─────────────────────────────

export interface SignalConfig {
  volumeLookback:        number;   // candles to look back for avg vol and drop
  volumeSpikeMultiplier: number;   // e.g. 2 = 2× avg vol required
  reversalDropPercent:   number;   // e.g. 1 = 1% drop required
}

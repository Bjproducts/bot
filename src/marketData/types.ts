import { Candle } from '../signals/types';

/**
 * IMarketDataSource — contract every data source must satisfy.
 *
 * Simulator:    nextCandle() always returns a synthetic candle.
 * REAL_PUBLIC:  nextCandle() returns a new candle only when a new
 *               1-minute candle has closed on the exchange.
 *               Returns null on ticks where no new candle is available.
 *               currentPrice() always returns the last known price.
 */
export interface IMarketDataSource {
  /**
   * Advance one tick.
   * - Non-null  → new candle data; add to signal buffer, run signal.
   * - null      → no new candle yet; still use currentPrice() for
   *               unrealized PnL and TP/DCA checks on open positions.
   */
  nextCandle(): Promise<Candle | null>;

  /** Optional startup history preload. Sources without history can omit it. */
  startupCandles?(): Promise<Candle[]>;

  /** Last known close price. Always valid after first candle. */
  currentPrice(): number;

  /** Human-readable source name shown in the dashboard. */
  readonly sourceName: string;

  /** Symbol being tracked (e.g. 'BTC'). */
  readonly symbol: string;
}

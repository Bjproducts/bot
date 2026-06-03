import { Candle }            from '../signals/types';
import { IMarketDataSource } from './types';
import { BotConfig }         from '../types';

/**
 * RealPublicSource — fetches 1-minute OHLCV candles from Binance's
 * free public REST API. No API key required.
 *
 * Endpoint:
 *   GET https://api.binance.com/api/v3/klines
 *       ?symbol=BTCUSDT&interval=1m&limit=2
 *
 * Behaviour:
 *   · Returns a new Candle only when a new 1-minute candle has closed
 *     (detected by comparing open timestamps).
 *   · Returns null on ticks where we've already seen the latest candle.
 *   · On any network or parse error, logs the error and returns null
 *     so the bot keeps running without trading on bad data.
 *   · currentPrice() always returns the last successfully fetched close.
 */
export class RealPublicSource implements IMarketDataSource {
  readonly sourceName = 'REAL_PUBLIC (Binance)';
  readonly symbol:     string;

  private lastCandleOpenTime: number = 0;
  private lastPrice:          number;

  private readonly binanceSymbol: string;

  constructor(config: BotConfig) {
    this.symbol      = config.symbol;
    this.lastPrice   = config.startPrice;   // fallback until first fetch
    this.binanceSymbol = RealPublicSource.toBinanceSymbol(config.symbol);
  }

  // ─── IMarketDataSource ────────────────────────────────────────────────────

  async nextCandle(): Promise<Candle | null> {
    try {
      const candle = await this.fetchLatestClosedCandle();

      // Only return candle if it's newer than what we've already seen
      if (candle.timestamp.getTime() <= this.lastCandleOpenTime) {
        return null;
      }

      this.lastCandleOpenTime = candle.timestamp.getTime();
      this.lastPrice          = candle.close;
      return candle;

    } catch (err) {
      // Log the error but do NOT crash the bot — return null so no trade fires
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ⚠  [${ts()}] REAL_PUBLIC fetch failed: ${msg} — skipping tick`);
      return null;
    }
  }

  currentPrice(): number {
    return this.lastPrice;
  }

  // ─── Binance fetch ────────────────────────────────────────────────────────

  private async fetchLatestClosedCandle(): Promise<Candle> {
    const url = `https://api.binance.com/api/v3/klines` +
                `?symbol=${this.binanceSymbol}&interval=1m&limit=2`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),   // 8-second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BinanceKline[];

    if (!Array.isArray(data) || data.length < 2) {
      throw new Error(`Unexpected response shape from Binance`);
    }

    // data[0] = candle that closed 1 minute ago (always closed)
    // data[1] = current open candle (still open — skip it)
    const raw         = data[0]!;
    const openTimeMs  = raw[0];
    const closeTimeMs = raw[6];
    const nowMs       = Date.now();

    // Sanity check: candle should be closed
    if (closeTimeMs >= nowMs) {
      // The "closed" candle is somehow still open — fall back to data[0] anyway
      // This can happen in the first 1ms of a minute; treat as valid.
    }

    return {
      open:      parseFloat(raw[1]),
      high:      parseFloat(raw[2]),
      low:       parseFloat(raw[3]),
      close:     parseFloat(raw[4]),
      volume:    parseFloat(raw[5]),
      timestamp: new Date(openTimeMs),
    };
  }

  // ─── Symbol mapping ───────────────────────────────────────────────────────

  private static toBinanceSymbol(symbol: string): string {
    const map: Record<string, string> = {
      BTC: 'BTCUSDT',
      ETH: 'ETHUSDT',
      SOL: 'SOLUSDT',
      BNB: 'BNBUSDT',
      XRP: 'XRPUSDT',
      ADA: 'ADAUSDT',
    };
    const result = map[symbol.toUpperCase()];
    if (result === undefined) {
      throw new Error(
        `REAL_PUBLIC mode: symbol "${symbol}" is not mapped to a Binance pair. ` +
        `Supported: ${Object.keys(map).join(', ')}. ` +
        `Add it to RealPublicSource.toBinanceSymbol() or use MARKET_DATA_SOURCE=SIMULATOR.`,
      );
    }
    return result;
  }
}

// ─── Binance kline tuple type ─────────────────────────────────────────────────
// [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

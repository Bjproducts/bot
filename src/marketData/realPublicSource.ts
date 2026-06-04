import { Candle }            from '../signals/types';
import { IMarketDataSource } from './types';
import { BotConfig }         from '../types';
import { DEFAULT_REAL_PUBLIC_HOST, normalizeRealPublicHost } from '../config';

/**
 * RealPublicSource — fetches 1-minute OHLCV candles from a Binance-compatible
 * public REST endpoint. No API key required.
 *
 * Endpoint host is configurable via `BotConfig.realPublicHost` (env
 * `REAL_PUBLIC_HOST`), defaulting to `https://api.binance.com`. The Binance
 * read-only mirror `https://data-api.binance.vision` is also supported and
 * useful when the main API gateway is blocked by region (HTTP 451).
 *
 * Endpoint path:
 *   GET <host>/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2
 *
 * Behaviour (unchanged from the api.binance.com-only implementation):
 *   · Returns a new Candle only when a new 1-minute candle has closed
 *     (detected by comparing open timestamps).
 *   · Returns null on ticks where we've already seen the latest candle.
 *   · On any network or parse error, logs the error and returns null
 *     so the bot keeps running without trading on bad data.
 *   · currentPrice() always returns the last successfully fetched close.
 */
export class RealPublicSource implements IMarketDataSource {
  readonly sourceName: string;
  readonly symbol:     string;
  readonly host:       string;

  private lastCandleOpenTime: number = 0;
  private lastPrice:          number;

  private readonly binanceSymbol: string;
  private readonly startupCandleLimit: number;

  constructor(config: BotConfig) {
    this.symbol      = config.symbol;
    this.lastPrice   = config.startPrice;   // fallback until first fetch
    this.binanceSymbol = RealPublicSource.toBinanceSymbol(config.symbol);
    this.host        = normalizeRealPublicHost(config.realPublicHost);
    this.startupCandleLimit = config.startupCandleLimit;
    this.sourceName  = `REAL_PUBLIC (${displayHost(this.host)})`;
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

  async startupCandles(): Promise<Candle[]> {
    const candles = await this.fetchClosedCandles(this.startupCandleLimit);
    const latest = candles[candles.length - 1] ?? null;
    if (latest) {
      this.lastCandleOpenTime = latest.timestamp.getTime();
      this.lastPrice = latest.close;
    }
    return candles;
  }

  // ─── Binance fetch ────────────────────────────────────────────────────────

  private async fetchLatestClosedCandle(): Promise<Candle> {
    const url = buildKlineUrl(this.host, this.binanceSymbol, 2);

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

  private async fetchClosedCandles(limit: number): Promise<Candle[]> {
    const safeLimit = Math.max(2, Math.min(1000, Math.floor(limit)));
    const url = buildKlineUrl(this.host, this.binanceSymbol, safeLimit + 1);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BinanceKline[];
    if (!Array.isArray(data) || data.length < 2) {
      throw new Error(`Unexpected response shape from Binance`);
    }

    return data
      .slice(0, -1)
      .slice(-safeLimit)
      .map(raw => ({
        open: parseFloat(raw[1]),
        high: parseFloat(raw[2]),
        low: parseFloat(raw[3]),
        close: parseFloat(raw[4]),
        volume: parseFloat(raw[5]),
        timestamp: new Date(raw[0]),
      }));
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

/**
 * Pure URL builder so tests can verify host + symbol composition without
 * invoking fetch. Trailing slashes on `host` are tolerated (the config loader
 * already strips them; this is defence in depth).
 */
export function buildKlineUrl(host: string, binanceSymbol: string, limit: number = 2): string {
  const normalized = (host ?? DEFAULT_REAL_PUBLIC_HOST).replace(/\/+$/, '');
  const base = normalized.length > 0 ? normalized : DEFAULT_REAL_PUBLIC_HOST;
  return `${base}/api/v3/klines?symbol=${binanceSymbol}&interval=1m&limit=${limit}`;
}

function displayHost(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
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

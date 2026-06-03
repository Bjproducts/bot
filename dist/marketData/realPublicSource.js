"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealPublicSource = void 0;
exports.buildKlineUrl = buildKlineUrl;
const config_1 = require("../config");
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
class RealPublicSource {
    sourceName;
    symbol;
    host;
    lastCandleOpenTime = 0;
    lastPrice;
    binanceSymbol;
    constructor(config) {
        this.symbol = config.symbol;
        this.lastPrice = config.startPrice; // fallback until first fetch
        this.binanceSymbol = RealPublicSource.toBinanceSymbol(config.symbol);
        this.host = (0, config_1.normalizeRealPublicHost)(config.realPublicHost);
        this.sourceName = `REAL_PUBLIC (${displayHost(this.host)})`;
    }
    // ─── IMarketDataSource ────────────────────────────────────────────────────
    async nextCandle() {
        try {
            const candle = await this.fetchLatestClosedCandle();
            // Only return candle if it's newer than what we've already seen
            if (candle.timestamp.getTime() <= this.lastCandleOpenTime) {
                return null;
            }
            this.lastCandleOpenTime = candle.timestamp.getTime();
            this.lastPrice = candle.close;
            return candle;
        }
        catch (err) {
            // Log the error but do NOT crash the bot — return null so no trade fires
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ⚠  [${ts()}] REAL_PUBLIC fetch failed: ${msg} — skipping tick`);
            return null;
        }
    }
    currentPrice() {
        return this.lastPrice;
    }
    // ─── Binance fetch ────────────────────────────────────────────────────────
    async fetchLatestClosedCandle() {
        const url = buildKlineUrl(this.host, this.binanceSymbol, 2);
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8_000), // 8-second timeout
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!Array.isArray(data) || data.length < 2) {
            throw new Error(`Unexpected response shape from Binance`);
        }
        // data[0] = candle that closed 1 minute ago (always closed)
        // data[1] = current open candle (still open — skip it)
        const raw = data[0];
        const openTimeMs = raw[0];
        const closeTimeMs = raw[6];
        const nowMs = Date.now();
        // Sanity check: candle should be closed
        if (closeTimeMs >= nowMs) {
            // The "closed" candle is somehow still open — fall back to data[0] anyway
            // This can happen in the first 1ms of a minute; treat as valid.
        }
        return {
            open: parseFloat(raw[1]),
            high: parseFloat(raw[2]),
            low: parseFloat(raw[3]),
            close: parseFloat(raw[4]),
            volume: parseFloat(raw[5]),
            timestamp: new Date(openTimeMs),
        };
    }
    // ─── Symbol mapping ───────────────────────────────────────────────────────
    static toBinanceSymbol(symbol) {
        const map = {
            BTC: 'BTCUSDT',
            ETH: 'ETHUSDT',
            SOL: 'SOLUSDT',
            BNB: 'BNBUSDT',
            XRP: 'XRPUSDT',
            ADA: 'ADAUSDT',
        };
        const result = map[symbol.toUpperCase()];
        if (result === undefined) {
            throw new Error(`REAL_PUBLIC mode: symbol "${symbol}" is not mapped to a Binance pair. ` +
                `Supported: ${Object.keys(map).join(', ')}. ` +
                `Add it to RealPublicSource.toBinanceSymbol() or use MARKET_DATA_SOURCE=SIMULATOR.`);
        }
        return result;
    }
}
exports.RealPublicSource = RealPublicSource;
/**
 * Pure URL builder so tests can verify host + symbol composition without
 * invoking fetch. Trailing slashes on `host` are tolerated (the config loader
 * already strips them; this is defence in depth).
 */
function buildKlineUrl(host, binanceSymbol, limit = 2) {
    const normalized = (host ?? config_1.DEFAULT_REAL_PUBLIC_HOST).replace(/\/+$/, '');
    const base = normalized.length > 0 ? normalized : config_1.DEFAULT_REAL_PUBLIC_HOST;
    return `${base}/api/v3/klines?symbol=${binanceSymbol}&interval=1m&limit=${limit}`;
}
function displayHost(host) {
    try {
        return new URL(host).host;
    }
    catch {
        return host;
    }
}
function ts() {
    return new Date().toTimeString().slice(0, 8);
}

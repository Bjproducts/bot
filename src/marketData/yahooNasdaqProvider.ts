import { Candle } from '../signals/types';
import { PublicMarketDataProvider } from './publicProviderTypes';

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuote[];
  };
}

interface YahooQuote {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

export class YahooNasdaqProvider implements PublicMarketDataProvider {
  readonly providerName = 'Yahoo Finance';
  readonly supportedSymbols = ['QQQ', 'NDX', 'NQ'] as const;

  async fetchLatestClosedCandle(symbol: string): Promise<Candle> {
    const yahooSymbol = this.toYahooSymbol(symbol);
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
      '?interval=1m&range=1d';

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps = result?.timestamp;

    if (payload.chart?.error) {
      throw new Error(payload.chart.error.description ?? payload.chart.error.code ?? 'Yahoo chart error');
    }

    if (!result || !quote || !timestamps || timestamps.length === 0) {
      throw new Error('Unexpected response shape from Yahoo Finance');
    }

    const candle = latestCompleteCandle(timestamps, quote);
    if (!candle) {
      throw new Error('No complete 1-minute candle returned by Yahoo Finance');
    }

    return candle;
  }

  private toYahooSymbol(symbol: string): string {
    const map: Record<string, string> = {
      QQQ: 'QQQ',
      NDX: '^NDX',
      NQ: 'NQ=F',
    };
    const normalized = symbol.toUpperCase();
    const yahooSymbol = map[normalized];
    if (!yahooSymbol) {
      throw new Error(
        `NASDAQ_PUBLIC mode: symbol "${symbol}" is not supported by the Yahoo provider. ` +
        `Supported: ${Object.keys(map).join(', ')}.`,
      );
    }
    return yahooSymbol;
  }
}

function latestCompleteCandle(timestamps: number[], quote: YahooQuote): Candle | null {
  const open = quote.open ?? [];
  const high = quote.high ?? [];
  const low = quote.low ?? [];
  const close = quote.close ?? [];
  const volume = quote.volume ?? [];
  const nowMs = Date.now();

  for (let index = timestamps.length - 1; index >= 0; index--) {
    const timestampMs = timestamps[index] * 1000;
    if (timestampMs + 60_000 > nowMs) continue;

    const candle = {
      open: open[index],
      high: high[index],
      low: low[index],
      close: close[index],
      volume: volume[index] ?? 0,
      timestamp: new Date(timestampMs),
    };

    if (
      isFiniteNumber(candle.open)
      && isFiniteNumber(candle.high)
      && isFiniteNumber(candle.low)
      && isFiniteNumber(candle.close)
      && candle.high >= candle.low
      && !Number.isNaN(candle.timestamp.getTime())
    ) {
      return {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: isFiniteNumber(candle.volume) ? candle.volume : 0,
        timestamp: candle.timestamp,
      };
    }
  }

  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

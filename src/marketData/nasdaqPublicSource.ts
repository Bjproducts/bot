import { BotConfig } from '../types';
import { Candle } from '../signals/types';
import { IMarketDataSource } from './types';
import { PublicMarketDataProvider } from './publicProviderTypes';
import { YahooNasdaqProvider } from './yahooNasdaqProvider';

export class NasdaqPublicSource implements IMarketDataSource {
  readonly sourceName = 'NASDAQ_PUBLIC';
  readonly symbol: string;

  private lastCandleOpenTime: number = 0;
  private lastPrice: number;

  constructor(
    config: BotConfig,
    private readonly provider: PublicMarketDataProvider = new YahooNasdaqProvider(),
  ) {
    this.symbol = config.symbol;
    this.lastPrice = config.startPrice;
    this.ensureSupportedSymbol(config.symbol);
  }

  async nextCandle(): Promise<Candle | null> {
    try {
      const candle = await this.provider.fetchLatestClosedCandle(this.symbol);

      if (candle.timestamp.getTime() <= this.lastCandleOpenTime) {
        this.lastPrice = candle.close;
        return null;
      }

      this.lastCandleOpenTime = candle.timestamp.getTime();
      this.lastPrice = candle.close;
      return candle;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  !  [${ts()}] NASDAQ_PUBLIC fetch failed: ${msg} - skipping tick`);
      return null;
    }
  }

  currentPrice(): number {
    return this.lastPrice;
  }

  private ensureSupportedSymbol(symbol: string): void {
    const supported = this.provider.supportedSymbols.map(value => value.toUpperCase());
    if (!supported.includes(symbol.toUpperCase())) {
      throw new Error(
        `NASDAQ_PUBLIC mode: symbol "${symbol}" is not supported by ${this.provider.providerName}. ` +
        `Supported: ${supported.join(', ')}.`,
      );
    }
  }
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

import { Candle } from '../signals/types';

export interface PublicMarketDataProvider {
  readonly providerName: string;
  readonly supportedSymbols: readonly string[];
  fetchLatestClosedCandle(symbol: string): Promise<Candle>;
}

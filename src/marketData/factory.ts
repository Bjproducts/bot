import { BotConfig }          from '../types';
import { IMarketDataSource }  from './types';
import { SimulatorSource }    from './simulatorSource';
import { RealPublicSource }   from './realPublicSource';
import { NasdaqPublicSource } from './nasdaqPublicSource';

/**
 * createMarketDataSource — returns the correct data source based on config.
 *
 * SIMULATOR    → synthetic GBM price + volume feed (default, always works)
 * REAL_PUBLIC  → live Binance 1-minute candles via public REST API
 */
export function createMarketDataSource(config: BotConfig): IMarketDataSource {
  switch (config.marketDataSource) {
    case 'NASDAQ_PUBLIC':
      return new NasdaqPublicSource(config);
    case 'REAL_PUBLIC':
      return new RealPublicSource(config);
    case 'SIMULATOR':
    default:
      return new SimulatorSource(config);
  }
}

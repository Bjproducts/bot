import { Candle }            from '../signals/types';
import { IMarketDataSource } from './types';
import { PriceSimulator }    from '../priceSimulator';
import { BotConfig }         from '../types';

/**
 * SimulatorSource — wraps PriceSimulator behind IMarketDataSource.
 *
 * Always returns a new synthetic candle every tick (never null).
 * Behaviour is identical to the original simulator.
 */
export class SimulatorSource implements IMarketDataSource {
  readonly sourceName = 'SIMULATOR';
  readonly symbol:     string;

  private readonly sim: PriceSimulator;

  constructor(config: BotConfig) {
    this.symbol = config.symbol;
    this.sim    = new PriceSimulator(
      config.startPrice,
      config.priceVolatility,
      config.priceDrift,
      config.tickIntervalMs,
      config.baseVolume,
    );
  }

  async nextCandle(): Promise<Candle | null> {
    return this.sim.nextCandle();   // always a new synthetic candle
  }

  currentPrice(): number {
    return this.sim.currentPrice();
  }
}

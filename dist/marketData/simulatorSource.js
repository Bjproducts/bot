"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatorSource = void 0;
const priceSimulator_1 = require("../priceSimulator");
/**
 * SimulatorSource — wraps PriceSimulator behind IMarketDataSource.
 *
 * Always returns a new synthetic candle every tick (never null).
 * Behaviour is identical to the original simulator.
 */
class SimulatorSource {
    sourceName = 'SIMULATOR';
    symbol;
    sim;
    constructor(config) {
        this.symbol = config.symbol;
        this.sim = new priceSimulator_1.PriceSimulator(config.startPrice, config.priceVolatility, config.priceDrift, config.tickIntervalMs, config.baseVolume);
    }
    async nextCandle() {
        return this.sim.nextCandle(); // always a new synthetic candle
    }
    currentPrice() {
        return this.sim.currentPrice();
    }
}
exports.SimulatorSource = SimulatorSource;

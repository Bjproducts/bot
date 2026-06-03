"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMarketDataSource = createMarketDataSource;
const simulatorSource_1 = require("./simulatorSource");
const realPublicSource_1 = require("./realPublicSource");
const nasdaqPublicSource_1 = require("./nasdaqPublicSource");
/**
 * createMarketDataSource — returns the correct data source based on config.
 *
 * SIMULATOR    → synthetic GBM price + volume feed (default, always works)
 * REAL_PUBLIC  → live Binance 1-minute candles via public REST API
 */
function createMarketDataSource(config) {
    switch (config.marketDataSource) {
        case 'NASDAQ_PUBLIC':
            return new nasdaqPublicSource_1.NasdaqPublicSource(config);
        case 'REAL_PUBLIC':
            return new realPublicSource_1.RealPublicSource(config);
        case 'SIMULATOR':
        default:
            return new simulatorSource_1.SimulatorSource(config);
    }
}

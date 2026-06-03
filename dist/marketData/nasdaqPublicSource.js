"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NasdaqPublicSource = void 0;
const yahooNasdaqProvider_1 = require("./yahooNasdaqProvider");
class NasdaqPublicSource {
    provider;
    sourceName = 'NASDAQ_PUBLIC';
    symbol;
    lastCandleOpenTime = 0;
    lastPrice;
    constructor(config, provider = new yahooNasdaqProvider_1.YahooNasdaqProvider()) {
        this.provider = provider;
        this.symbol = config.symbol;
        this.lastPrice = config.startPrice;
        this.ensureSupportedSymbol(config.symbol);
    }
    async nextCandle() {
        try {
            const candle = await this.provider.fetchLatestClosedCandle(this.symbol);
            if (candle.timestamp.getTime() <= this.lastCandleOpenTime) {
                this.lastPrice = candle.close;
                return null;
            }
            this.lastCandleOpenTime = candle.timestamp.getTime();
            this.lastPrice = candle.close;
            return candle;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  !  [${ts()}] NASDAQ_PUBLIC fetch failed: ${msg} - skipping tick`);
            return null;
        }
    }
    currentPrice() {
        return this.lastPrice;
    }
    ensureSupportedSymbol(symbol) {
        const supported = this.provider.supportedSymbols.map(value => value.toUpperCase());
        if (!supported.includes(symbol.toUpperCase())) {
            throw new Error(`NASDAQ_PUBLIC mode: symbol "${symbol}" is not supported by ${this.provider.providerName}. ` +
                `Supported: ${supported.join(', ')}.`);
        }
    }
}
exports.NasdaqPublicSource = NasdaqPublicSource;
function ts() {
    return new Date().toTimeString().slice(0, 8);
}

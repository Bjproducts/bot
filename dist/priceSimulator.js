"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceSimulator = void 0;
/**
 * PriceSimulator — Geometric Brownian Motion price + volume feed.
 *
 * Generates realistic OHLCV candles with:
 *   · GBM price process (log-normal returns)
 *   · Occasional fat-tail vol spikes (~2% of ticks)
 *   · Momentum bursts (brief trending periods)
 *   · Volume correlated with price move magnitude
 *   · Independent volume spikes (~4% of ticks) — these will naturally
 *     trigger the Volume Spike Reversal signal when they coincide with
 *     a prior price drop and a reversal bar.
 */
class PriceSimulator {
    price;
    prevPrice;
    vol;
    drift;
    baseVolume;
    momentumTicks = 0;
    momentumDirection = 0;
    constructor(startPrice, annualisedVol, annualisedDrift, tickIntervalMs, baseVolume = 800) {
        this.price = startPrice;
        this.prevPrice = startPrice;
        this.baseVolume = baseVolume;
        const ticksPerYear = (1 / tickIntervalMs) * 1_000 * 60 * 60 * 24 * 365;
        const dt = 1 / ticksPerYear;
        this.vol = annualisedVol * Math.sqrt(dt);
        this.drift = annualisedDrift * dt;
    }
    /**
     * Advance one tick and return a full OHLCV candle.
     * High/low add a small random wick around open/close.
     */
    nextCandle() {
        const open = this.price;
        // ── Price step ─────────────────────────────────────────────────────────
        const z = this.sampleNormal();
        const volMultiplier = Math.random() < 0.02 ? 3.0 : 1.0;
        if (this.momentumTicks <= 0 && Math.random() < 0.012) {
            this.momentumTicks = Math.floor(Math.random() * 25) + 10;
            this.momentumDirection = Math.random() < 0.5 ? 1 : -1;
        }
        const momentumBias = this.momentumTicks > 0
            ? this.momentumDirection * this.vol * 0.4
            : 0;
        if (this.momentumTicks > 0)
            this.momentumTicks--;
        const logReturn = this.drift + (this.vol * volMultiplier * z) + momentumBias;
        const close = open * Math.exp(logReturn);
        // ── Wicks ──────────────────────────────────────────────────────────────
        const wickFactor = 1 + Math.random() * this.vol * 0.5;
        const high = Math.max(open, close) * wickFactor;
        const low = Math.min(open, close) / wickFactor;
        // ── Volume ─────────────────────────────────────────────────────────────
        //   Base noise + amplified by price move magnitude + occasional spike
        const baseNoise = 0.4 + Math.random() * 1.2;
        const returnAmplifier = 1 + Math.abs(logReturn) * 200;
        const independentSpike = Math.random() < 0.04 ? (2 + Math.random() * 4) : 1;
        const volume = Math.round(this.baseVolume * baseNoise * returnAmplifier * independentSpike);
        this.prevPrice = this.price;
        this.price = close;
        return {
            open,
            high,
            low,
            close,
            volume,
            timestamp: new Date(),
        };
    }
    /** Backward-compat: just return the next close price. */
    next() {
        return this.nextCandle().close;
    }
    currentPrice() {
        return this.price;
    }
    sampleNormal() {
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
    }
}
exports.PriceSimulator = PriceSimulator;

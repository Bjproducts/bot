"use strict";
/**
 * Backtester — synchronous simulation over a historical candle array.
 *
 * Feeds candles into the Volume Spike Reversal signal one at a time,
 * simulates position management (entry, DCA, take-profit), and returns
 * a full BacktestResult with per-trade detail.
 *
 * Simulation-only. No wallet. No SDK. No live orders.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BACKTEST_CONFIG = void 0;
exports.runBacktest = runBacktest;
exports.runScenarios = runScenarios;
const volumeSpikeReversal_1 = require("./signals/volumeSpikeReversal");
const scenarios_1 = require("./scenarios");
// ─── Default config ───────────────────────────────────────────────────────────
exports.DEFAULT_BACKTEST_CONFIG = {
    volumeLookback: 20,
    volumeSpikeMultiplier: 2,
    reversalDropPercent: 1,
    side: 'LONG',
    orderSizeUsd: 100,
    maxCapUsd: 500,
    takeProfitPct: 0.006,
    dcaTriggerPct: 0.015,
};
// ─── Engine ───────────────────────────────────────────────────────────────────
function runBacktest(candles, config = exports.DEFAULT_BACKTEST_CONFIG) {
    const trades = [];
    let signalsFired = 0;
    // Position state (in-memory only)
    let inPosition = false;
    let entryTick = 0;
    let entryPrice = 0;
    let avgEntry = 0;
    let positionSize = 0; // token units
    let totalInvested = 0;
    let lastDcaPrice = 0;
    let dcaCount = 0;
    // Drawdown tracking
    let equity = 0;
    let peakEquity = 0;
    let maxDrawdown = 0;
    for (let i = 0; i < candles.length; i++) {
        const window = candles.slice(0, i + 1);
        const signal = (0, volumeSpikeReversal_1.evaluate)(window, config);
        if (!inPosition) {
            // Only enter on BUY signal
            if (signal.direction === 'BUY') {
                signalsFired++;
                const price = candles[i].close;
                const fillAmt = config.orderSizeUsd / price;
                inPosition = true;
                entryTick = i;
                entryPrice = price;
                avgEntry = price;
                positionSize = fillAmt;
                totalInvested = config.orderSizeUsd;
                lastDcaPrice = price;
                dcaCount = 0;
            }
        }
        else {
            const price = candles[i].close;
            // ── Take profit ──────────────────────────────────────────────────────
            const tpPrice = config.side === 'LONG'
                ? avgEntry * (1 + config.takeProfitPct)
                : avgEntry * (1 - config.takeProfitPct);
            const tpHit = config.side === 'LONG' ? price >= tpPrice : price <= tpPrice;
            if (tpHit) {
                const pnlUsd = config.side === 'LONG'
                    ? positionSize * (price - avgEntry)
                    : positionSize * (avgEntry - price);
                trades.push({
                    entryTick,
                    exitTick: i,
                    entryPrice,
                    exitPrice: price,
                    dcaCount,
                    pnlUsd,
                    pnlPct: (pnlUsd / totalInvested) * 100,
                    reason: 'TAKE_PROFIT',
                });
                equity += pnlUsd;
                peakEquity = Math.max(peakEquity, equity);
                maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
                // Reset position
                inPosition = false;
                continue;
            }
            // ── DCA ───────────────────────────────────────────────────────────────
            const nextDca = config.side === 'LONG'
                ? lastDcaPrice * (1 - config.dcaTriggerPct)
                : lastDcaPrice * (1 + config.dcaTriggerPct);
            const dcaTriggered = config.side === 'LONG' ? price <= nextDca : price >= nextDca;
            const canDca = totalInvested + config.orderSizeUsd <= config.maxCapUsd;
            if (dcaTriggered && canDca) {
                const fillAmt = config.orderSizeUsd / price;
                const newSize = positionSize + fillAmt;
                avgEntry = (avgEntry * positionSize + price * fillAmt) / newSize;
                positionSize = newSize;
                totalInvested += config.orderSizeUsd;
                lastDcaPrice = price;
                dcaCount++;
            }
        }
    }
    // ── Force-close any open position at last candle ─────────────────────────
    if (inPosition && candles.length > 0) {
        const price = candles[candles.length - 1].close;
        const pnlUsd = config.side === 'LONG'
            ? positionSize * (price - avgEntry)
            : positionSize * (avgEntry - price);
        trades.push({
            entryTick,
            exitTick: candles.length - 1,
            entryPrice,
            exitPrice: price,
            dcaCount,
            pnlUsd,
            pnlPct: (pnlUsd / totalInvested) * 100,
            reason: 'END_OF_DATA',
        });
        equity += pnlUsd;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
    }
    const wins = trades.filter(t => t.pnlUsd > 0).length;
    return {
        totalCandles: candles.length,
        signalsFired,
        totalTrades: trades.length,
        wins,
        losses: trades.length - wins,
        winRate: trades.length > 0 ? wins / trades.length : 0,
        totalPnlUsd: trades.reduce((s, t) => s + t.pnlUsd, 0),
        avgPnlUsd: trades.length > 0
            ? trades.reduce((s, t) => s + t.pnlUsd, 0) / trades.length
            : 0,
        maxDrawdownUsd: maxDrawdown,
        trades,
    };
}
// ─── Scenario runner ──────────────────────────────────────────────────────────
function runScenarios(config = exports.DEFAULT_BACKTEST_CONFIG) {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║         VOLUME SPIKE REVERSAL — SCENARIO TESTS           ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log(`  Config: lookback=${config.volumeLookback}  spike=${config.volumeSpikeMultiplier}×` +
        `  drop=${config.reversalDropPercent}%  TP=${(config.takeProfitPct * 100).toFixed(2)}%`);
    console.log('');
    let passed = 0;
    let failed = 0;
    for (const scenario of scenarios_1.ALL_SCENARIOS) {
        runScenario(scenario, config) ? passed++ : failed++;
    }
    console.log('');
    console.log(`  ─────────────────────────────────────────────────────────`);
    console.log(`  Results: ${passed} passed  ${failed} failed`);
    if (failed === 0) {
        console.log('  ✅ All signal scenarios passed.');
    }
    else {
        console.log('  ❌ Some scenarios failed — review signal logic.');
    }
    console.log('');
}
function runScenario(scenario, config) {
    // Evaluate signal on the last candle of the scenario
    const signal = (0, volumeSpikeReversal_1.evaluate)(scenario.candles, config);
    const result = runBacktest(scenario.candles, config);
    const pass = signal.direction === scenario.expectedSignal;
    const icon = pass ? '✅' : '❌';
    console.log(`  ${icon} ${scenario.name}`);
    console.log(`     ${scenario.description}`);
    console.log(`     Signal: ${signal.direction.padEnd(5)}  ` +
        `drop=${(signal.priceDrop * 100).toFixed(2)}%  ` +
        `vol=${signal.volumeRatio.toFixed(1)}×  ` +
        `closedAbove=${signal.closedAbovePrev}`);
    console.log(`     Expected: ${scenario.expectedSignal}  ` +
        `Got: ${signal.direction}  ` +
        `Trades: ${result.totalTrades}  ` +
        `PnL: ${result.totalPnlUsd >= 0 ? '+' : ''}$${result.totalPnlUsd.toFixed(2)}`);
    if (!pass) {
        console.log(`     ↳ FAILED — conditions: ` +
            `drop=${signal.dropCondition}  spike=${signal.spikeCondition}  reversal=${signal.reversalCondition}`);
    }
    console.log('');
    return pass;
}

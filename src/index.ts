import { loadConfig } from './config';
import { createMarketDataSource } from './marketData/factory';
import { BotEngine } from './bot';
import { TradeJournal } from './journal/tradeJournal';
import { printDashboard, saveSessionStats } from './sessionStats';
import { LIVE_ARM_CONFIRMATION } from './execution/exchangeTypes';

const config = loadConfig();

const dataSource = createMarketDataSource(config);
const journal = new TradeJournal();
const engine = new BotEngine(config, dataSource, journal);

const DASHBOARD_INTERVAL_MS = 30_000;

console.log('');
console.log('  +------------------------------------------------+');
console.log(`  |        NADO TRADING BOT - ${config.botMode.toUpperCase().padEnd(11)} |`);
console.log('  +------------------------------------------------+');
console.log(`  Bot Mode    : ${config.botMode}`);
console.log(`  Data source : ${dataSource.sourceName}`);
console.log(`  Symbol      : ${config.symbol}`);
console.log(`  Side        : ${config.side}`);
console.log(`  Signal Source: ${config.signalSource}`);
console.log(`  Entry size  : $${config.orderSizeUsd} x max ${Math.floor(config.maxCapUsd / config.orderSizeUsd)} levels`);
console.log(`  Take profit : ${(config.takeProfitPct * 100).toFixed(2)}%`);
console.log(`  DCA step    : ${(config.dcaTriggerPct * 100).toFixed(2)}% adverse move`);
console.log(`  Signal      : ${signalDescription()}`);
console.log(`  Tick rate   : every ${config.tickIntervalMs}ms`);
console.log('  Dashboard   : every 30s');
console.log('  Journal     : logs/trades.csv + events.log + completed-trades.json');
console.log(`  Live trading: ${config.liveTradingEnabled ? 'ENABLED' : 'disabled'}`);
console.log(`  Exchange    : ${config.exchangeName || 'NONE'}`);
console.log(`  Live armed  : ${isLiveArmed() ? 'YES' : 'NO'}`);
console.log(`  Live journal: logs/live-orders.csv + live-orders.json`);

if (config.botMode === 'live') {
  console.log('');
  console.log('  LIVE mode selected. Real order submission remains blocked unless every');
  console.log('  live execution safety gate passes. API secrets are never printed.');
}

if (config.marketDataSource === 'REAL_PUBLIC') {
  console.log('');
  console.log('  REAL_PUBLIC: candles arrive about once per minute.');
  console.log('  No API key, wallet, private key, or exchange order path is used.');
}

if (config.marketDataSource === 'NASDAQ_PUBLIC') {
  console.log('');
  console.log('  NASDAQ_PUBLIC: candles arrive from a read-only public market data provider.');
  console.log('  No broker, wallet, private key, or order execution path is used.');
}

console.log('');
console.log('  Events print instantly. Dashboard every 30s. Ctrl+C to stop.');
console.log('');

engine.start();

const dashboardTimer = setInterval(() => {
  const { stats, position, price, signal, ictSignal } = engine.snapshot();
  printDashboard(stats, position, price, config, signal, ictSignal);
  saveSessionStats(stats);
}, DASHBOARD_INTERVAL_MS);

setTimeout(() => {
  const { stats, position, price, signal, ictSignal } = engine.snapshot();
  printDashboard(stats, position, price, config, signal, ictSignal);
}, 3_000);

function shutdown(): void {
  clearInterval(dashboardTimer);
  engine.stop();
  const { stats, position, price, signal, ictSignal } = engine.snapshot();
  printDashboard(stats, position, price, config, signal, ictSignal);
  saveSessionStats(stats);
  console.log('');
  console.log('  Session stats saved -> session-stats.json');
  console.log('  Position state saved -> position-state.json');
  console.log('');
  process.exit(0);
}

function signalDescription(): string {
  if (config.signalSource === 'ICT') {
    return `ICT minConfidence=${config.ictMinConfidence}`;
  }

  if (config.signalSource === 'NONE') {
    return 'NONE - no new paper entries from signals';
  }

  return `drop>=${config.reversalDropPercent}%  vol>=${config.volumeSpikeMultiplier}x  lookback=${config.volumeLookback}`;
}

function isLiveArmed(): boolean {
  return !config.requireManualArm || config.liveArmConfirm === LIVE_ARM_CONFIRMATION;
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('\n  Uncaught error:', err.message);
  shutdown();
});

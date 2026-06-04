import * as dotenv from 'dotenv';
import * as path from 'path';
import { BotConfig, BotMode, ExitTargetMode, MarketDataSourceName, PositionSizingMode, SignalSource } from './types';

const DEFAULT_SIGNAL_SOURCE: SignalSource = 'VOLUME_SPIKE';
export const DEFAULT_MAX_POSITION_MINUTES = 5;

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export function loadConfig(): BotConfig {
  function envFloat(key: string, fallback: number): number {
    const v = parseFloat(process.env[key] ?? '');
    return isNaN(v) ? fallback : v;
  }

  function envInt(key: string, fallback: number): number {
    const v = parseInt(process.env[key] ?? '', 10);
    return isNaN(v) ? fallback : v;
  }

  function envBool(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined || raw.trim().length === 0) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`${key} must be "true" or "false", got "${raw}"`);
  }

  const rawMode = (process.env['BOT_MODE'] ?? 'simulation').toLowerCase();
  if (rawMode !== 'simulation' && rawMode !== 'paper_live' && rawMode !== 'live') {
    throw new Error(
      `BOT_MODE must be "simulation", "paper_live", or "live", got "${rawMode}"`,
    );
  }

  const side = (process.env['TRADE_SIDE'] ?? 'LONG').toUpperCase();
  if (side !== 'LONG' && side !== 'SHORT') {
    throw new Error(`TRADE_SIDE must be "LONG" or "SHORT", got "${side}"`);
  }

  const symbol = (process.env['SYMBOL'] ?? 'BTC').toUpperCase();
  const liveSymbol = (process.env['LIVE_SYMBOL'] ?? symbol).toUpperCase();

  const signalSourceFromEnv = process.env['SIGNAL_SOURCE'];
  const rawSignalSource = (signalSourceFromEnv?.trim() || DEFAULT_SIGNAL_SOURCE).toUpperCase();
  if (!signalSourceFromEnv || signalSourceFromEnv.trim().length === 0) {
    console.warn(
      `WARNING: SIGNAL_SOURCE is not set in .env. Defaulting to ${DEFAULT_SIGNAL_SOURCE}.`,
    );
  }
  if (
    rawSignalSource !== 'VOLUME_SPIKE'
    && rawSignalSource !== 'ICT'
    && rawSignalSource !== 'NONE'
  ) {
    throw new Error(
      `SIGNAL_SOURCE must be "VOLUME_SPIKE", "ICT", or "NONE", got "${rawSignalSource}"`,
    );
  }

  const rawSource = (process.env['MARKET_DATA_SOURCE'] ?? 'SIMULATOR').toUpperCase();
  if (rawSource !== 'SIMULATOR' && rawSource !== 'REAL_PUBLIC' && rawSource !== 'NASDAQ_PUBLIC') {
    throw new Error(
      `MARKET_DATA_SOURCE must be "SIMULATOR", "REAL_PUBLIC", or "NASDAQ_PUBLIC", got "${rawSource}"`,
    );
  }
  const tradingViewSymbol = (
    process.env['TRADINGVIEW_SYMBOL']
    ?? defaultTradingViewSymbol(symbol, rawSource)
  ).toUpperCase();

  const defaultPrices: Record<string, number> = {
    BTC: 65_000,
    ETH: 3_500,
    SOL: 165,
    QQQ: 450,
    NDX: 18_000,
    NQ: 18_000,
  };
  const defaultVolume: Record<string, number> = {
    BTC: 800,
    ETH: 5_000,
    SOL: 50_000,
    QQQ: 1_000_000,
    NDX: 0,
    NQ: 10_000,
  };

  return {
    botMode: rawMode as BotMode,
    signalSource: rawSignalSource as SignalSource,
    marketDataSource: rawSource as MarketDataSourceName,
    realPublicHost: normalizeRealPublicHost(process.env['REAL_PUBLIC_HOST']),
    symbol,
    side: side as 'LONG' | 'SHORT',

    orderSizeUsd: envFloat('ORDER_SIZE_USD', 100),
    maxCapUsd: envFloat('MAX_CAP_USD', 500),
    takeProfitPct: envFloat('TAKE_PROFIT_PCT', 0.006),
    dcaTriggerPct: envFloat('DCA_TRIGGER_PCT', 0.015),
    profitTargetUsdMin: envFloat('PROFIT_TARGET_USD_MIN', 0.50),
    profitTargetUsdMax: envFloat('PROFIT_TARGET_USD_MAX', 1.00),
    maxPositionMinutes: envFloat('MAX_POSITION_MINUTES', DEFAULT_MAX_POSITION_MINUTES),
    maxLossUsd: envFloat('MAX_LOSS_USD', 1.00),
    allowMultiplePositions: envBool('ALLOW_MULTIPLE_POSITIONS', true),
    maxConcurrentPositions: envInt('MAX_CONCURRENT_POSITIONS', 3),
    targetProfitMinUsd: envFloat('TARGET_PROFIT_MIN_USD', 0.50),
    targetProfitMaxUsd: envFloat('TARGET_PROFIT_MAX_USD', 1.00),
    maxRiskPerTradeUsd: envFloat('MAX_RISK_PER_TRADE_USD', 1.00),
    minPositionUsd: envFloat('MIN_POSITION_USD', 25),
    maxPositionUsd: envFloat('MAX_POSITION_USD', 500),
    positionSizingMode: envPositionSizingMode('POSITION_SIZING_MODE', 'PROFIT_FIRST'),
    hardStopEnabled: envBool('HARD_STOP_ENABLED', false),
    debugIctPipeline: envBool('DEBUG_ICT_PIPELINE', false),
    breakevenTriggerProfitUsd: envFloat('BREAKEVEN_TRIGGER_PROFIT_USD', 0.80),
    partialCloseEnabled: envBool('PARTIAL_CLOSE_ENABLED', true),
    partialCloseTriggerProfitUsd: envFloat('PARTIAL_CLOSE_TRIGGER_PROFIT_USD', 1.30),
    partialCloseLockProfitUsd: envFloat('PARTIAL_CLOSE_LOCK_PROFIT_USD', 1.00),
    startupCandleLimit: envInt('STARTUP_CANDLE_LIMIT', 500),

    exitTargetMode: envExitTargetMode('EXIT_TARGET_MODE', 'HYBRID'),
    targetRMultiple: envFloat('TARGET_R_MULTIPLE', 1.5),
    minRiskRewardRatio: envFloat('MIN_RISK_REWARD_RATIO', 1.5),
    maxTargetDistancePercent: envFloat('MAX_TARGET_DISTANCE_PERCENT', 0),

    volumeLookback: envInt('VOLUME_LOOKBACK', 20),
    volumeSpikeMultiplier: envFloat('VOLUME_SPIKE_MULTIPLIER', 2),
    reversalDropPercent: envFloat('REVERSAL_DROP_PERCENT', 1),
    ictMinConfidence: envFloat('ICT_MIN_CONFIDENCE', 75),
    ictTradeOnIfvgFormation: envBool('ICT_TRADE_ON_IFVG_FORMATION', true),
    ictTargetSwingLeft: envInt('ICT_TARGET_SWING_LEFT', 3),
    ictTargetSwingRight: envInt('ICT_TARGET_SWING_RIGHT', 3),
    ictTargetFallbackLookback: envInt('ICT_TARGET_FALLBACK_LOOKBACK', 50),
    tradingViewSymbol,

    liveTradingEnabled: envBool('LIVE_TRADING_ENABLED', false),
    exchangeName: process.env['EXCHANGE_NAME'] ?? '',
    exchangeApiKey: process.env['EXCHANGE_API_KEY'] ?? '',
    exchangeApiSecret: process.env['EXCHANGE_API_SECRET'] ?? '',
    exchangeApiPassphrase: process.env['EXCHANGE_API_PASSPHRASE'] ?? '',
    liveSymbol,
    liveOrderSizeUsd: envFloat('LIVE_ORDER_SIZE_USD', 10),
    maxLiveOrderSizeUsd: envFloat('MAX_LIVE_ORDER_SIZE_USD', 10),
    maxDailyLossUsd: envFloat('MAX_DAILY_LOSS_USD', 5),
    maxDailyTrades: envInt('MAX_DAILY_TRADES', 5),
    allowShorts: envBool('ALLOW_SHORTS', false),
    requireManualArm: envBool('REQUIRE_MANUAL_ARM', true),
    liveArmConfirm: process.env['LIVE_ARM_CONFIRM'] ?? '',

    startPrice: envFloat('START_PRICE', defaultPrices[symbol] ?? 65_000),
    tickIntervalMs: envInt('TICK_INTERVAL_MS', 2_000),
    priceVolatility: envFloat('PRICE_VOLATILITY', 0.80),
    priceDrift: envFloat('PRICE_DRIFT', 0.00),
    baseVolume: envFloat('BASE_VOLUME', defaultVolume[symbol] ?? 800),

    startingCapital: envFloat('STARTING_CAPITAL', 10_000),
  };
}

function envPositionSizingMode(key: string, fallback: PositionSizingMode): PositionSizingMode {
  const raw = (process.env[key] ?? '').trim().toUpperCase();
  if (raw === '') return fallback;
  if (raw === 'PROFIT_FIRST' || raw === 'RISK_FIRST') return raw;
  throw new Error(`${key} must be "PROFIT_FIRST" or "RISK_FIRST", got "${raw}"`);
}

export const DEFAULT_REAL_PUBLIC_HOST = 'https://api.binance.com';

export function normalizeRealPublicHost(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_REAL_PUBLIC_HOST;
  // Strip a trailing slash so the adapter can append `/api/v3/...` cleanly.
  return trimmed.replace(/\/+$/, '');
}

function envExitTargetMode(key: string, fallback: ExitTargetMode): ExitTargetMode {
  const raw = (process.env[key] ?? '').trim().toUpperCase();
  if (raw === '') return fallback;
  if (raw === 'STRUCTURE' || raw === 'SCALP' || raw === 'HYBRID') return raw;
  throw new Error(`${key} must be "STRUCTURE", "SCALP", or "HYBRID", got "${raw}"`);
}

function defaultTradingViewSymbol(symbol: string, source: string): string {
  const upperSymbol = symbol.toUpperCase();
  if (source === 'REAL_PUBLIC') {
    const map: Record<string, string> = {
      BTC: 'BINANCE:BTCUSDT',
      ETH: 'BINANCE:ETHUSDT',
      SOL: 'BINANCE:SOLUSDT',
      BNB: 'BINANCE:BNBUSDT',
      XRP: 'BINANCE:XRPUSDT',
      ADA: 'BINANCE:ADAUSDT',
    };
    return map[upperSymbol] ?? upperSymbol;
  }

  if (source === 'NASDAQ_PUBLIC') {
    const map: Record<string, string> = {
      QQQ: 'NASDAQ:QQQ',
      NDX: 'TVC:NDX',
      NQ: 'CME_MINI:NQ1!',
    };
    return map[upperSymbol] ?? upperSymbol;
  }

  return upperSymbol;
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REAL_PUBLIC_HOST = exports.DEFAULT_MAX_POSITION_MINUTES = void 0;
exports.loadConfig = loadConfig;
exports.normalizeRealPublicHost = normalizeRealPublicHost;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const DEFAULT_SIGNAL_SOURCE = 'VOLUME_SPIKE';
exports.DEFAULT_MAX_POSITION_MINUTES = 5;
dotenv.config({ path: path.resolve(__dirname, '../.env') });
function loadConfig() {
    function envFloat(key, fallback) {
        const v = parseFloat(process.env[key] ?? '');
        return isNaN(v) ? fallback : v;
    }
    function envInt(key, fallback) {
        const v = parseInt(process.env[key] ?? '', 10);
        return isNaN(v) ? fallback : v;
    }
    function envBool(key, fallback) {
        const raw = process.env[key];
        if (raw === undefined || raw.trim().length === 0)
            return fallback;
        const normalized = raw.trim().toLowerCase();
        if (normalized === 'true')
            return true;
        if (normalized === 'false')
            return false;
        throw new Error(`${key} must be "true" or "false", got "${raw}"`);
    }
    const rawMode = (process.env['BOT_MODE'] ?? 'simulation').toLowerCase();
    if (rawMode !== 'simulation' && rawMode !== 'paper_live' && rawMode !== 'live') {
        throw new Error(`BOT_MODE must be "simulation", "paper_live", or "live", got "${rawMode}"`);
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
        console.warn(`WARNING: SIGNAL_SOURCE is not set in .env. Defaulting to ${DEFAULT_SIGNAL_SOURCE}.`);
    }
    if (rawSignalSource !== 'VOLUME_SPIKE'
        && rawSignalSource !== 'ICT'
        && rawSignalSource !== 'NONE') {
        throw new Error(`SIGNAL_SOURCE must be "VOLUME_SPIKE", "ICT", or "NONE", got "${rawSignalSource}"`);
    }
    const rawSource = (process.env['MARKET_DATA_SOURCE'] ?? 'SIMULATOR').toUpperCase();
    if (rawSource !== 'SIMULATOR' && rawSource !== 'REAL_PUBLIC' && rawSource !== 'NASDAQ_PUBLIC') {
        throw new Error(`MARKET_DATA_SOURCE must be "SIMULATOR", "REAL_PUBLIC", or "NASDAQ_PUBLIC", got "${rawSource}"`);
    }
    const tradingViewSymbol = (process.env['TRADINGVIEW_SYMBOL']
        ?? defaultTradingViewSymbol(symbol, rawSource)).toUpperCase();
    const defaultPrices = {
        BTC: 65_000,
        ETH: 3_500,
        SOL: 165,
        QQQ: 450,
        NDX: 18_000,
        NQ: 18_000,
    };
    const defaultVolume = {
        BTC: 800,
        ETH: 5_000,
        SOL: 50_000,
        QQQ: 1_000_000,
        NDX: 0,
        NQ: 10_000,
    };
    return {
        botMode: rawMode,
        signalSource: rawSignalSource,
        marketDataSource: rawSource,
        realPublicHost: normalizeRealPublicHost(process.env['REAL_PUBLIC_HOST']),
        symbol,
        side: side,
        orderSizeUsd: envFloat('ORDER_SIZE_USD', 100),
        maxCapUsd: envFloat('MAX_CAP_USD', 500),
        takeProfitPct: envFloat('TAKE_PROFIT_PCT', 0.006),
        dcaTriggerPct: envFloat('DCA_TRIGGER_PCT', 0.015),
        profitTargetUsdMin: envFloat('PROFIT_TARGET_USD_MIN', 0.50),
        profitTargetUsdMax: envFloat('PROFIT_TARGET_USD_MAX', 1.00),
        maxPositionMinutes: envFloat('MAX_POSITION_MINUTES', exports.DEFAULT_MAX_POSITION_MINUTES),
        maxLossUsd: envFloat('MAX_LOSS_USD', 1.00),
        allowMultiplePositions: envBool('ALLOW_MULTIPLE_POSITIONS', true),
        maxConcurrentPositions: envInt('MAX_CONCURRENT_POSITIONS', 3),
        targetProfitMinUsd: envFloat('TARGET_PROFIT_MIN_USD', 0.50),
        targetProfitMaxUsd: envFloat('TARGET_PROFIT_MAX_USD', 1.00),
        maxRiskPerTradeUsd: envFloat('MAX_RISK_PER_TRADE_USD', 0.50),
        minPositionUsd: envFloat('MIN_POSITION_USD', 25),
        maxPositionUsd: envFloat('MAX_POSITION_USD', 500),
        positionSizingMode: envPositionSizingMode('POSITION_SIZING_MODE', 'PROFIT_FIRST'),
        hardStopEnabled: envBool('HARD_STOP_ENABLED', false),
        debugIctPipeline: envBool('DEBUG_ICT_PIPELINE', false),
        stopModel: envStopModel('STOP_MODEL', 'TIGHT_FVG'),
        breakevenTriggerProfitUsd: envFloat('BREAKEVEN_TRIGGER_PROFIT_USD', 0.40),
        partialCloseEnabled: envBool('PARTIAL_CLOSE_ENABLED', true),
        partialCloseTriggerProfitUsd: envFloat('PARTIAL_CLOSE_TRIGGER_PROFIT_USD', 1.00),
        partialCloseLockProfitUsd: envFloat('PARTIAL_CLOSE_LOCK_PROFIT_USD', 0.75),
        partialCloseMaxFraction: envFloat('PARTIAL_CLOSE_MAX_FRACTION', 0.85),
        startupCandleLimit: envInt('STARTUP_CANDLE_LIMIT', 500),
        exitTargetMode: envExitTargetMode('EXIT_TARGET_MODE', 'HYBRID'),
        targetRMultiple: envFloat('TARGET_R_MULTIPLE', 1.5),
        minRiskRewardRatio: envFloat('MIN_RISK_REWARD_RATIO', 1.5),
        maxTargetDistancePercent: envFloat('MAX_TARGET_DISTANCE_PERCENT', 0),
        oppositeSignalMaxLossUsd: envFloat('OPPOSITE_SIGNAL_MAX_LOSS_USD', 0.50),
        recentSignalWatchEnabled: envBool('RECENT_SIGNAL_WATCH_ENABLED', true),
        recentSignalWatchTtlCandles: envInt('RECENT_SIGNAL_WATCH_TTL_CANDLES', 3),
        maxConsecutiveLosses: envInt('MAX_CONSECUTIVE_LOSSES', 5),
        consecutiveLossPauseMinutes: envFloat('CONSECUTIVE_LOSS_PAUSE_MINUTES', 30),
        rollingWindowTrades: envInt('ROLLING_WINDOW_TRADES', 20),
        minRollingWinRate: envFloat('MIN_ROLLING_WIN_RATE', 0.35),
        rollingWinRatePauseMinutes: envFloat('ROLLING_WIN_RATE_PAUSE_MINUTES', 60),
        rollingPnlWindowTrades: envInt('ROLLING_PNL_WINDOW_TRADES', 20),
        maxRollingLossUsd: envFloat('MAX_ROLLING_LOSS_USD', 5.00),
        rollingPnlPauseMinutes: envFloat('ROLLING_PNL_PAUSE_MINUTES', 60),
        maxDailyRealizedLossUsd: envFloat('MAX_DAILY_REALIZED_LOSS_USD', 5.00),
        maxTotalOpenPositions: envInt('MAX_TOTAL_OPEN_POSITIONS', 5),
        maxActiveRiskPositions: envInt('MAX_ACTIVE_RISK_POSITIONS', 3),
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
function envStopModel(key, fallback) {
    const raw = (process.env[key] ?? '').trim().toUpperCase();
    if (raw === '')
        return fallback;
    if (raw === 'ORIGIN' || raw === 'TIGHT_FVG')
        return raw;
    throw new Error(`${key} must be "ORIGIN" or "TIGHT_FVG", got "${raw}"`);
}
function envPositionSizingMode(key, fallback) {
    const raw = (process.env[key] ?? '').trim().toUpperCase();
    if (raw === '')
        return fallback;
    if (raw === 'PROFIT_FIRST' || raw === 'RISK_FIRST')
        return raw;
    throw new Error(`${key} must be "PROFIT_FIRST" or "RISK_FIRST", got "${raw}"`);
}
exports.DEFAULT_REAL_PUBLIC_HOST = 'https://api.binance.com';
function normalizeRealPublicHost(raw) {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length === 0)
        return exports.DEFAULT_REAL_PUBLIC_HOST;
    // Strip a trailing slash so the adapter can append `/api/v3/...` cleanly.
    return trimmed.replace(/\/+$/, '');
}
function envExitTargetMode(key, fallback) {
    const raw = (process.env[key] ?? '').trim().toUpperCase();
    if (raw === '')
        return fallback;
    if (raw === 'STRUCTURE' || raw === 'SCALP' || raw === 'HYBRID')
        return raw;
    throw new Error(`${key} must be "STRUCTURE", "SCALP", or "HYBRID", got "${raw}"`);
}
function defaultTradingViewSymbol(symbol, source) {
    const upperSymbol = symbol.toUpperCase();
    if (source === 'REAL_PUBLIC') {
        const map = {
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
        const map = {
            QQQ: 'NASDAQ:QQQ',
            NDX: 'TVC:NDX',
            NQ: 'CME_MINI:NQ1!',
        };
        return map[upperSymbol] ?? upperSymbol;
    }
    return upperSymbol;
}

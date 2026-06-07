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
exports.DEFAULT_SESSION_GUARD_STATE = void 0;
exports.evaluateSessionGuard = evaluateSessionGuard;
exports.calculateSessionGuardMetrics = calculateSessionGuardMetrics;
exports.loadCompletedTradeOutcomesFromJsonl = loadCompletedTradeOutcomesFromJsonl;
exports.defaultCompletedTradesJsonlPath = defaultCompletedTradesJsonlPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.DEFAULT_SESSION_GUARD_STATE = {
    sessionGuardStatus: 'OK',
    sessionGuardReason: null,
    sessionGuardPauseStartedAt: null,
    sessionGuardPauseEndsAt: null,
    consecutiveLosses: 0,
    rollingWindowTrades: 0,
    rollingWinRate: null,
    rollingPnlUsd: null,
    dailyRealizedPnlUsd: 0,
    dailyLossLimitHit: false,
};
function evaluateSessionGuard(input) {
    const metrics = calculateSessionGuardMetrics(input.trades, input.config, input.now);
    const previous = input.previousState;
    const nowMs = input.now.getTime();
    if (previous.sessionGuardStatus === 'STOPPED' && isSameUtcDay(previous.sessionGuardPauseStartedAt, input.now)) {
        return {
            state: {
                ...previous,
                ...metrics,
                sessionGuardStatus: 'STOPPED',
                dailyLossLimitHit: true,
            },
            eventType: null,
        };
    }
    if (metrics.dailyRealizedPnlUsd <= -Math.abs(input.config.maxDailyRealizedLossUsd)) {
        return stopState(input.now, metrics);
    }
    if (previous.sessionGuardStatus === 'PAUSED' && previous.sessionGuardPauseEndsAt) {
        const endsMs = new Date(previous.sessionGuardPauseEndsAt).getTime();
        if (Number.isFinite(endsMs) && nowMs < endsMs) {
            return {
                state: {
                    ...previous,
                    ...metrics,
                    sessionGuardStatus: 'PAUSED',
                },
                eventType: null,
            };
        }
        return {
            state: {
                ...exports.DEFAULT_SESSION_GUARD_STATE,
                ...metrics,
            },
            eventType: 'SESSION_GUARD_RESUMED',
        };
    }
    if (metrics.consecutiveLosses >= input.config.maxConsecutiveLosses) {
        return pauseState(input.now, metrics, input.config.consecutiveLossPauseMinutes, 'CONSECUTIVE_LOSSES', 'SESSION_PAUSE_CONSECUTIVE_LOSSES');
    }
    if (metrics.rollingWindowTrades >= input.config.rollingWindowTrades
        && metrics.rollingWinRate !== null
        && metrics.rollingWinRate < input.config.minRollingWinRate) {
        return pauseState(input.now, metrics, input.config.rollingWinRatePauseMinutes, 'LOW_ROLLING_WIN_RATE', 'SESSION_PAUSE_LOW_ROLLING_WIN_RATE');
    }
    if (metrics.rollingWindowTrades >= input.config.rollingPnlWindowTrades
        && metrics.rollingPnlUsd !== null
        && metrics.rollingPnlUsd <= -Math.abs(input.config.maxRollingLossUsd)) {
        return pauseState(input.now, metrics, input.config.rollingPnlPauseMinutes, 'ROLLING_DRAWDOWN', 'SESSION_PAUSE_ROLLING_DRAWDOWN');
    }
    return {
        state: {
            ...exports.DEFAULT_SESSION_GUARD_STATE,
            ...metrics,
        },
        eventType: null,
    };
}
function calculateSessionGuardMetrics(trades, config, now) {
    const consecutiveLosses = countConsecutiveLosses(trades);
    const rollingCount = Math.min(config.rollingWindowTrades, trades.length);
    const rollingTrades = trades.slice(Math.max(0, trades.length - config.rollingWindowTrades));
    const rollingWins = rollingTrades.filter(trade => trade.realizedPnlUsd > 0).length;
    const rollingWinRate = rollingTrades.length > 0 ? rollingWins / rollingTrades.length : null;
    const rollingPnlUsd = rollingTrades.length > 0
        ? roundMoney(rollingTrades.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0))
        : null;
    const dailyRealizedPnlUsd = roundMoney(trades
        .filter(trade => isSameUtcDay(trade.exitTimestamp, now))
        .reduce((sum, trade) => sum + trade.realizedPnlUsd, 0));
    return {
        consecutiveLosses,
        rollingWindowTrades: rollingCount,
        rollingWinRate,
        rollingPnlUsd,
        dailyRealizedPnlUsd,
        dailyLossLimitHit: dailyRealizedPnlUsd <= -Math.abs(config.maxDailyRealizedLossUsd),
    };
}
function loadCompletedTradeOutcomesFromJsonl(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return [];
        const raw = fs.readFileSync(filePath, 'utf-8').trim();
        if (!raw)
            return [];
        return raw
            .split(/\r?\n/)
            .map(line => JSON.parse(line))
            .map(record => ({
            realizedPnlUsd: Number(record.finalTotalPnlUsd ?? record.trade?.realizedPnlUsd ?? 0),
            exitTimestamp: String(record.finalExit?.timestamp ?? record.trade?.exitTimestamp ?? record.timestamp ?? new Date(0).toISOString()),
        }))
            .filter(trade => Number.isFinite(trade.realizedPnlUsd));
    }
    catch {
        return [];
    }
}
function defaultCompletedTradesJsonlPath() {
    return path.resolve(__dirname, '../../logs/completed-trades.jsonl');
}
function pauseState(now, metrics, minutes, reason, eventType) {
    const pauseEnds = new Date(now.getTime() + Math.max(0, minutes) * 60_000);
    return {
        state: {
            ...metrics,
            sessionGuardStatus: 'PAUSED',
            sessionGuardReason: reason,
            sessionGuardPauseStartedAt: now.toISOString(),
            sessionGuardPauseEndsAt: pauseEnds.toISOString(),
        },
        eventType,
    };
}
function stopState(now, metrics) {
    return {
        state: {
            ...metrics,
            sessionGuardStatus: 'STOPPED',
            sessionGuardReason: 'DAILY_LOSS_LIMIT',
            sessionGuardPauseStartedAt: now.toISOString(),
            sessionGuardPauseEndsAt: endOfUtcDay(now).toISOString(),
            dailyLossLimitHit: true,
        },
        eventType: 'SESSION_STOP_DAILY_LOSS_LIMIT',
    };
}
function countConsecutiveLosses(trades) {
    let count = 0;
    for (let index = trades.length - 1; index >= 0; index--) {
        const pnl = trades[index]?.realizedPnlUsd ?? 0;
        if (pnl < 0)
            count++;
        else if (pnl > 0)
            break;
        else
            break;
    }
    return count;
}
function isSameUtcDay(timestamp, now) {
    if (!timestamp)
        return false;
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime()))
        return false;
    return value.getUTCFullYear() === now.getUTCFullYear()
        && value.getUTCMonth() === now.getUTCMonth()
        && value.getUTCDate() === now.getUTCDate();
}
function endOfUtcDay(now) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}
function roundMoney(value) {
    return Math.round(value * 10000) / 10000;
}

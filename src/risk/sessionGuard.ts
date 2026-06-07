import * as fs from 'fs';
import * as path from 'path';

export type SessionGuardStatus = 'OK' | 'PAUSED' | 'STOPPED';
export type SessionGuardEventType =
  | 'SESSION_PAUSE_CONSECUTIVE_LOSSES'
  | 'SESSION_PAUSE_LOW_ROLLING_WIN_RATE'
  | 'SESSION_PAUSE_ROLLING_DRAWDOWN'
  | 'SESSION_STOP_DAILY_LOSS_LIMIT'
  | 'ENTRY_SKIP_SESSION_PAUSED'
  | 'SESSION_GUARD_RESUMED';

export interface SessionGuardConfig {
  maxConsecutiveLosses: number;
  consecutiveLossPauseMinutes: number;
  rollingWindowTrades: number;
  minRollingWinRate: number;
  rollingWinRatePauseMinutes: number;
  rollingPnlWindowTrades: number;
  maxRollingLossUsd: number;
  rollingPnlPauseMinutes: number;
  maxDailyRealizedLossUsd: number;
}

export interface CompletedTradeOutcome {
  realizedPnlUsd: number;
  exitTimestamp: string;
}

export interface SessionGuardState {
  sessionGuardStatus: SessionGuardStatus;
  sessionGuardReason: string | null;
  sessionGuardPauseStartedAt: string | null;
  sessionGuardPauseEndsAt: string | null;
  consecutiveLosses: number;
  rollingWindowTrades: number;
  rollingWinRate: number | null;
  rollingPnlUsd: number | null;
  dailyRealizedPnlUsd: number;
  dailyLossLimitHit: boolean;
}

export interface SessionGuardEvaluation {
  state: SessionGuardState;
  eventType: SessionGuardEventType | null;
}

export const DEFAULT_SESSION_GUARD_STATE: SessionGuardState = {
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

export function evaluateSessionGuard(input: {
  trades: readonly CompletedTradeOutcome[];
  previousState: SessionGuardState;
  config: SessionGuardConfig;
  now: Date;
}): SessionGuardEvaluation {
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
        ...DEFAULT_SESSION_GUARD_STATE,
        ...metrics,
      },
      eventType: 'SESSION_GUARD_RESUMED',
    };
  }

  if (metrics.consecutiveLosses >= input.config.maxConsecutiveLosses) {
    return pauseState(
      input.now,
      metrics,
      input.config.consecutiveLossPauseMinutes,
      'CONSECUTIVE_LOSSES',
      'SESSION_PAUSE_CONSECUTIVE_LOSSES',
    );
  }

  if (
    metrics.rollingWindowTrades >= input.config.rollingWindowTrades
    && metrics.rollingWinRate !== null
    && metrics.rollingWinRate < input.config.minRollingWinRate
  ) {
    return pauseState(
      input.now,
      metrics,
      input.config.rollingWinRatePauseMinutes,
      'LOW_ROLLING_WIN_RATE',
      'SESSION_PAUSE_LOW_ROLLING_WIN_RATE',
    );
  }

  if (
    metrics.rollingWindowTrades >= input.config.rollingPnlWindowTrades
    && metrics.rollingPnlUsd !== null
    && metrics.rollingPnlUsd <= -Math.abs(input.config.maxRollingLossUsd)
  ) {
    return pauseState(
      input.now,
      metrics,
      input.config.rollingPnlPauseMinutes,
      'ROLLING_DRAWDOWN',
      'SESSION_PAUSE_ROLLING_DRAWDOWN',
    );
  }

  return {
    state: {
      ...DEFAULT_SESSION_GUARD_STATE,
      ...metrics,
    },
    eventType: null,
  };
}

export function calculateSessionGuardMetrics(
  trades: readonly CompletedTradeOutcome[],
  config: SessionGuardConfig,
  now: Date,
): Pick<SessionGuardState,
  'consecutiveLosses'
  | 'rollingWindowTrades'
  | 'rollingWinRate'
  | 'rollingPnlUsd'
  | 'dailyRealizedPnlUsd'
  | 'dailyLossLimitHit'
> {
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

export function loadCompletedTradeOutcomesFromJsonl(filePath: string): CompletedTradeOutcome[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .map(line => JSON.parse(line) as any)
      .map(record => ({
        realizedPnlUsd: Number(record.finalTotalPnlUsd ?? record.trade?.realizedPnlUsd ?? 0),
        exitTimestamp: String(record.finalExit?.timestamp ?? record.trade?.exitTimestamp ?? record.timestamp ?? new Date(0).toISOString()),
      }))
      .filter(trade => Number.isFinite(trade.realizedPnlUsd));
  } catch {
    return [];
  }
}

export function defaultCompletedTradesJsonlPath(): string {
  return path.resolve(__dirname, '../../logs/completed-trades.jsonl');
}

function pauseState(
  now: Date,
  metrics: ReturnType<typeof calculateSessionGuardMetrics>,
  minutes: number,
  reason: string,
  eventType: SessionGuardEventType,
): SessionGuardEvaluation {
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

function stopState(
  now: Date,
  metrics: ReturnType<typeof calculateSessionGuardMetrics>,
): SessionGuardEvaluation {
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

function countConsecutiveLosses(trades: readonly CompletedTradeOutcome[]): number {
  let count = 0;
  for (let index = trades.length - 1; index >= 0; index--) {
    const pnl = trades[index]?.realizedPnlUsd ?? 0;
    if (pnl < 0) count++;
    else if (pnl > 0) break;
    else break;
  }
  return count;
}

function isSameUtcDay(timestamp: string | null, now: Date): boolean {
  if (!timestamp) return false;
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return false;
  return value.getUTCFullYear() === now.getUTCFullYear()
    && value.getUTCMonth() === now.getUTCMonth()
    && value.getUTCDate() === now.getUTCDate();
}

function endOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

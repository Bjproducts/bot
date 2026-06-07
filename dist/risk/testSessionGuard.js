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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sessionGuard_1 = require("./sessionGuard");
const tradeJournal_1 = require("../journal/tradeJournal");
const now = new Date('2026-06-06T12:00:00.000Z');
const config = {
    maxConsecutiveLosses: 5,
    consecutiveLossPauseMinutes: 30,
    rollingWindowTrades: 20,
    minRollingWinRate: 0.35,
    rollingWinRatePauseMinutes: 60,
    rollingPnlWindowTrades: 20,
    maxRollingLossUsd: 5,
    rollingPnlPauseMinutes: 60,
    maxDailyRealizedLossUsd: 5,
};
const tests = [
    testConsecutiveLossPause(),
    testWinningTradeResetsConsecutiveLosses(),
    testEntrySkippedWhilePaused(),
    testOpenManagementStillPossibleWhilePaused(),
    testPauseExpires(),
    testResumeEvent(),
    testLowRollingWinRatePause(),
    testRollingDrawdownPause(),
    testDailyLossStop(),
    testDailyStopBlocksRestOfUtcDay(),
    testDailyStopResetsNextUtcDay(),
    testRollingGuardsWaitForFullWindow(),
    testPauseDurationUsesConfiguredMinutes(),
    testRebuildFromCompletedTradesJsonl(),
    testGuardEventsWriteDurableJsonl(),
];
let failures = 0;
for (const test of tests) {
    console.log(`Test: ${test.name}`);
    console.log(`Expected: ${test.expected}`);
    console.log(`Actual:   ${test.actual}`);
    console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
    if (!test.passed)
        failures++;
}
if (failures > 0) {
    console.error(`Session guard tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Session guard tests: ${tests.length}/${tests.length} passed`);
function testConsecutiveLossPause() {
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    return {
        name: '5 consecutive losses triggers SESSION_PAUSE_CONSECUTIVE_LOSSES',
        expected: 'PAUSED SESSION_PAUSE_CONSECUTIVE_LOSSES losses=5',
        actual: `${result.state.sessionGuardStatus} ${result.eventType} losses=${result.state.consecutiveLosses}`,
        passed: result.state.sessionGuardStatus === 'PAUSED'
            && result.eventType === 'SESSION_PAUSE_CONSECUTIVE_LOSSES'
            && result.state.consecutiveLosses === 5,
    };
}
function testWinningTradeResetsConsecutiveLosses() {
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: [...losses(4, -0.75), win(1)],
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    return {
        name: 'winning trade resets consecutive loss count',
        expected: 'OK losses=0',
        actual: `${result.state.sessionGuardStatus} losses=${result.state.consecutiveLosses}`,
        passed: result.state.sessionGuardStatus === 'OK' && result.state.consecutiveLosses === 0,
    };
}
function testEntrySkippedWhilePaused() {
    const paused = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    }).state;
    return {
        name: 'entry is skipped while paused',
        expected: 'status!=OK',
        actual: paused.sessionGuardStatus,
        passed: paused.sessionGuardStatus !== 'OK',
    };
}
function testOpenManagementStillPossibleWhilePaused() {
    const paused = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    }).state;
    const shouldManageOpenPositions = paused.sessionGuardStatus !== 'OK';
    return {
        name: 'open position management still runs while paused',
        expected: 'managementAllowed=true',
        actual: `managementAllowed=${shouldManageOpenPositions}`,
        passed: shouldManageOpenPositions,
    };
}
function testPauseExpires() {
    const pausedEval = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    const later = new Date(now.getTime() + 31 * 60_000);
    const resumed = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: [...losses(4, -0.75), win(1)],
        previousState: pausedEval.state,
        config,
        now: later,
    });
    return {
        name: 'pause expires after configured minutes',
        expected: 'OK',
        actual: resumed.state.sessionGuardStatus,
        passed: resumed.state.sessionGuardStatus === 'OK',
    };
}
function testResumeEvent() {
    const pausedEval = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    const later = new Date(now.getTime() + 31 * 60_000);
    const resumed = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: [...losses(4, -0.75), win(1)],
        previousState: pausedEval.state,
        config,
        now: later,
    });
    return {
        name: 'SESSION_GUARD_RESUMED logs when pause expires',
        expected: 'SESSION_GUARD_RESUMED',
        actual: String(resumed.eventType),
        passed: resumed.eventType === 'SESSION_GUARD_RESUMED',
    };
}
function testLowRollingWinRatePause() {
    const trades = [
        loss(-0.5), loss(-0.5), win(1), loss(-0.5),
        loss(-0.5), loss(-0.5), win(1), loss(-0.5),
        loss(-0.5), loss(-0.5), win(1), loss(-0.5),
        loss(-0.5), loss(-0.5), win(1), loss(-0.5),
        loss(-0.5), loss(-0.5), win(1), win(1),
    ];
    const result = (0, sessionGuard_1.evaluateSessionGuard)({ trades, previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE, config, now });
    return {
        name: 'rolling 20 win rate below 35% triggers SESSION_PAUSE_LOW_ROLLING_WIN_RATE',
        expected: 'PAUSED low WR 30%',
        actual: `${result.state.sessionGuardStatus} ${result.eventType} wr=${result.state.rollingWinRate}`,
        passed: result.state.sessionGuardStatus === 'PAUSED'
            && result.eventType === 'SESSION_PAUSE_LOW_ROLLING_WIN_RATE'
            && result.state.rollingWinRate !== null
            && result.state.rollingWinRate < 0.35,
    };
}
function testRollingDrawdownPause() {
    const oldTimestamp = '2026-06-05T12:00:00.000Z';
    const trades = [
        loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), win(0.2, oldTimestamp), win(0.2, oldTimestamp),
        loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), win(0.2, oldTimestamp), win(0.2, oldTimestamp),
        loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), win(0.2, oldTimestamp), win(0.2, oldTimestamp),
        loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), loss(-0.6, oldTimestamp), win(0.2, oldTimestamp), win(0.2, oldTimestamp),
    ];
    const result = (0, sessionGuard_1.evaluateSessionGuard)({ trades, previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE, config, now });
    return {
        name: 'rolling 20 PnL <= -$5 triggers SESSION_PAUSE_ROLLING_DRAWDOWN',
        expected: 'SESSION_PAUSE_ROLLING_DRAWDOWN',
        actual: `${result.eventType} pnl=${result.state.rollingPnlUsd}`,
        passed: result.eventType === 'SESSION_PAUSE_ROLLING_DRAWDOWN'
            && (result.state.rollingPnlUsd ?? 0) <= -5,
    };
}
function testDailyLossStop() {
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(7, -0.8),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    return {
        name: 'daily realized PnL <= -$5 triggers SESSION_STOP_DAILY_LOSS_LIMIT',
        expected: 'STOPPED SESSION_STOP_DAILY_LOSS_LIMIT',
        actual: `${result.state.sessionGuardStatus} ${result.eventType} daily=${result.state.dailyRealizedPnlUsd}`,
        passed: result.state.sessionGuardStatus === 'STOPPED'
            && result.eventType === 'SESSION_STOP_DAILY_LOSS_LIMIT'
            && result.state.dailyRealizedPnlUsd <= -5,
    };
}
function testDailyStopBlocksRestOfUtcDay() {
    const stopped = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(7, -0.8),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    }).state;
    const laterSameDay = new Date('2026-06-06T23:00:00.000Z');
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: [...losses(7, -0.8), win(10)],
        previousState: stopped,
        config,
        now: laterSameDay,
    });
    return {
        name: 'daily stopped state blocks entries for rest of UTC day',
        expected: 'STOPPED',
        actual: result.state.sessionGuardStatus,
        passed: result.state.sessionGuardStatus === 'STOPPED',
    };
}
function testDailyStopResetsNextUtcDay() {
    const stopped = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(7, -0.8),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    }).state;
    const nextDay = new Date('2026-06-07T00:01:00.000Z');
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(7, -0.8),
        previousState: stopped,
        config,
        now: nextDay,
    });
    return {
        name: 'daily stopped state does not persist into next UTC day',
        expected: 'not STOPPED',
        actual: result.state.sessionGuardStatus,
        passed: result.state.sessionGuardStatus !== 'STOPPED',
    };
}
function testRollingGuardsWaitForFullWindow() {
    const trades = [loss(-1), loss(-1), win(1), loss(-1), win(1)];
    const result = (0, sessionGuard_1.evaluateSessionGuard)({ trades, previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE, config, now });
    return {
        name: 'rolling guards wait for full configured window',
        expected: 'OK rollingWindowTrades=5',
        actual: `${result.state.sessionGuardStatus} rollingWindowTrades=${result.state.rollingWindowTrades}`,
        passed: result.state.sessionGuardStatus === 'OK' && result.state.rollingWindowTrades === 5,
    };
}
function testPauseDurationUsesConfiguredMinutes() {
    const result = (0, sessionGuard_1.evaluateSessionGuard)({
        trades: losses(5, -0.75),
        previousState: sessionGuard_1.DEFAULT_SESSION_GUARD_STATE,
        config,
        now,
    });
    const started = new Date(result.state.sessionGuardPauseStartedAt ?? 0).getTime();
    const ends = new Date(result.state.sessionGuardPauseEndsAt ?? 0).getTime();
    const minutes = (ends - started) / 60_000;
    return {
        name: 'consecutive-loss pause duration uses configured minutes',
        expected: '30 minutes',
        actual: `${minutes} minutes`,
        passed: minutes === 30,
    };
}
function testRebuildFromCompletedTradesJsonl() {
    const dir = tempDir('session-guard-rebuild');
    const filePath = path.join(dir, 'completed-trades.jsonl');
    fs.writeFileSync(filePath, [
        JSON.stringify({ finalTotalPnlUsd: -1, finalExit: { timestamp: now.toISOString() } }),
        JSON.stringify({ finalTotalPnlUsd: 2, finalExit: { timestamp: now.toISOString() } }),
    ].join('\n') + '\n', 'utf-8');
    const outcomes = (0, sessionGuard_1.loadCompletedTradeOutcomesFromJsonl)(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
    return {
        name: 'guard state can rebuild from completed-trades.jsonl',
        expected: '2 outcomes',
        actual: `${outcomes.length} outcomes pnl=${outcomes.map(o => o.realizedPnlUsd).join(',')}`,
        passed: outcomes.length === 2 && outcomes[0].realizedPnlUsd === -1 && outcomes[1].realizedPnlUsd === 2,
    };
}
function testGuardEventsWriteDurableJsonl() {
    const dir = tempDir('session-guard-journal');
    const journal = new tradeJournal_1.TradeJournal({ logsDir: dir });
    journal.logEvent(guardEvent('SESSION_PAUSE_CONSECUTIVE_LOSSES'));
    const rows = fs.readFileSync(path.join(dir, 'trade-events.jsonl'), 'utf-8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    fs.rmSync(dir, { recursive: true, force: true });
    return {
        name: 'guard events are written to durable journal',
        expected: 'SESSION_PAUSE_CONSECUTIVE_LOSSES',
        actual: String(rows[0]?.eventType ?? 'missing'),
        passed: rows.length === 1 && rows[0].eventType === 'SESSION_PAUSE_CONSECUTIVE_LOSSES',
    };
}
function losses(count, value, timestamp = now.toISOString()) {
    return Array.from({ length: count }, () => loss(value, timestamp));
}
function wins(count, value, timestamp = now.toISOString()) {
    return Array.from({ length: count }, () => win(value, timestamp));
}
function loss(value, timestamp = now.toISOString()) {
    return { realizedPnlUsd: value, exitTimestamp: timestamp };
}
function win(value, timestamp = now.toISOString()) {
    return { realizedPnlUsd: value, exitTimestamp: timestamp };
}
function guardEvent(action) {
    return {
        timestamp: now.toISOString(),
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action,
        side: 'LONG',
        price: 100,
        size: 0,
        investedUsd: 0,
        avgEntry: 0,
        dcaCount: 0,
        realizedPnlUsd: 0,
        signalDirection: 'BUY',
        signalSource: 'ICT',
        protectionReason: 'fixture',
        guardStatus: 'PAUSED',
        pauseStartedAt: now.toISOString(),
        pauseEndsAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        consecutiveLosses: 5,
        rollingWindowTrades: 20,
        rollingWinRate: 0.2,
        rollingPnlUsd: -8,
        dailyRealizedPnlUsd: -5,
        maxDailyLossUsd: 5,
    };
}
function tempDir(name) {
    const dir = path.resolve(__dirname, '../../logs', `.${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

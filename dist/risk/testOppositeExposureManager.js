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
const oppositeExposureManager_1 = require("./oppositeExposureManager");
const tradeJournal_1 = require("../journal/tradeJournal");
const tmpLogsDir = path.resolve(__dirname, '../../logs/opposite-exposure-test');
if (fs.existsSync(tmpLogsDir))
    fs.rmSync(tmpLogsDir, { recursive: true, force: true });
const tests = [
    test1ActiveLongBlocksNewShort(),
    test2ActiveShortBlocksNewLong(),
    test3ProfitableOppositeClosesForProfit(),
    test3bProfitableShortClosesForProfit(),
    test4LosingOppositeClosesAtMaxLoss(),
    test4bLosingShortClosesAtMaxLoss(),
    test5MixedExposureCleanupClosesUnprotectedLosing(),
    test6PartialRunnerStaysIfBeProtected(),
    test7NewOppositeEntrySkippedWhileOppositeRemains(),
    test8JournalLogsOppositeSignalRiskExit(),
    test9JournalLogsMixedExposureRiskExit(),
    test10JournalLogsOppositeSignalProfitExit(),
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
function test3bProfitableShortClosesForProfit() {
    const positions = [
        snap('short-prof', 'SHORT', 0.50, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'LONG');
    return {
        name: 'profitable SHORT closes when accepted BUY signal appears',
        expected: 'positionsToProfitClose=[short-prof]',
        actual: `profitClose=[${result.positionsToProfitClose.map(p => p.id).join(',')}]`,
        passed: result.positionsToProfitClose.length === 1
            && result.positionsToProfitClose[0].id === 'short-prof',
    };
}
if (failures > 0) {
    console.error(`Opposite exposure tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
function test4bLosingShortClosesAtMaxLoss() {
    const positions = [
        snap('short-deep-loss', 'SHORT', -0.50, false),
        snap('short-shallow-loss', 'SHORT', -0.10, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'LONG');
    const closedIds = result.positionsToClose.map(p => p.id).join(',');
    const waitingIds = result.positionsWaiting.map(p => p.id).join(',');
    return {
        name: 'losing SHORT closes at -$0.50 or worse when accepted BUY signal appears',
        expected: 'close=[short-deep-loss], waiting=[short-shallow-loss]',
        actual: `close=[${closedIds}], waiting=[${waitingIds}]`,
        passed: closedIds === 'short-deep-loss' && waitingIds === 'short-shallow-loss',
    };
}
console.log(`Opposite exposure tests: ${tests.length}/${tests.length} passed`);
// ─── 1 ───
function test1ActiveLongBlocksNewShort() {
    const positions = [
        snap('long-1', 'LONG', 0.10, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'SHORT');
    return {
        name: 'active LONG blocks new SHORT entry',
        expected: 'blockNewEntry=true, reason mentions LONG',
        actual: `blockNewEntry=${result.blockNewEntry}, reason=${result.blockReason}`,
        passed: result.blockNewEntry === true && /LONG/.test(result.blockReason),
    };
}
// ─── 2 ───
function test2ActiveShortBlocksNewLong() {
    const positions = [
        snap('short-1', 'SHORT', -0.10, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'LONG');
    return {
        name: 'active SHORT blocks new LONG entry',
        expected: 'blockNewEntry=true, reason mentions SHORT',
        actual: `blockNewEntry=${result.blockNewEntry}, reason=${result.blockReason}`,
        passed: result.blockNewEntry === true && /SHORT/.test(result.blockReason),
    };
}
// ─── 3 ───
function test3ProfitableOppositeClosesForProfit() {
    const positions = [
        snap('long-prof', 'LONG', 0.50, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'SHORT');
    return {
        name: 'profitable opposite position closes for profit',
        expected: 'positionsToProfitClose=[long-prof], positionsToClose=[]',
        actual: `profitClose=[${result.positionsToProfitClose.map(p => p.id).join(',')}], close=[${result.positionsToClose.map(p => p.id).join(',')}]`,
        passed: result.positionsToProfitClose.length === 1
            && result.positionsToProfitClose[0].id === 'long-prof'
            && result.positionsToClose.length === 0,
    };
}
// ─── 4 ───
function test4LosingOppositeClosesAtMaxLoss() {
    const positions = [
        snap('long-deep-loss', 'LONG', -0.50, false), // exactly at threshold
        snap('long-deeper-loss', 'LONG', -0.75, false),
        snap('long-shallow-loss', 'LONG', -0.10, false), // wait, not close
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'SHORT');
    const closedIds = result.positionsToClose.map(p => p.id).sort().join(',');
    const waitingIds = result.positionsWaiting.map(p => p.id).join(',');
    return {
        name: 'losing opposite position closes at -$0.50 or worse',
        expected: 'close=[long-deep-loss,long-deeper-loss], waiting=[long-shallow-loss]',
        actual: `close=[${closedIds}], waiting=[${waitingIds}]`,
        passed: closedIds === 'long-deep-loss,long-deeper-loss'
            && waitingIds === 'long-shallow-loss',
    };
}
// ─── 5 ───
function test5MixedExposureCleanupClosesUnprotectedLosing() {
    const positions = [
        snap('short-good', 'SHORT', 0.40, true), // protected, profitable — keep
        snap('long-bleed', 'LONG', -0.69, false), // unprotected, losing > 0.30 — close
        snap('long-tiny-loss', 'LONG', -0.10, false), // unprotected but loss is shallow — keep
    ];
    const result = (0, oppositeExposureManager_1.evaluateMixedExposureCleanup)(positions);
    const ids = result.positionsToClose.map(p => p.id).join(',');
    return {
        name: 'mixed exposure cleanup closes unprotected losing position',
        expected: 'mixedExposureActive=true, positionsToClose=[long-bleed]',
        actual: `mixed=${result.mixedExposureActive}, close=[${ids}]`,
        passed: result.mixedExposureActive === true && ids === 'long-bleed',
    };
}
// ─── 6 ───
function test6PartialRunnerStaysIfBeProtected() {
    const positions = [
        snap('short-runner', 'SHORT', -0.50, true, true), // partial-runner + BE, deeply losing
        snap('long-flat', 'LONG', 0.01, false),
    ];
    const result = (0, oppositeExposureManager_1.evaluateMixedExposureCleanup)(positions);
    const ids = result.positionsToClose.map(p => p.id).join(',');
    return {
        name: 'partial-closed runner stays if BE-protected (even when losing)',
        expected: 'short-runner kept (BE-protected), no close',
        actual: `close=[${ids}]`,
        passed: ids === '',
    };
}
// ─── 7 ───
function test7NewOppositeEntrySkippedWhileOppositeRemains() {
    // Simulate the state after a profitable opposite has been closed but a
    // small-loss opposite remains. New SHORT entry must still be blocked.
    const positions = [
        snap('long-waiting', 'LONG', -0.15, false), // small loss, not eligible to close yet
    ];
    const result = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(positions, 'SHORT');
    return {
        name: 'new opposite entry is skipped while opposite exposure remains',
        expected: 'blockNewEntry=true even after protection (positions still open)',
        actual: `blockNewEntry=${result.blockNewEntry}, waiting=${result.positionsWaiting.length}, profitClose=${result.positionsToProfitClose.length}`,
        passed: result.blockNewEntry === true
            && result.positionsWaiting.length === 1
            && result.positionsToProfitClose.length === 0,
    };
}
// ─── 8 ───
function test8JournalLogsOppositeSignalRiskExit() {
    const dir = path.join(tmpLogsDir, 'opposite-signal');
    if (fs.existsSync(dir))
        fs.rmSync(dir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir: dir });
    const ts = new Date().toISOString();
    const event = {
        timestamp: ts,
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'OPPOSITE_SIGNAL_RISK_EXIT',
        side: 'LONG',
        price: 66000,
        size: 0.001,
        investedUsd: 66,
        avgEntry: 66100,
        dcaCount: 0,
        realizedPnlUsd: -0.40,
        signalDirection: 'SELL',
        signalSource: 'ICT',
    };
    const trade = {
        id: 'opposite-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
        entryTimestamp: ts, exitTimestamp: ts,
        entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66000,
        dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: -0.40, pnlPct: -0.6,
        reason: 'OPPOSITE_SIGNAL_RISK_EXIT',
        tradeDurationMinutes: 1,
    };
    journal.logClose(event, trade);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8'));
    return {
        name: 'journal logs OPPOSITE_SIGNAL_RIST_EXIT close',
        expected: 'completed-trades.json contains reason=OPPOSITE_SIGNAL_RISK_EXIT',
        actual: `tradeCount=${written.length}, reasons=[${written.map(t => t.reason).join(',')}]`,
        passed: written.length === 1 && written[0].reason === 'OPPOSITE_SIGNAL_RISK_EXIT',
    };
}
// ─── 9 ───
function test9JournalLogsMixedExposureRiskExit() {
    const dir = path.join(tmpLogsDir, 'mixed-exposure');
    if (fs.existsSync(dir))
        fs.rmSync(dir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir: dir });
    const ts = new Date().toISOString();
    const event = {
        timestamp: ts,
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'MIXED_EXPOSURE_RISK_EXIT',
        side: 'LONG',
        price: 66000,
        size: 0.001,
        investedUsd: 66,
        avgEntry: 66100,
        dcaCount: 0,
        realizedPnlUsd: -0.69,
        signalDirection: 'NONE',
        signalSource: 'ICT',
    };
    const trade = {
        id: 'mixed-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
        entryTimestamp: ts, exitTimestamp: ts,
        entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66000,
        dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: -0.69, pnlPct: -1.04,
        reason: 'MIXED_EXPOSURE_RISK_EXIT',
        tradeDurationMinutes: 1,
    };
    journal.logClose(event, trade);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8'));
    return {
        name: 'journal logs MIXED_EXPOSURE_RISK_EXIT close',
        expected: 'completed-trades.json contains reason=MIXED_EXPOSURE_RISK_EXIT',
        actual: `tradeCount=${written.length}, reasons=[${written.map(t => t.reason).join(',')}]`,
        passed: written.length === 1 && written[0].reason === 'MIXED_EXPOSURE_RISK_EXIT',
    };
}
function test10JournalLogsOppositeSignalProfitExit() {
    const dir = path.join(tmpLogsDir, 'opposite-profit');
    if (fs.existsSync(dir))
        fs.rmSync(dir, { recursive: true, force: true });
    const journal = new tradeJournal_1.TradeJournal({ logsDir: dir });
    const ts = new Date().toISOString();
    const event = {
        timestamp: ts,
        symbol: 'BTC',
        marketDataSource: 'TEST',
        action: 'OPPOSITE_SIGNAL_PROFIT_EXIT',
        side: 'LONG',
        price: 66200,
        size: 0.001,
        investedUsd: 66,
        avgEntry: 66100,
        dcaCount: 0,
        realizedPnlUsd: 0.10,
        signalDirection: 'SELL',
        signalSource: 'ICT',
    };
    const trade = {
        id: 'opposite-profit-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
        entryTimestamp: ts, exitTimestamp: ts,
        entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66200,
        dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: 0.10, pnlPct: 0.15,
        reason: 'OPPOSITE_SIGNAL_PROFIT_EXIT',
        tradeDurationMinutes: 1,
    };
    journal.logClose(event, trade);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8'));
    return {
        name: 'journal logs OPPOSITE_SIGNAL_PROFIT_EXIT close',
        expected: 'completed-trades.json contains reason=OPPOSITE_SIGNAL_PROFIT_EXIT',
        actual: `tradeCount=${written.length}, reasons=[${written.map(t => t.reason).join(',')}]`,
        passed: written.length === 1 && written[0].reason === 'OPPOSITE_SIGNAL_PROFIT_EXIT',
    };
}
// Sanity: assess exposure + classify flags (not counted in the 9 tests but
// will surface a compile-time wiring break if the helpers drift).
{
    const ps = [snap('a', 'LONG', 0.1, false), snap('b', 'SHORT', -0.5, false)];
    const exposure = (0, oppositeExposureManager_1.assessDirectionalExposure)(ps);
    const flags = (0, oppositeExposureManager_1.classifyPositionExposureFlags)(ps[1], ps);
    if (exposure !== 'MIXED' || !flags.mixedExposureRisk) {
        console.error('Sanity wiring check failed for assessDirectionalExposure / classifyPositionExposureFlags');
        process.exit(1);
    }
    void oppositeExposureManager_1.DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
}
function snap(id, side, unrealizedPnlUsd, stopAtBreakeven, partialClosed = false) {
    return {
        id,
        side,
        unrealizedPnlUsd,
        stopAtBreakeven,
        averageEntryPrice: 66100,
        partialClosed,
    };
}

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD,
  PositionSnapshot,
  assessDirectionalExposure,
  classifyPositionExposureFlags,
  evaluateMixedExposureCleanup,
  evaluateOppositeSignalProtection,
} from './oppositeExposureManager';
import { TradeJournal } from '../journal/tradeJournal';
import { CompletedTrade, TradeEvent } from '../journal/types';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const tmpLogsDir = path.resolve(__dirname, '../../logs/opposite-exposure-test');
if (fs.existsSync(tmpLogsDir)) fs.rmSync(tmpLogsDir, { recursive: true, force: true });

const tests: TestResult[] = [
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
  if (!test.passed) failures++;
}

function test3bProfitableShortClosesForProfit(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('short-prof', 'SHORT', 0.50, false),
  ];
  const result = evaluateOppositeSignalProtection(positions, 'LONG');
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

function test4bLosingShortClosesAtMaxLoss(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('short-deep-loss', 'SHORT', -0.50, false),
    snap('short-shallow-loss', 'SHORT', -0.10, false),
  ];
  const result = evaluateOppositeSignalProtection(positions, 'LONG');
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
function test1ActiveLongBlocksNewShort(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('long-1', 'LONG', 0.10, false),
  ];
  const result = evaluateOppositeSignalProtection(positions, 'SHORT');
  return {
    name: 'active LONG blocks new SHORT entry',
    expected: 'blockNewEntry=true, reason mentions LONG',
    actual: `blockNewEntry=${result.blockNewEntry}, reason=${result.blockReason}`,
    passed: result.blockNewEntry === true && /LONG/.test(result.blockReason),
  };
}

// ─── 2 ───
function test2ActiveShortBlocksNewLong(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('short-1', 'SHORT', -0.10, false),
  ];
  const result = evaluateOppositeSignalProtection(positions, 'LONG');
  return {
    name: 'active SHORT blocks new LONG entry',
    expected: 'blockNewEntry=true, reason mentions SHORT',
    actual: `blockNewEntry=${result.blockNewEntry}, reason=${result.blockReason}`,
    passed: result.blockNewEntry === true && /SHORT/.test(result.blockReason),
  };
}

// ─── 3 ───
function test3ProfitableOppositeClosesForProfit(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('long-prof', 'LONG', 0.50, false),
  ];
  const result = evaluateOppositeSignalProtection(positions, 'SHORT');
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
function test4LosingOppositeClosesAtMaxLoss(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('long-deep-loss', 'LONG', -0.50, false),  // exactly at threshold
    snap('long-deeper-loss', 'LONG', -0.75, false),
    snap('long-shallow-loss', 'LONG', -0.10, false),  // wait, not close
  ];
  const result = evaluateOppositeSignalProtection(positions, 'SHORT');
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
function test5MixedExposureCleanupClosesUnprotectedLosing(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('short-good', 'SHORT', 0.40, true),    // protected, profitable — keep
    snap('long-bleed', 'LONG', -0.69, false),    // unprotected, losing > 0.30 — close
    snap('long-tiny-loss', 'LONG', -0.10, false), // unprotected but loss is shallow — keep
  ];
  const result = evaluateMixedExposureCleanup(positions);
  const ids = result.positionsToClose.map(p => p.id).join(',');
  return {
    name: 'mixed exposure cleanup closes unprotected losing position',
    expected: 'mixedExposureActive=true, positionsToClose=[long-bleed]',
    actual: `mixed=${result.mixedExposureActive}, close=[${ids}]`,
    passed: result.mixedExposureActive === true && ids === 'long-bleed',
  };
}

// ─── 6 ───
function test6PartialRunnerStaysIfBeProtected(): TestResult {
  const positions: PositionSnapshot[] = [
    snap('short-runner', 'SHORT', -0.50, true, true), // partial-runner + BE, deeply losing
    snap('long-flat', 'LONG', 0.01, false),
  ];
  const result = evaluateMixedExposureCleanup(positions);
  const ids = result.positionsToClose.map(p => p.id).join(',');
  return {
    name: 'partial-closed runner stays if BE-protected (even when losing)',
    expected: 'short-runner kept (BE-protected), no close',
    actual: `close=[${ids}]`,
    passed: ids === '',
  };
}

// ─── 7 ───
function test7NewOppositeEntrySkippedWhileOppositeRemains(): TestResult {
  // Simulate the state after a profitable opposite has been closed but a
  // small-loss opposite remains. New SHORT entry must still be blocked.
  const positions: PositionSnapshot[] = [
    snap('long-waiting',   'LONG', -0.15, false),  // small loss, not eligible to close yet
  ];
  const result = evaluateOppositeSignalProtection(positions, 'SHORT');
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
function test8JournalLogsOppositeSignalRiskExit(): TestResult {
  const dir = path.join(tmpLogsDir, 'opposite-signal');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const journal = new TradeJournal({ logsDir: dir });
  const ts = new Date().toISOString();
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
    id: 'opposite-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
    entryTimestamp: ts, exitTimestamp: ts,
    entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66000,
    dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: -0.40, pnlPct: -0.6,
    reason: 'OPPOSITE_SIGNAL_RISK_EXIT',
    tradeDurationMinutes: 1,
  };
  journal.logClose(event, trade);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8')) as CompletedTrade[];
  return {
    name: 'journal logs OPPOSITE_SIGNAL_RIST_EXIT close',
    expected: 'completed-trades.json contains reason=OPPOSITE_SIGNAL_RISK_EXIT',
    actual: `tradeCount=${written.length}, reasons=[${written.map(t => t.reason).join(',')}]`,
    passed: written.length === 1 && written[0].reason === 'OPPOSITE_SIGNAL_RISK_EXIT',
  };
}

// ─── 9 ───
function test9JournalLogsMixedExposureRiskExit(): TestResult {
  const dir = path.join(tmpLogsDir, 'mixed-exposure');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const journal = new TradeJournal({ logsDir: dir });
  const ts = new Date().toISOString();
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
    id: 'mixed-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
    entryTimestamp: ts, exitTimestamp: ts,
    entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66000,
    dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: -0.69, pnlPct: -1.04,
    reason: 'MIXED_EXPOSURE_RISK_EXIT',
    tradeDurationMinutes: 1,
  };
  journal.logClose(event, trade);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8')) as CompletedTrade[];
  return {
    name: 'journal logs MIXED_EXPOSURE_RISK_EXIT close',
    expected: 'completed-trades.json contains reason=MIXED_EXPOSURE_RISK_EXIT',
    actual: `tradeCount=${written.length}, reasons=[${written.map(t => t.reason).join(',')}]`,
    passed: written.length === 1 && written[0].reason === 'MIXED_EXPOSURE_RISK_EXIT',
  };
}

function test10JournalLogsOppositeSignalProfitExit(): TestResult {
  const dir = path.join(tmpLogsDir, 'opposite-profit');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const journal = new TradeJournal({ logsDir: dir });
  const ts = new Date().toISOString();
  const event: TradeEvent = {
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
  const trade: CompletedTrade = {
    id: 'opposite-profit-1', symbol: 'BTC', side: 'LONG', marketDataSource: 'TEST',
    entryTimestamp: ts, exitTimestamp: ts,
    entryPrice: 66100, avgEntryPrice: 66100, exitPrice: 66200,
    dcaCount: 0, totalInvestedUsd: 66, realizedPnlUsd: 0.10, pnlPct: 0.15,
    reason: 'OPPOSITE_SIGNAL_PROFIT_EXIT',
    tradeDurationMinutes: 1,
  };
  journal.logClose(event, trade);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'completed-trades.json'), 'utf-8')) as CompletedTrade[];
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
  const exposure = assessDirectionalExposure(ps);
  const flags = classifyPositionExposureFlags(ps[1], ps);
  if (exposure !== 'MIXED' || !flags.mixedExposureRisk) {
    console.error('Sanity wiring check failed for assessDirectionalExposure / classifyPositionExposureFlags');
    process.exit(1);
  }
  void DEFAULT_OPPOSITE_SIGNAL_MAX_LOSS_USD;
}

function snap(
  id: string,
  side: 'LONG' | 'SHORT',
  unrealizedPnlUsd: number,
  stopAtBreakeven: boolean,
  partialClosed: boolean = false,
): PositionSnapshot {
  return {
    id,
    side,
    unrealizedPnlUsd,
    stopAtBreakeven,
    averageEntryPrice: 66100,
    partialClosed,
  };
}

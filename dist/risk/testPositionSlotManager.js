"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const positionSlotManager_1 = require("./positionSlotManager");
const oppositeExposureManager_1 = require("./oppositeExposureManager");
const tests = [
    test1ThreeOpenOneBeProtectedAllowsNewEntry(),
    test2ThreeOpenAllUnprotectedBlocks(),
    test3FiveOpenBlocksEvenIfAllProtected(),
    test4PartialClosedBeRunnerNotRisk(),
    test5BeProtectedUnpartialedNotRisk(),
    test6OppositeExposureRuleStillBlocks(),
    test7DashboardCounts(),
];
let failures = 0;
for (const t of tests) {
    console.log(`Test: ${t.name}`);
    console.log(`Expected: ${t.expected}`);
    console.log(`Actual:   ${t.actual}`);
    console.log(`Result:   ${t.passed ? 'PASS' : 'FAIL'}\n`);
    if (!t.passed)
        failures++;
}
if (failures > 0) {
    console.error(`Position slot tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Position slot tests: ${tests.length}/${tests.length} passed`);
// ─── 1 ───
function test1ThreeOpenOneBeProtectedAllowsNewEntry() {
    const positions = [
        pos('p1', true, false), // BE-protected
        pos('p2', false, false), // risk
        pos('p3', false, false), // risk
    ];
    const result = (0, positionSlotManager_1.evaluatePositionSlotGate)(positions, { maxTotal: 5, maxRisk: 3 });
    return {
        name: '3 open positions with 1 BE-protected allows new entry',
        expected: 'blockNewEntry=false, risk=2/3, total=3/5',
        actual: `blockNewEntry=${result.blockNewEntry}, risk=${result.riskCount}/${result.maxRisk}, total=${result.totalOpen}/${result.maxTotal}, code=${result.blockReasonCode}`,
        passed: result.blockNewEntry === false
            && result.riskCount === 2
            && result.protectedCount === 1
            && result.totalOpen === 3
            && result.blockReasonCode === 'NONE',
    };
}
// ─── 2 ───
function test2ThreeOpenAllUnprotectedBlocks() {
    const positions = [
        pos('p1', false, false),
        pos('p2', false, false),
        pos('p3', false, false),
    ];
    const result = (0, positionSlotManager_1.evaluatePositionSlotGate)(positions, { maxTotal: 5, maxRisk: 3 });
    return {
        name: '3 open positions all unprotected blocks new entry (MAX_RISK_POSITIONS)',
        expected: 'blockNewEntry=true, code=MAX_RISK_POSITIONS, risk=3/3',
        actual: `blockNewEntry=${result.blockNewEntry}, code=${result.blockReasonCode}, risk=${result.riskCount}/${result.maxRisk}, reason="${result.blockReason}"`,
        passed: result.blockNewEntry === true
            && result.blockReasonCode === 'MAX_RISK_POSITIONS'
            && result.riskCount === 3,
    };
}
// ─── 3 ───
function test3FiveOpenBlocksEvenIfAllProtected() {
    const positions = [
        pos('p1', true, false),
        pos('p2', true, false),
        pos('p3', true, false),
        pos('p4', true, true),
        pos('p5', true, false),
    ];
    const result = (0, positionSlotManager_1.evaluatePositionSlotGate)(positions, { maxTotal: 5, maxRisk: 3 });
    return {
        name: '5 open positions blocks new entry even if all protected (MAX_TOTAL_POSITIONS)',
        expected: 'blockNewEntry=true, code=MAX_TOTAL_POSITIONS, total=5/5, risk=0',
        actual: `blockNewEntry=${result.blockNewEntry}, code=${result.blockReasonCode}, total=${result.totalOpen}/${result.maxTotal}, risk=${result.riskCount}`,
        passed: result.blockNewEntry === true
            && result.blockReasonCode === 'MAX_TOTAL_POSITIONS'
            && result.totalOpen === 5
            && result.riskCount === 0,
    };
}
// ─── 4 ───
function test4PartialClosedBeRunnerNotRisk() {
    const p = pos('runner', true, true);
    const classification = (0, positionSlotManager_1.classifyPositionSlot)(p);
    return {
        name: 'partial-closed BE runner does not count as active risk',
        expected: 'classification=PROTECTED',
        actual: `classification=${classification}`,
        passed: classification === 'PROTECTED',
    };
}
// ─── 5 ───
function test5BeProtectedUnpartialedNotRisk() {
    const p = pos('protected', true, false);
    const classification = (0, positionSlotManager_1.classifyPositionSlot)(p);
    // Also verify activeStopPrice == entryPrice alone qualifies (no BE flag).
    const pStopAtEntry = {
        id: 'stop-at-entry',
        stopAtBreakeven: false,
        partialCloseDone: false,
        activeStopPrice: 66100,
        averageEntryPrice: 66100,
    };
    const altClassification = (0, positionSlotManager_1.classifyPositionSlot)(pStopAtEntry);
    return {
        name: 'BE-protected unpartialed position does not count as active risk',
        expected: 'classification=PROTECTED for both BE flag and stop==entry',
        actual: `bePath=${classification}, stopAtEntryPath=${altClassification}`,
        passed: classification === 'PROTECTED' && altClassification === 'PROTECTED',
    };
}
// ─── 6 ───
function test6OppositeExposureRuleStillBlocks() {
    // Same-direction protected runner doesn't block (per Phase 8E).
    // Opposite-direction position — even if protected — STILL blocks under
    // Phase 8D's opposite-exposure rule. Verify both gates together.
    const slotPositions = [
        pos('long-protected', true, false),
    ];
    const slotResult = (0, positionSlotManager_1.evaluatePositionSlotGate)(slotPositions, { maxTotal: 5, maxRisk: 3 });
    const oppositeSnapshots = [{
            id: 'long-protected',
            side: 'LONG',
            unrealizedPnlUsd: 0.20,
            stopAtBreakeven: true,
            averageEntryPrice: 66100,
        }];
    const oppositeResult = (0, oppositeExposureManager_1.evaluateOppositeSignalProtection)(oppositeSnapshots, 'SHORT');
    return {
        name: 'opposite exposure rule still blocks opposite-side entries even when slot gate passes',
        expected: 'slot.blockNewEntry=false, opposite.blockNewEntry=true',
        actual: `slot.block=${slotResult.blockNewEntry}, opposite.block=${oppositeResult.blockNewEntry}, oppositeReason="${oppositeResult.blockReason}"`,
        passed: slotResult.blockNewEntry === false
            && oppositeResult.blockNewEntry === true,
    };
}
// ─── 7 ───
function test7DashboardCounts() {
    const positions = [
        pos('p1', true, false),
        pos('p2', false, true), // partial without BE → still RISK per spec
        pos('p3', true, true), // partial + BE → PROTECTED
        pos('p4', false, false),
        pos('p5', false, false),
    ];
    const counts = (0, positionSlotManager_1.countPositionSlots)(positions);
    return {
        name: 'dashboard counts risk/protected/total positions correctly',
        expected: 'total=5, risk=3 (p2,p4,p5), protected=2 (p1,p3)',
        actual: `total=${counts.total}, risk=${counts.risk}, protected=${counts.protected}`,
        passed: counts.total === 5 && counts.risk === 3 && counts.protected === 2,
    };
}
function pos(id, stopAtBreakeven, partialCloseDone) {
    return { id, stopAtBreakeven, partialCloseDone };
}

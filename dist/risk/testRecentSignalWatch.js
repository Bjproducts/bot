"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const recentSignalWatch_1 = require("./recentSignalWatch");
const now = new Date('2026-06-04T12:00:00.000Z');
const tests = [
    testStoresRecentOppositeSignal(),
    testKeepsValidSignalWithinTtl(),
    testExpiresAfterTtlCandles(),
    testExpiresWhenCandidateInvalid(),
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
    console.error(`Recent signal watch tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Recent signal watch tests: ${tests.length}/${tests.length} passed`);
function testStoresRecentOppositeSignal() {
    const state = (0, recentSignalWatch_1.createRecentSignalWatch)({
        side: 'SELL',
        zoneId: 'zone-1',
        confidence: 92,
        reason: 'fixture',
        currentTick: 10,
        ttlCandles: 3,
        now,
        tickIntervalMs: 60_000,
    });
    return {
        name: 'recent opposite signal watch stores signal after profit exit',
        expected: 'SELL zone-1 valid=true',
        actual: `${state.recentOppositeSignalSide} ${state.recentOppositeSignalZoneId} valid=${state.recentOppositeSignalValid}`,
        passed: state.recentOppositeSignalSide === 'SELL'
            && state.recentOppositeSignalZoneId === 'zone-1'
            && state.recentOppositeSignalValid === true,
    };
}
function testKeepsValidSignalWithinTtl() {
    const state = fixtureState();
    const result = (0, recentSignalWatch_1.evaluateRecentSignalWatch)({
        state,
        currentTick: 12,
        ttlCandles: 3,
        candidates: [{ zoneId: 'zone-1', signalDirection: 'SELL', status: 'QUALIFIED' }],
    });
    return {
        name: 'recent signal remains valid while same candidate qualifies within TTL',
        expected: 'expired=false valid=true age=2',
        actual: `expired=${result.expired} valid=${result.valid} age=${result.ageCandles}`,
        passed: !result.expired && result.valid && result.ageCandles === 2,
    };
}
function testExpiresAfterTtlCandles() {
    const result = (0, recentSignalWatch_1.evaluateRecentSignalWatch)({
        state: fixtureState(),
        currentTick: 13,
        ttlCandles: 3,
        candidates: [{ zoneId: 'zone-1', signalDirection: 'SELL', status: 'QUALIFIED' }],
    });
    return {
        name: 'recent signal expires after TTL candles',
        expected: 'expired=true side=null age=3',
        actual: `expired=${result.expired} side=${result.state.recentOppositeSignalSide} age=${result.ageCandles}`,
        passed: result.expired && result.state.recentOppositeSignalSide === null && result.ageCandles === 3,
    };
}
function testExpiresWhenCandidateInvalid() {
    const result = (0, recentSignalWatch_1.evaluateRecentSignalWatch)({
        state: fixtureState(),
        currentTick: 11,
        ttlCandles: 3,
        candidates: [{ zoneId: 'zone-1', signalDirection: 'SELL', status: 'REJECTED' }],
    });
    return {
        name: 'recent signal expires when candidate no longer qualifies',
        expected: 'expired=true valid=false',
        actual: `expired=${result.expired} valid=${result.valid}`,
        passed: result.expired && !result.valid,
    };
}
function fixtureState() {
    return (0, recentSignalWatch_1.createRecentSignalWatch)({
        side: 'SELL',
        zoneId: 'zone-1',
        confidence: 92,
        reason: 'fixture',
        currentTick: 10,
        ttlCandles: 3,
        now,
        tickIntervalMs: 60_000,
    });
}

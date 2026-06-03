"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reactionEngine_1 = require("./reactionEngine");
const reactionFixtures_1 = require("./reactionFixtures");
const results = reactionFixtures_1.reactionFixtures.map(fixture => {
    const actual = summarize((0, reactionEngine_1.evaluateReaction)(fixture.input));
    return {
        name: fixture.name,
        expected: fixture.expected,
        actual,
        passed: stableJson(actual) === stableJson(fixture.expected),
    };
});
for (const result of results) {
    printResult(result);
}
const failed = results.filter(result => !result.passed);
console.log('');
console.log(`ICT reaction fixture tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
function summarize(result) {
    return {
        output: result.output,
        reaction: result.reaction,
        reactionType: result.reactionType,
        reactionWinner: result.reactionWinner,
        reactionScore: result.reactionScore,
        midpointResult: result.midpointResult,
        boundaryCloseResult: result.boundaryCloseResult,
        displacementReaction: result.displacementReaction,
        returnToZone: result.checks.returnToZone.passed,
        midpointInteraction: result.checks.midpointInteraction.passed,
    };
}
function printResult(result) {
    console.log(`Test: ${result.name}`);
    console.log(`Expected: ${stableJson(result.expected)}`);
    console.log(`Actual:   ${stableJson(result.actual)}`);
    console.log(`Result:   ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log('');
}
function stableJson(value) {
    return JSON.stringify(value);
}

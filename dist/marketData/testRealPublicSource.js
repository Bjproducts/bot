"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
const realPublicSource_1 = require("./realPublicSource");
const tests = [
    testDefaultHostFallback(),
    testCustomHost(),
    testUrlGenerationRemainsCorrect(),
    testStartupLimitUsesFiveHundredCandles(),
    testTrailingSlashStripped(),
    testWhitespaceNormalised(),
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
    console.error(`Real-public host tests failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Real-public host tests: ${tests.length}/${tests.length} passed`);
function testDefaultHostFallback() {
    // Empty / undefined env -> normalizeRealPublicHost returns the default,
    // and buildKlineUrl prefixes it correctly.
    const cases = [undefined, '', '   ', null];
    const normalised = cases.map(c => (0, config_1.normalizeRealPublicHost)(c));
    const allDefault = normalised.every(h => h === config_1.DEFAULT_REAL_PUBLIC_HOST);
    const url = (0, realPublicSource_1.buildKlineUrl)((0, config_1.normalizeRealPublicHost)(undefined), 'BTCUSDT', 2);
    const expectedUrl = `${config_1.DEFAULT_REAL_PUBLIC_HOST}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2`;
    return {
        name: 'default host fallback works',
        expected: `all empties -> ${config_1.DEFAULT_REAL_PUBLIC_HOST} and URL=${expectedUrl}`,
        actual: `normalised=${JSON.stringify(normalised)} url=${url}`,
        passed: allDefault && url === expectedUrl,
    };
}
function testCustomHost() {
    const host = (0, config_1.normalizeRealPublicHost)('https://data-api.binance.vision');
    const url = (0, realPublicSource_1.buildKlineUrl)(host, 'BTCUSDT', 2);
    const expectedUrl = 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2';
    return {
        name: 'custom host (data-api.binance.vision) is honoured',
        expected: `normalised=https://data-api.binance.vision and URL=${expectedUrl}`,
        actual: `normalised=${host} url=${url}`,
        passed: host === 'https://data-api.binance.vision' && url === expectedUrl,
    };
}
function testUrlGenerationRemainsCorrect() {
    const url = (0, realPublicSource_1.buildKlineUrl)(config_1.DEFAULT_REAL_PUBLIC_HOST, 'ETHUSDT', 5);
    const expected = 'https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=5';
    return {
        name: 'URL generation: path, symbol, interval, limit unchanged',
        expected,
        actual: url,
        passed: url === expected,
    };
}
function testStartupLimitUsesFiveHundredCandles() {
    const url = (0, realPublicSource_1.buildKlineUrl)(config_1.DEFAULT_REAL_PUBLIC_HOST, 'BTCUSDT', 501);
    const expected = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=501';
    return {
        name: 'startup candle preload requests 500 closed candles plus current open candle',
        expected,
        actual: url,
        passed: url === expected,
    };
}
function testTrailingSlashStripped() {
    const host = (0, config_1.normalizeRealPublicHost)('https://api.binance.com///');
    const url = (0, realPublicSource_1.buildKlineUrl)(host, 'BTCUSDT', 2);
    const expected = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2';
    return {
        name: 'trailing slash(es) on host stripped',
        expected,
        actual: `host=${host} url=${url}`,
        passed: host === 'https://api.binance.com' && url === expected,
    };
}
function testWhitespaceNormalised() {
    const host = (0, config_1.normalizeRealPublicHost)('   https://data-api.binance.vision   ');
    return {
        name: 'whitespace around host is trimmed',
        expected: 'host=https://data-api.binance.vision',
        actual: `host=${host}`,
        passed: host === 'https://data-api.binance.vision',
    };
}

import { DEFAULT_REAL_PUBLIC_HOST, normalizeRealPublicHost } from '../config';
import { buildKlineUrl } from './realPublicSource';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const tests: TestResult[] = [
  testDefaultHostFallback(),
  testCustomHost(),
  testUrlGenerationRemainsCorrect(),
  testTrailingSlashStripped(),
  testWhitespaceNormalised(),
];

let failures = 0;
for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Expected: ${test.expected}`);
  console.log(`Actual:   ${test.actual}`);
  console.log(`Result:   ${test.passed ? 'PASS' : 'FAIL'}\n`);
  if (!test.passed) failures++;
}

if (failures > 0) {
  console.error(`Real-public host tests failed: ${failures}/${tests.length}`);
  process.exit(1);
}

console.log(`Real-public host tests: ${tests.length}/${tests.length} passed`);

function testDefaultHostFallback(): TestResult {
  // Empty / undefined env -> normalizeRealPublicHost returns the default,
  // and buildKlineUrl prefixes it correctly.
  const cases: Array<string | undefined | null> = [undefined, '', '   ', null];
  const normalised = cases.map(c => normalizeRealPublicHost(c));
  const allDefault = normalised.every(h => h === DEFAULT_REAL_PUBLIC_HOST);
  const url = buildKlineUrl(normalizeRealPublicHost(undefined), 'BTCUSDT', 2);
  const expectedUrl = `${DEFAULT_REAL_PUBLIC_HOST}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2`;
  return {
    name: 'default host fallback works',
    expected: `all empties -> ${DEFAULT_REAL_PUBLIC_HOST} and URL=${expectedUrl}`,
    actual: `normalised=${JSON.stringify(normalised)} url=${url}`,
    passed: allDefault && url === expectedUrl,
  };
}

function testCustomHost(): TestResult {
  const host = normalizeRealPublicHost('https://data-api.binance.vision');
  const url = buildKlineUrl(host, 'BTCUSDT', 2);
  const expectedUrl = 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2';
  return {
    name: 'custom host (data-api.binance.vision) is honoured',
    expected: `normalised=https://data-api.binance.vision and URL=${expectedUrl}`,
    actual: `normalised=${host} url=${url}`,
    passed: host === 'https://data-api.binance.vision' && url === expectedUrl,
  };
}

function testUrlGenerationRemainsCorrect(): TestResult {
  const url = buildKlineUrl(DEFAULT_REAL_PUBLIC_HOST, 'ETHUSDT', 5);
  const expected = 'https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=5';
  return {
    name: 'URL generation: path, symbol, interval, limit unchanged',
    expected,
    actual: url,
    passed: url === expected,
  };
}

function testTrailingSlashStripped(): TestResult {
  const host = normalizeRealPublicHost('https://api.binance.com///');
  const url = buildKlineUrl(host, 'BTCUSDT', 2);
  const expected = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2';
  return {
    name: 'trailing slash(es) on host stripped',
    expected,
    actual: `host=${host} url=${url}`,
    passed: host === 'https://api.binance.com' && url === expected,
  };
}

function testWhitespaceNormalised(): TestResult {
  const host = normalizeRealPublicHost('   https://data-api.binance.vision   ');
  return {
    name: 'whitespace around host is trimmed',
    expected: 'host=https://data-api.binance.vision',
    actual: `host=${host}`,
    passed: host === 'https://data-api.binance.vision',
  };
}

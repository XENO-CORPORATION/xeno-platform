/**
 * Run all API integration tests
 *
 * Usage:
 *   node tests/run-all.js                           # Test against production
 *   TEST_API_URL=http://localhost:8080 node tests/run-all.js  # Test locally
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  'health.test.js',
  'auth.test.js',
  'security.test.js',
  'rate-limiting.test.js',
];

const BASE_URL = process.env.TEST_API_URL || 'https://xenostudio.ai';
console.log(`\nRunning all tests against: ${BASE_URL}\n`);

let totalPassed = 0;
let totalFailed = 0;

for (const test of tests) {
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`# ${test}`);
  console.log(`${'#'.repeat(60)}`);

  try {
    execSync(`node "${join(__dirname, test)}"`, {
      env: { ...process.env, TEST_API_URL: BASE_URL },
      stdio: 'inherit',
    });
    totalPassed++;
  } catch (err) {
    totalFailed++;
    console.log(`\n  [${test}] exited with failures\n`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Test suites: ${totalPassed} passed, ${totalFailed} failed out of ${tests.length}`);
console.log(`${'='.repeat(60)}\n`);

process.exit(totalFailed > 0 ? 1 : 0);

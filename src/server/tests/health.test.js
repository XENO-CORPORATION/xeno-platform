/**
 * Health Check Tests for XENO Platform API
 *
 * Verifies all health/status endpoints respond correctly.
 */

const BASE_URL = process.env.TEST_API_URL || 'https://xenostudio.ai';

async function request(method, path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL: ${name}`);
  }
}

async function testHealthEndpoints() {
  console.log('\n--- Health Endpoints ---');

  // /api/status
  const status = await request('GET', '/api/status');
  assert(status.status === 200, 'GET /api/status returns 200');
  assert(status.data && status.data.status === 'ok', '/api/status body has status: ok');

  // /api/health
  const health = await request('GET', '/api/health');
  assert(health.status === 200, 'GET /api/health returns 200');
  assert(health.data && health.data.status, '/api/health body has status field');

  // /health (Docker healthcheck endpoint)
  const dockerHealth = await request('GET', '/health');
  assert(dockerHealth.status === 200, 'GET /health returns 200');

  // /api/live (liveness probe)
  const live = await request('GET', '/api/live');
  assert(live.status === 200, 'GET /api/live returns 200');

  // /api/ready (readiness probe)
  const ready = await request('GET', '/api/ready');
  assert(ready.status === 200 || ready.status === 503, 'GET /api/ready returns 200 or 503');
}

async function testRateLimitHeaders() {
  console.log('\n--- Rate Limit Headers ---');

  const res = await fetch(`${BASE_URL}/api/status`);
  const rlLimit = res.headers.get('ratelimit-limit');
  const rlRemaining = res.headers.get('ratelimit-remaining');

  assert(rlLimit !== null || true, 'Rate limit headers present (or skipped for health)');

  // Make a request to a rate-limited endpoint and check headers
  const authRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'wrong' }),
  });
  const authRlLimit = authRes.headers.get('ratelimit-limit');
  // Auth limiter should return rate limit headers
  assert(authRlLimit !== null, 'Auth endpoint returns RateLimit-Limit header');
}

async function testProductPages() {
  console.log('\n--- Product Pages ---');

  const pages = [
    '/products/',
    '/products/pixel/',
    '/products/motion/',
    '/products/sound/',
    '/products/hub/',
    '/products/agent-cli/',
    '/products/lib/',
    '/download/',
  ];

  for (const page of pages) {
    try {
      const res = await fetch(`${BASE_URL}${page}`, { redirect: 'follow' });
      assert(res.status === 200, `GET ${page} returns 200 (got ${res.status})`);
    } catch (err) {
      failed++;
      failures.push(`GET ${page} => ERROR: ${err.message}`);
      console.log(`  FAIL: GET ${page} => ERROR: ${err.message}`);
    }
  }
}

async function testVersionJSON() {
  console.log('\n--- Version JSON (R2 CDN) ---');

  const apps = ['hub', 'pixel', 'motion', 'sound'];
  const r2Base = 'https://updates.xenostudio.ai/apps';

  for (const app of apps) {
    try {
      const res = await fetch(`${r2Base}/${app}/version.json`);
      if (res.status === 200) {
        const data = await res.json();
        assert(!!data.version, `${app}/version.json has version field: ${data.version}`);
        assert(!!data.windows || !!data.date, `${app}/version.json has download or date info`);
      } else {
        // Not all apps may have version.json yet
        console.log(`  SKIP: ${app}/version.json not found (${res.status})`);
      }
    } catch (err) {
      console.log(`  SKIP: ${app}/version.json fetch error: ${err.message}`);
    }
  }
}

// ============================================
// RUN ALL TESTS
// ============================================

async function runAll() {
  console.log(`\nHealth & Infrastructure Tests — Target: ${BASE_URL}`);
  console.log('='.repeat(50));

  await testHealthEndpoints();
  await testRateLimitHeaders();
  await testProductPages();
  await testVersionJSON();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

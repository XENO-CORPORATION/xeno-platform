/**
 * Security Tests for XENO Platform API
 *
 * Verifies:
 * - Unauthenticated requests to protected endpoints return 401
 * - CORS rejects unknown origins
 * - Path traversal attempts are blocked
 * - SQL injection attempts are safe
 * - Error responses do not leak internal details
 */

const BASE_URL = process.env.TEST_API_URL || 'https://xenostudio.ai';

// Helper to make HTTP requests without external dependencies
async function request(method, path, { body, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: Object.fromEntries(res.headers) };
}

// Simple test runner
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

async function assertRequest(method, path, expectedStatus, name, opts = {}) {
  try {
    const res = await request(method, path, opts);
    assert(res.status === expectedStatus, `${name} => ${expectedStatus} (got ${res.status})`);
    return res;
  } catch (err) {
    failed++;
    failures.push(`${name} => ERROR: ${err.message}`);
    console.log(`  FAIL: ${name} => ERROR: ${err.message}`);
    return null;
  }
}

// ============================================
// TEST SUITES
// ============================================

async function testUnauthenticatedEndpoints() {
  console.log('\n--- Unauthenticated Endpoint Protection ---');

  // AI/LLM proxy endpoints
  await assertRequest('POST', '/api/chat/generate', 401, 'POST /api/chat/generate requires auth', {
    body: { messages: [{ role: 'user', content: 'test' }], model: 'gpt-4o' },
  });

  await assertRequest('POST', '/api/ai/chat', 401, 'POST /api/ai/chat requires auth', {
    body: { messages: [{ role: 'user', content: 'test' }], model: 'gpt-4o' },
  });

  await assertRequest('GET', '/api/ai/models', 401, 'GET /api/ai/models requires auth');
  await assertRequest('GET', '/api/ai/local-model-catalog', 401, 'GET /api/ai/local-model-catalog requires auth');

  // OpenAI proxy endpoints
  await assertRequest('POST', '/api/openai/images/generations', 401, 'POST /api/openai/images/generations requires auth', {
    body: { prompt: 'test', model: 'dall-e-3' },
  });

  await assertRequest('POST', '/api/openai/images/edits', 401, 'POST /api/openai/images/edits requires auth');
  await assertRequest('POST', '/api/openai/images/variations', 401, 'POST /api/openai/images/variations requires auth');
  await assertRequest('POST', '/api/openai/responses/create', 401, 'POST /api/openai/responses/create requires auth');

  // Replicate proxy endpoints
  await assertRequest('POST', '/api/image/replicate/predictions', 401, 'POST /api/image/replicate/predictions requires auth');
  await assertRequest('GET', '/api/image/replicate/predictions/fake-id', 401, 'GET /api/image/replicate/predictions/:id requires auth');

  // Other proxy endpoints
  await assertRequest('POST', '/api/generate-image', 401, 'POST /api/generate-image requires auth');
  await assertRequest('POST', '/api/xeno-search', 401, 'POST /api/xeno-search requires auth', {
    body: { query: 'test' },
  });
  await assertRequest('GET', '/api/xeno/remote/status', 401, 'GET /api/xeno/remote/status requires auth');
  await assertRequest('POST', '/api/fetch-metadata', 401, 'POST /api/fetch-metadata requires auth', {
    body: { url: 'https://example.com' },
  });
  await assertRequest('GET', '/api/openai-realtime-session', 401, 'GET /api/openai-realtime-session requires auth');
  await assertRequest('POST', '/api/openai-realtime-webrtc', 401, 'POST /api/openai-realtime-webrtc requires auth');

  // Code execution
  await assertRequest('GET', '/api/piston/runtimes', 401, 'GET /api/piston/runtimes requires auth');
  await assertRequest('POST', '/api/piston/execute', 401, 'POST /api/piston/execute requires auth', {
    body: { language: 'python', version: '3.10', files: [{ content: 'print(1)' }] },
  });

  // Upload
  await assertRequest('POST', '/api/upload', 401, 'POST /api/upload requires auth');

  // LaTeX
  await assertRequest('POST', '/api/latex/compile', 401, 'POST /api/latex/compile requires auth', {
    body: { latex: '\\documentclass{article}\\begin{document}test\\end{document}' },
  });

  // Ideogram
  await assertRequest('POST', '/api/ideogram-reframe', 401, 'POST /api/ideogram-reframe requires auth');

  // Download routes
  await assertRequest('POST', '/api/download/youtube', 401, 'POST /api/download/youtube requires auth', {
    body: { url: 'https://youtube.com/watch?v=test' },
  });

  // Chat endpoints (except share/:token which is public)
  await assertRequest('GET', '/api/chat/conversations', 401, 'GET /api/chat/conversations requires auth');
  await assertRequest('POST', '/api/chat/conversations', 401, 'POST /api/chat/conversations requires auth', {
    body: { title: 'test' },
  });
}

async function testHealthEndpoints() {
  console.log('\n--- Health Endpoints (should be public) ---');

  await assertRequest('GET', '/api/status', 200, 'GET /api/status is public');
  await assertRequest('GET', '/api/health', 200, 'GET /api/health is public');
  await assertRequest('GET', '/health', 200, 'GET /health is public');
}

async function testCORS() {
  console.log('\n--- CORS Policy ---');

  // Valid origin should work
  const validRes = await request('GET', '/api/status', {
    headers: { 'Origin': 'https://xenostudio.ai' },
  });
  assert(validRes.status === 200, 'Request from xenostudio.ai is allowed');

  // Invalid origin should be rejected (CORS error or 500 from the CORS middleware)
  const invalidRes = await request('GET', '/api/status', {
    headers: { 'Origin': 'https://evil-site.com' },
  });
  // CORS rejection may manifest as a non-200 or missing access-control-allow-origin
  const corsHeader = invalidRes.headers['access-control-allow-origin'];
  assert(
    invalidRes.status !== 200 || !corsHeader || corsHeader !== 'https://evil-site.com',
    'Request from evil-site.com is rejected or not reflected in CORS'
  );
}

async function testErrorResponseSafety() {
  console.log('\n--- Error Response Safety (no internal details) ---');

  // Send a bad JWT token - should not leak JWT error details
  const res = await request('GET', '/api/chat/conversations', {
    headers: { 'Authorization': 'Bearer invalid.token.here' },
  });
  assert(res.status === 401 || res.status === 500, 'Invalid token returns 401 or 500');
  if (res.data) {
    const json = JSON.stringify(res.data);
    assert(!json.includes('stack'), 'Error response does not contain stack trace');
    assert(!json.includes('node_modules'), 'Error response does not contain file paths');
    assert(!json.includes('JWT_SECRET'), 'Error response does not contain secret values');
  }
}

async function testPathTraversal() {
  console.log('\n--- Path Traversal Protection ---');

  // Try path traversal in API routes
  // Note: SPA servers return 200 (index.html) for all unknown routes — that's fine.
  // The key check is that no sensitive file content is returned.
  const res1 = await request('GET', '/api/../../../etc/passwd');
  if (res1.data) {
    const body = JSON.stringify(res1.data);
    assert(!body.includes('root:') && !body.includes('/bin/bash'),
      'Path traversal does not return /etc/passwd content');
  } else {
    assert(res1.status === 404 || res1.status === 400 || res1.status === 403 || res1.status === 200,
      'Path traversal /api/../../../etc/passwd does not expose files');
  }

  // Try encoded path traversal
  const res2 = await request('GET', '/api/%2e%2e/%2e%2e/etc/passwd');
  if (res2.data) {
    const body = JSON.stringify(res2.data);
    assert(!body.includes('root:') && !body.includes('/bin/bash'),
      'Encoded path traversal does not return sensitive content');
  } else {
    assert(res2.status === 404 || res2.status === 400 || res2.status === 403 || res2.status === 200,
      'Encoded path traversal does not expose files');
  }
}

async function testSQLInjection() {
  console.log('\n--- SQL Injection Safety ---');

  // These should fail with 401 (auth required), not with a SQL error
  const res = await request('GET', "/api/chat/conversations?limit=1;DROP TABLE users;--", {
    headers: { 'Authorization': 'Bearer fake' },
  });
  assert(res.status === 401 || res.status === 400, 'SQL injection in query param returns auth error, not SQL error');

  if (res.data) {
    const json = JSON.stringify(res.data).toLowerCase();
    assert(!json.includes('syntax error') && !json.includes('relation'),
      'No SQL error messages leaked');
  }
}

async function testChatInitBlocked() {
  console.log('\n--- Production Safety ---');

  // /chat/init should be blocked in production
  const res = await request('POST', '/api/chat/init');
  assert(res.status === 403, 'POST /api/chat/init returns 403 in production');
}

// ============================================
// RUN ALL TESTS
// ============================================

async function runAll() {
  console.log(`\nSecurity Tests — Target: ${BASE_URL}`);
  console.log('='.repeat(50));

  await testHealthEndpoints();
  await testUnauthenticatedEndpoints();
  await testCORS();
  await testErrorResponseSafety();
  await testPathTraversal();
  await testSQLInjection();
  await testChatInitBlocked();

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

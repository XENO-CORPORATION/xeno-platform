/**
 * Authentication Endpoint Tests for XENO Platform API
 *
 * Tests:
 * - Registration validation
 * - Login flow
 * - Token validation
 * - OAuth redirect endpoints
 */

const BASE_URL = process.env.TEST_API_URL || 'https://xenostudio.ai';

async function request(method, path, { body, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, { ...opts, redirect: 'manual' });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: Object.fromEntries(res.headers) };
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

// ============================================
// TEST SUITES
// ============================================

async function testRegistrationValidation() {
  console.log('\n--- Registration Validation ---');

  // Missing fields
  const res1 = await request('POST', '/api/auth/register', { body: {} });
  assert(res1.status === 400 || res1.status === 429, 'Register with no fields returns validation error (or rate limited)');

  // Missing email
  const res2 = await request('POST', '/api/auth/register', {
    body: { password: 'Test1234!' },
  });
  assert(res2.status === 400 || res2.status === 429, 'Register without email returns validation error (or rate limited)');

  // Missing password
  const res3 = await request('POST', '/api/auth/register', {
    body: { email: 'test@test.com' },
  });
  assert(res3.status === 400 || res3.status === 429, 'Register without password returns validation error (or rate limited)');

  // Invalid email format
  const res4 = await request('POST', '/api/auth/register', {
    body: { email: 'not-an-email', password: 'Test1234!' },
  });
  assert(res4.status === 400 || res4.status === 422 || res4.status === 429, 'Register with invalid email returns error (or rate limited)');
}

async function testLoginValidation() {
  console.log('\n--- Login Validation ---');

  // Missing fields
  const res1 = await request('POST', '/api/auth/login', { body: {} });
  assert(res1.status === 400 || res1.status === 401 || res1.status === 429, 'Login with no fields returns error (or rate limited)');

  // Wrong credentials
  const res2 = await request('POST', '/api/auth/login', {
    body: { email: 'nonexistent@fake.com', password: 'WrongPass123!' },
  });
  assert(res2.status === 401 || res2.status === 400 || res2.status === 429, 'Login with wrong creds returns 401 (or rate limited)');

  // Verify response does not distinguish between wrong email vs wrong password
  if (res2.data) {
    const msg = res2.data.error || res2.data.message || '';
    assert(
      !msg.toLowerCase().includes('user not found') && !msg.toLowerCase().includes('email not found'),
      'Login error does not reveal whether email exists'
    );
  }
}

async function testTokenValidation() {
  console.log('\n--- Token Validation ---');

  // No token
  const res1 = await request('GET', '/api/auth/validate');
  assert(res1.status === 401, 'Validate with no token returns 401');

  // Invalid token
  const res2 = await request('GET', '/api/auth/validate', {
    headers: { 'Authorization': 'Bearer not.a.valid.jwt.token' },
  });
  assert(res2.status === 401, 'Validate with garbage token returns 401');

  // Expired-looking token (signed with wrong secret)
  const res3 = await request('GET', '/api/auth/validate', {
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ0ZXN0In0.fake_signature' },
  });
  assert(res3.status === 401, 'Validate with forged token returns 401');
}

async function testOAuthEndpoints() {
  console.log('\n--- OAuth Endpoints ---');

  // Google OAuth should redirect (302) or return a URL
  const res1 = await request('GET', '/api/auth/google');
  assert(res1.status === 302 || res1.status === 301 || res1.status === 200 || res1.status === 404,
    'GET /api/auth/google returns redirect or error (not 500)');

  // GitHub OAuth
  const res2 = await request('GET', '/api/auth/github');
  assert(res2.status === 302 || res2.status === 301 || res2.status === 200 || res2.status === 404,
    'GET /api/auth/github returns redirect or error (not 500)');
}

async function testRefreshToken() {
  console.log('\n--- Refresh Token ---');

  // No refresh token
  const res1 = await request('POST', '/api/auth/refresh', { body: {} });
  if (res1.status === 404) {
    console.log('  SKIP: /api/auth/refresh endpoint not implemented');
  } else {
    assert(res1.status === 400 || res1.status === 401, 'Refresh with no token returns error');

    // Invalid refresh token
    const res2 = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: 'invalid-refresh-token' },
    });
    assert(res2.status === 401 || res2.status === 400, 'Refresh with invalid token returns error');
  }
}

// ============================================
// RUN ALL TESTS
// ============================================

async function runAll() {
  console.log(`\nAuth Tests — Target: ${BASE_URL}`);
  console.log('='.repeat(50));

  await testRegistrationValidation();
  await testLoginValidation();
  await testTokenValidation();
  await testOAuthEndpoints();
  await testRefreshToken();

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

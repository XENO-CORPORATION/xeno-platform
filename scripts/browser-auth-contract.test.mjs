import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { browserSessionMiddleware, browserSessionCookies } from '../src/server/middleware/browserSession.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('browser bearer survives only as a one-release memory migration', () => {
  const authSession = read('src/lib/authSession.ts');
  assert.match(authSession, /localStorage\.removeItem\(LEGACY_TOKEN_KEY\)/);
  assert.doesNotMatch(authSession, /localStorage\.setItem\(LEGACY_TOKEN_KEY/);

  const persistedReaders = [
    'src/services/authService.ts',
    'src/contexts/AuthContext.tsx',
    'src/pages/Onboarding.tsx',
    'src/server/routes/oauth2Routes.js',
  ].map(read).join('\n');
  assert.doesNotMatch(persistedReaders, /localStorage\.(?:getItem|setItem)\([^)]*xenoos_auth_token/);
});

test('web OAuth redirects do not put credentials in the URL', () => {
  const source = read('src/server/routes/authRoutes.js');
  assert.match(source, /if \(dest\.startsWith\("xeno:\/\/"\)\)[\s\S]*token=\$\{token\}/);
  assert.match(source, /Web auth is cookie-backed/);
  assert.doesNotMatch(source, /return `\$\{FRONTEND_URL\}\$\{dest\}\$\{sep\}token=/);
  assert.doesNotMatch(source, /stateless fallback|return generateToken\(user\)/,
    'session persistence failure must never mint an unrevokable fallback credential');
});

test('CLI authorization pages use opaque browser sessions and CSRF, never browser bearer storage', () => {
  for (const path of ['public/cli-auth/index.html', 'public/cli-auth/device/index.html']) {
    const source = read(path);
    assert.doesNotMatch(source, /localStorage|xeno_token|qs\.get\(['"]token['"]\)|Bearer\s+['"]?\s*\+|headers\[['"]Authorization['"]\]/,
      `${path} must not read, store, or send browser bearer credentials`);
    assert.match(source, /x-xeno-session-mode['"]\s*:\s*['"]browser/);
    assert.match(source, /x-xeno-csrf/);
    assert.match(source, /credentials:\s*['"]same-origin['"]/);
    assert.match(source, /\/api\/auth\/me/);
  }
});

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('opaque cookie auth injects only a process-local bearer and enforces CSRF', async () => {
  const session = 'opaque-session-secret';
  const csrf = 'csrf-secret';
  const pool = {
    async query(_sql, values) {
      assert.equal(values[0], digest(session));
      return { rows: [{ sid: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', csrf_hash: digest(csrf) }] };
    },
  };
  const middleware = browserSessionMiddleware(pool);

  const rejected = responseRecorder();
  await middleware({
    method: 'POST', headers: { cookie: `${browserSessionCookies.session}=${session}; ${browserSessionCookies.csrf}=${csrf}` },
    get: () => 'wrong-csrf',
  }, rejected, () => assert.fail('bad CSRF must not reach the route'));
  assert.equal(rejected.statusCode, 403);

  const req = {
    method: 'POST', headers: { cookie: `${browserSessionCookies.session}=${session}; ${browserSessionCookies.csrf}=${csrf}` },
    get: (name) => name.toLowerCase() === 'x-xeno-csrf' ? csrf : undefined,
  };
  let reached = false;
  await middleware(req, responseRecorder(), () => { reached = true; });
  assert.equal(reached, true);
  assert.match(req.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(req.browserSession.userId, '22222222-2222-4222-8222-222222222222');
});

test('browser session persistence is migration-owned and mounted before auth routes', () => {
  assert.match(read('src/server/database/migrations/20260903090000-browser-bff-sessions.sql'), /CREATE TABLE IF NOT EXISTS browser_session_state/);
  const server = read('src/server/index.js');
  assert.ok(server.indexOf("app.use('/api/', browserSessionMiddleware(pool))") < server.indexOf("app.use('/api/auth', databaseMiddleware, authRoutes)"));
});

test('local frontend can qualify against a local backend without exposing its target', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /process\.env\.XENO_DEV_API_TARGET\?\.trim\(\)/);
  assert.match(vite, /developmentApiTarget[\s\S]*https:\/\/xenostudio\.ai/);
  assert.doesNotMatch(vite, /VITE_XENO_DEV_API_TARGET/);
  assert.match(read('.env.example'), /XENO_DEV_API_TARGET=http:\/\/127\.0\.0\.1:8090/);
});

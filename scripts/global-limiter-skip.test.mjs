// The global /api/ limiter must never count nginx's site-gate subrequest, or a busy minute turns every page into
// nginx's 500 (live, 2026-10-23). Proven through express-rate-limit itself, mounted exactly as index.js mounts it,
// so the req.path-stripping that made the old health-check skip a no-op is part of what is tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { globalLimiterSkips } from '../src/server/utils/globalLimiterSkip.js';
// the server's own copies, so the limiter under test is the version production runs
const serverRequire = createRequire(new URL('../src/server/package.json', import.meta.url));
const express = serverRequire('express');
const rateLimitMod = serverRequire('express-rate-limit');
const rateLimit = rateLimitMod.rateLimit || rateLimitMod.default || rateLimitMod;

async function serve() {
  const app = express();
  app.use('/api/', rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false, skip: (req) => globalLimiterSkips(req.baseUrl + req.path) }));
  app.get('/api/site-gate/check', (_q, r) => r.status(204).end());
  app.get('/api/status', (_q, r) => r.json({ ok: true }));
  app.get('/api/other', (_q, r) => r.json({ ok: true }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  return { s, url: (p) => `http://127.0.0.1:${s.address().port}${p}` };
}

test('the site-gate check and the status probe are never rate-limited; everything else is', async () => {
  const { s, url } = await serve();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(url('/api/site-gate/check'))).status, 204, `check #${i + 1}`);
    for (let i = 0; i < 5; i++) assert.equal((await fetch(url('/api/status'))).status, 200, `status #${i + 1}`);
    assert.equal((await fetch(url('/api/other'))).status, 200);
    assert.equal((await fetch(url('/api/other'))).status, 429, 'an ordinary route is still limited');
  } finally { s.close(); }
});

test('index.js wires the skip with the FULL path', () => {
  const src = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.match(src, /skip:\s*\(req\)\s*=>\s*globalLimiterSkips\(req\.baseUrl \+ req\.path\)/);
});

test('OIDC keys, discovery and token survive 201 calls to another route; token has its own failure-only bucket', async () => {
  const { oauthTokenLimiterOptions } = await import('../src/server/utils/globalLimiterSkip.js');
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/', rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, skip: (req) => globalLimiterSkips(req.baseUrl + req.path) }));
  app.post('/api/oauth2/token', rateLimit({ ...oauthTokenLimiterOptions(() => 'ip'), max: 2 }));
  app.post('/api/oauth2/token', (q, r) => (q.body.ok ? r.json({ access_token: 'x' }) : r.status(400).json({ error: 'invalid_grant' })));
  for (const p of ['/api/oauth2/jwks', '/api/oauth2/.well-known/openid-configuration']) app.get(p, (_q, r) => r.json({}));
  app.get('/api/other', (_q, r) => r.json({ ok: true }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const url = (p) => `http://127.0.0.1:${s.address().port}${p}`;
  const tok = (body) => fetch(url('/api/oauth2/token'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  try {
    for (let i = 0; i < 201; i++) await fetch(url('/api/other'));
    assert.equal((await fetch(url('/api/other'))).status, 429, 'the shared bucket is spent');
    assert.equal((await fetch(url('/api/oauth2/jwks'))).status, 200);
    assert.equal((await fetch(url('/api/oauth2/.well-known/openid-configuration'))).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await tok('ok=1&client_id=a')).status, 200, `success #${i + 1} is never counted`);
    assert.equal((await tok('client_id=a')).status, 400);
    assert.equal((await tok('client_id=a')).status, 400);
    assert.equal((await tok('client_id=a')).status, 429, 'failures are limited');
    assert.equal((await tok('ok=1&client_id=b')).status, 200, 'another client is a different bucket');
  } finally { s.close(); }
});

// The site gate: who sees the site while SITE_GATE=on (routes/siteGateRoutes.js), and that nginx gates pages but
// never the API, OAuth, assets, the install script or the sign-in/legal pages (nginx/default.conf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createSiteGateRouter, gateCookieValid, hasSiteAccess, mintGateCookie, parseAllow } from '../src/server/routes/siteGateRoutes.js';

const allow = parseAllow(' @xenosystem.ai, Friend@Example.com ,');
test('access: admins and the allowlist only; signed in alone is not access', () => {
  assert.equal(hasSiteAccess({ email: 'a@xenosystem.ai', role: 'user', is_active: true }, allow), true);
  assert.equal(hasSiteAccess({ email: 'friend@example.com', role: 'user', is_active: true }, allow), true);
  assert.equal(hasSiteAccess({ email: 'x@other.com', role: 'admin', is_active: true }, allow), true);
  assert.equal(hasSiteAccess({ email: 'stranger@gmail.com', role: 'user', is_active: true }, allow), false);
  assert.equal(hasSiteAccess({ email: 'a@xenosystem.ai.evil.com', role: 'user', is_active: true }, allow), false);
  assert.equal(hasSiteAccess({ email: 'a@xenosystem.ai', role: 'admin', is_active: false }, allow), false, 'suspended never passes');
  assert.equal(hasSiteAccess(undefined, allow), false);
});

async function harness(env, { userId, row, throws, attempt } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => { req.browserSession = userId ? { userId } : undefined;
    req.db = { query: async () => { if (throws) throw new Error('db down'); return { rows: row ? [row] : [] }; } }; n(); });
  app.use('/api/site-gate', createSiteGateRouter({ env, attempt }));
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}/api/site-gate`;
  return {
    get: (cookie) => fetch(base + '/check', { headers: cookie ? { cookie } : {} }),
    post: (path, body, cookie) => fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body || {}),
    }),
    close: () => s.close(),
  };
}
async function ask(env, opts) { const h = await harness(env, opts); try { return (await h.get()).status; } finally { h.close(); } }

test('the check: off is open to all, on refuses strangers and fails closed', async () => {
  assert.equal(await ask({}), 204);
  const on = { SITE_GATE: 'on', SITE_GATE_ALLOW: '@xenosystem.ai' };
  assert.equal(await ask(on), 401);
  assert.equal(await ask(on, { userId: 'u', row: { email: 'me@xenosystem.ai', role: 'user', is_active: true } }), 204);
  assert.equal(await ask(on, { userId: 'u', row: { email: 'me@gmail.com', role: 'user', is_active: true } }), 401);
  assert.equal(await ask(on, { userId: 'u', throws: true }), 401, 'an error never opens the site');
});

// ── The access code (owner, 2026-10-18: "if the user has the access code he gets access further") ──────────────
const CODE_ENV = { SITE_GATE: 'on', SITE_GATE_CODE: 'xeno-preview-2026', SITE_GATE_SECRET: 'test-secret', NODE_ENV: 'test' };

test('unlock: the right code issues a cookie, the wrong one does not, and neither needs an account', async () => {
  const h = await harness(CODE_ENV);
  try {
    assert.equal((await h.get()).status, 401, 'no cookie, no session: refused');
    assert.equal((await h.post('/unlock', { code: 'nope' })).status, 401);
    const ok = await h.post('/unlock', { code: 'xeno-preview-2026' });
    assert.equal(ok.status, 204);
    const cookie = ok.headers.getSetCookie()[0].split(';')[0];
    assert.match(cookie, /^xeno_gate=v1\.\d+\./);
    assert.match(ok.headers.getSetCookie()[0], /HttpOnly/i);
    assert.equal((await h.get(cookie)).status, 204, 'the cookie alone opens the pages: no session needed');
    assert.equal((await h.get('xeno_gate=v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status, 401, 'forged cookie refused');
  } finally { h.close(); }
});
test('unlock: no session is ever required, but the gate being off means there is nothing to unlock', async () => {
  const h = await harness({ ...CODE_ENV, SITE_GATE: 'off' });
  try {
    const r = await h.post('/unlock', { code: '' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.getSetCookie().length, 0, 'off issues no cookie');
  } finally { h.close(); }
  const none = await harness({ SITE_GATE: 'on', SITE_GATE_SECRET: 's' });
  try { assert.equal((await none.post('/unlock', { code: 'anything' })).status, 401, 'no shared code and no personal code matches: refused'); } finally { none.close(); }
});
test('unlock: attempts are limited per address so the code cannot be guessed', async () => {
  const h = await harness(CODE_ENV);
  try {
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await h.post('/unlock', { code: `guess-${i}` })).status);
    assert.deepEqual(codes, Array(10).fill(401));
    assert.equal((await h.post('/unlock', { code: 'xeno-preview-2026' })).status, 429, 'the right code is refused too once the ceiling is hit');
  } finally { h.close(); }
});
test('cookie: expired, rotated-code and wrong-secret cookies are refused', () => {
  const secret = 's';
  const now = 1_800_000_000_000;
  const good = mintGateCookie('code-a', secret, now);
  assert.equal(gateCookieValid(good, 'code-a', secret, now), true);
  assert.equal(gateCookieValid(good, 'code-a', secret, now + 8 * 86400_000), false, 'expired after 7 days');
  assert.equal(gateCookieValid(good, 'code-b', secret, now), false, 'rotating the code invalidates issued cookies');
  assert.equal(gateCookieValid(good, 'code-a', 'other', now), false, 'another secret cannot sign it');
  assert.equal(gateCookieValid(good, '', secret, now), false, 'no code configured means no cookie access');
  assert.equal(mintGateCookie('', secret, now), null);
  assert.equal(gateCookieValid('v1.1.x', 'code-a', secret, now), false);
});

const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
const block = (head) => { const i = conf.indexOf(head); assert.ok(i >= 0, `missing: ${head}`); return conf.slice(i, conf.indexOf('\n    }', i)); };
test('nginx gates the pages, and only the pages', () => {
  for (const head of ['    location / {', '    location ^~ /workspace/ {', '    location ~ ^/product/[^/]+/download/[^/]+ {', '    location ~ "^/a/a_']) {
    assert.match(block(head), /auth_request \/__site_gate;[\s\S]*error_page 401 = \/coming-soon\.html;/, `${head} must be gated`);
  }
  for (const head of ['    location /api/ {', '    location = /install/spawn.ps1 {', String.raw`    location ~* \.(js|css|png`, '    location = /coming-soon.html {', '    location ~ ^/(account/connected|login|signup']) {
    assert.doesNotMatch(block(head), /auth_request/, `${head} must never be gated`);
  }
  assert.match(block('    location = /__site_gate {'), /internal;[\s\S]*\/api\/site-gate\/check/);
});

// REGRESSION, 2026-10-18: the sign-in bypass must be a NAMED location. `try_files … /index.html` is an internal
// redirect that re-runs location matching, so it lands in `location /` and gets gated — /login then served
// "Coming soon" and nobody, the owner included, could sign in to a site whose access needs a sign-in.
test('the sign-in bypass never falls back through the gated location', () => {
  for (const head of ['    location ~ ^/(account/connected|login|signup', '    location ~ ^/product/[^/]+/privacy']) {
    const b = block(head);
    assert.doesNotMatch(b, /try_files[^;]*\s\/index\.html;/, `${head} must not internal-redirect to /index.html`);
    assert.match(b, /@spa_shell;/, `${head} must fall back to the ungated shell`);
  }
  const shell = block('    location @spa_shell {');
  assert.doesNotMatch(shell, /auth_request/, '@spa_shell must never be gated');
  assert.match(shell, /try_files \/index\.html =404;/);
});

// REGRESSION, 2026-10-18: robots.txt answered with the "Coming soon" page while the gate was on - a crawler
// contract served as HTML - because .txt is not in the static-asset rule and fell into `location /`. The same
// hole would swallow a .mp4 or a .otf. Crawler files must be exact, ungated and uncached; media must be static.
test('crawler files and media answer as themselves behind the gate', () => {
  const robots = block('    location = /robots.txt {');
  assert.doesNotMatch(robots, /auth_request/, 'robots.txt must never be gated');
  assert.match(robots, /expires -1;/, 'robots.txt must not be pinned like a hashed asset');
  const sitemap = block('    location = /sitemap.xml {');
  assert.match(sitemap, /return 404;/, 'the disabled sitemap stays a true 404, never HTML');
  assert.match(block(String.raw`    location ~* \.(js|css|png`), /\|otf\|.*\|mp4\|webm\|/, 'media and fonts are static files');
});

// 2026-10-18 audit fixes.
test('OAuth signup keeps the invitation across hosts: captured at the start, honoured at the callback', () => {
  // Google/GitHub/X return to the callback on xenostudio.ai, where a __Host- gate cookie set on xenosystem.ai is never
  // sent. So the invite rides the server-side OAuth state: every start stores it, every callback reads it back.
  const auth = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const starts = auth.match(/await storeOAuthState\(state, \{[\s\S]*?\}\);/g) || [];
  assert.ok(starts.length >= 3, 'every OAuth provider start stores state');
  for (const st of starts) assert.match(st, /gateInvite: hasGateInvite\(req\.headers\.cookie\)/);
  const consumes = (auth.match(/const stateData = await consumeOAuthState\(state\);/g) || []).length;
  const reads = (auth.match(/req\.oauthGateInvite = stateData\.gateInvite === true;/g) || []).length;
  assert.equal(consumes, starts.length);
  assert.equal(reads, consumes, 'every OAuth callback reads the captured invite back');
  assert.match(auth, /req\?\.oauthGateInvite === true && process\.env\.SITE_GATE === 'on'/, 'a captured invite still needs the gate on');
});
test('Coming soon is the v21 design, and its code field has no floating focus stroke', () => {
  const page = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  // Home v21's own values (public/home-v21/index.html root): grey ramp, plate, 7px control radius.
  for (const token of ['#060606', '#090909', '#1e1e1e', '#d9d9d9', 'IBM Plex Sans', 'JetBrains Mono']) {
    assert.ok(page.includes(token), `coming-soon must carry the v21 token ${token}`);
  }
  assert.doesNotMatch(page, /input:focus\s*\{\s*outline/, 'focus on the code field is border only, never an outline outside it');
  assert.match(page, /\.code input:focus \{ border-color:/);
});
test('/access is the shareable code entry, and a code in the link unlocks on arrival', () => {
  const nginx = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
  assert.match(nginx, /location = \/access \{ return 302 \/\?access=1; \}/);
  const page = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  assert.match(page, /id="codebox"/);
  assert.match(page, /URLSearchParams\(window\.location\.search\)\.get\('code'\)/, 'a ?code= link fills the form');
  assert.match(page, /unlock\(linked\.trim\(\)\)/, 'and unlocks through the same POST /unlock as typing it');
  assert.match(page, /window\.location\.replace\('\/'\)/, 'success leaves for the homepage, code out of the address bar');
  assert.doesNotMatch(page, /fetch\('\/api\/site-gate\/(?!unlock)/, 'no second unlock door');
});
test('Coming soon sends the CSRF half, so a signed-in visitor can still enter the code', () => {
  const page = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  assert.match(page, /xeno_csrf=/);
  assert.match(page, /headers\['x-xeno-csrf'\]/);
});
test('the attempt limiter refuses past the limit and does not grow without bound', async () => {
  const { createAttemptLimiter } = await import('../src/server/routes/siteGateRoutes.js');
  let t = 0; const take = createAttemptLimiter({ max: 2, windowMs: 10, now: () => t });
  assert.equal(take('a'), true); assert.equal(take('a'), true); assert.equal(take('a'), false);
  t = 11; assert.equal(take('a'), true, 'a new window opens');
  for (let i = 0; i < 10_050; i++) take(`ip${i}`);
  t = 1000; take('fresh');
  // after expiry, the next call over the size threshold drops the stale windows
  for (let i = 0; i < 2; i++) take(`late${i}`);
});

// 2026-10-20: www.xenosystem.ai asked again for access because the __Host- gate cookie is per host. One host instead.
test('www.xenosystem.ai redirects every address to the apex, keeping path and query, and keeps POSTs as POSTs', () => {
  const i = conf.indexOf('server_name www.xenosystem.ai;');
  assert.ok(i >= 0, 'a server block for www exists');
  const srv = conf.slice(i, conf.indexOf('\n}', i));
  assert.match(srv, /location \/ \{ return 301 https:\/\/xenosystem\.ai\$request_uri; \}/);
  assert.match(srv, /location \/api\/ \{ return 308 https:\/\/xenosystem\.ai\$request_uri; \}/, 'the API keeps its method');
  assert.doesNotMatch(srv, /auth_request|proxy_pass|try_files/, 'www serves nothing of its own');
});

// Per-person codes (services/siteAccessCodes.js), with a stub store; the real-Postgres proof is
// src/server/tests/site-access-codes.test.mjs.
test('a personal code: cookie names the code, revoking it refuses the cookie, account scope invites signup', async () => {
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const live = new Map([[A, true], [B, true]]);
  const codes = {
    countryOf: () => null,
    redeemCode: async (_db, typed) => (typed === 'XENO-GOOD' ? { id: A, scope: 'account', expiresAt: new Date(Date.now() + 86400_000) }
      : typed === 'XENO-PAGES' ? { id: B, scope: 'pages', expiresAt: new Date(Date.now() + 86400_000) } : null),
    codeIsLive: async (_db, id) => live.get(id) === true,
    noteAccount: async () => {},
  };
  const env = { SITE_GATE: 'on', SITE_GATE_SECRET: 'sec', NODE_ENV: 'test' };
  const app = express(); app.use(express.json());
  app.use((req, _r, n) => { req.db = {}; n(); });
  app.use('/g', createSiteGateRouter({ env, codes, staffGuard: [(_q, r) => r.status(403).end()] }));
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}/g`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  const check = (c) => fetch(base + '/check', { headers: { cookie: c } }).then((r) => r.status);
  try {
    assert.equal((await post('/unlock', { code: 'XENO-BAD' })).status, 401);
    const acc = await post('/unlock', { code: 'XENO-GOOD' });
    assert.equal(acc.status, 200);
    const set = acc.headers.getSetCookie();
    const gate = set.find((c) => c.startsWith('xeno_gate=')).split(';')[0];
    assert.match(gate, /^xeno_gate=v2\.\d+\.11111111-/);
    assert.ok(set.some((c) => c.startsWith('xeno_share_invite=v1.')), 'account scope carries the signup invitation');
    const pages = await post('/unlock', { code: 'XENO-PAGES' });
    assert.ok(!pages.headers.getSetCookie().some((c) => c.startsWith('xeno_share_invite=')), 'pages scope never invites signup');
    assert.equal(await check(gate), 204);
    live.set(A, false); // revoked or expired
    assert.equal(await check(gate), 401, 'a revoked code shuts the browsers it opened');
    live.set(A, true);
    assert.equal(await check(gate.slice(0, -2) + (gate.endsWith('AA') ? 'BB' : 'AA')), 401, 'tampered cookie refused');
    assert.equal((await post('/codes', { label: 'x' })).status, 403, 'the console is behind the staff guard');
    assert.equal((await fetch(base + '/codes')).status, 403);
  } finally { s.close(); }
});
test('the console routes sit behind authMiddleware + requireAdmin by default', () => {
  const src = readFileSync(new URL('../src/server/routes/siteGateRoutes.js', import.meta.url), 'utf8');
  assert.match(src, /staffGuard = \[authMiddleware, requireAdmin\]/);
  for (const r of ["get('/codes', ...staffGuard", "post('/codes', ...staffGuard", "get('/codes/:id/events', ...staffGuard", "post('/codes/:id/revoke', ...staffGuard"]) assert.ok(src.includes(r), `${r} guarded`);
});

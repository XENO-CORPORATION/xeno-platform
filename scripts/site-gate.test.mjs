// The site gate: who sees the site while SITE_GATE=on (routes/siteGateRoutes.js), and that nginx gates pages but
// never the API, OAuth, assets, the install script or the sign-in/legal pages (nginx/default.conf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createSiteGateRouter, hasSiteAccess, parseAllow } from '../src/server/routes/siteGateRoutes.js';

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

async function ask(env, { userId, row, throws } = {}) {
  const app = express();
  app.use((req, _r, n) => { req.browserSession = userId ? { userId } : undefined;
    req.db = { query: async () => { if (throws) throw new Error('db down'); return { rows: row ? [row] : [] }; } }; n(); });
  app.use('/api/site-gate', createSiteGateRouter({ env }));
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  try { return (await fetch(`http://127.0.0.1:${s.address().port}/api/site-gate/check`)).status; } finally { s.close(); }
}
test('the check: off is open to all, on refuses strangers and fails closed', async () => {
  assert.equal(await ask({}), 204);
  const on = { SITE_GATE: 'on', SITE_GATE_ALLOW: '@xenosystem.ai' };
  assert.equal(await ask(on), 401);
  assert.equal(await ask(on, { userId: 'u', row: { email: 'me@xenosystem.ai', role: 'user', is_active: true } }), 204);
  assert.equal(await ask(on, { userId: 'u', row: { email: 'me@gmail.com', role: 'user', is_active: true } }), 401);
  assert.equal(await ask(on, { userId: 'u', throws: true }), 401, 'an error never opens the site');
});

const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
const block = (head) => { const i = conf.indexOf(head); assert.ok(i >= 0, `missing: ${head}`); return conf.slice(i, conf.indexOf('\n    }', i)); };
test('nginx gates the pages, and only the pages', () => {
  for (const head of ['    location / {', '    location ^~ /workspace/ {', '    location ~ ^/product/[^/]+/download/[^/]+ {', '    location ~ "^/a/a_']) {
    assert.match(block(head), /auth_request \/__site_gate;[\s\S]*error_page 401 = \/coming-soon\.html;/, `${head} must be gated`);
  }
  for (const head of ['    location /api/ {', '    location = /install/spawn.ps1 {', String.raw`    location ~* \.(js|css|png`, '    location = /coming-soon.html {', '    location ~ ^/(login|signup']) {
    assert.doesNotMatch(block(head), /auth_request/, `${head} must never be gated`);
  }
  assert.match(block('    location = /__site_gate {'), /internal;[\s\S]*\/api\/site-gate\/check/);
});

// REGRESSION, 2026-10-18: the sign-in bypass must be a NAMED location. `try_files … /index.html` is an internal
// redirect that re-runs location matching, so it lands in `location /` and gets gated — /login then served
// "Coming soon" and nobody, the owner included, could sign in to a site whose access needs a sign-in.
test('the sign-in bypass never falls back through the gated location', () => {
  for (const head of ['    location ~ ^/(login|signup', '    location ~ ^/product/[^/]+/privacy']) {
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

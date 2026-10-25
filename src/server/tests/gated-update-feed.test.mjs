/**
 * The gated update feed, end to end against a real Postgres (owner, 2026-10-25: nobody without a plan downloads or
 * updates). Proves the ALLOWED path, which an installed app depends on — if it broke, every install on a version that
 * updates only through this feed could never update again:
 *
 *   - an account with an active plan gets the feed; every installer URL is the grant-checked download route for the
 *     released version, and sha512/size are what was published
 *   - that URL, resolved against the feed URL exactly as electron-updater's generic provider resolves it, redirects
 *     to the installer bytes
 *   - an account without a plan is refused before anything is read, and a grant for another version opens nothing
 *   - no token: 401
 *
 *   node src/server/tests/gated-update-feed.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'gated-feed-test-secret';

// A stand-in R2: releases.json + latest.yml + the installer, exactly the shapes the publisher writes.
const INSTALLER = 'v0.5.15/XENO Browser Setup 0.5.15.exe';
const r2 = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/apps/browser/releases.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ releases: [{ version: '0.5.15', channel: 'stable', latest: true, assets: { windows: [{ file: INSTALLER }] } }] })); }
  if (p === '/apps/browser/latest.yml') return res.end(`version: 0.5.15\nfiles:\n  - url: ${INSTALLER}\n    sha512: SHA==\n    size: 116459480\npath: ${INSTALLER}\nsha512: SHA==\nreleaseDate: '2026-10-25T00:00:00.000Z'\n`);
  if (p === `/apps/browser/${INSTALLER}`) return res.end('installer-bytes');
  res.statusCode = 404; res.end();
});
await new Promise((r) => r2.listen(0, '127.0.0.1', r));
process.env.XENO_UPDATES_BASE = `http://127.0.0.1:${r2.address().port}`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { authMiddleware } = await import('../middleware/auth.js');
const routes = await import('../routes/productDownloadRoutes.js');
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

try {
  await runAllMigrations(pool);
  const mk = async (name) => { const m = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`])).rows[0].id; };
  const paid = await mk('feed-paid'), free = await mk('feed-free');
  await pool.query(`INSERT INTO xeno_account_plans (user_id, plan, status, current_period_end) VALUES ($1, 'pro', 'active', now() + interval '30 days')`, [String(paid)]);
  const token = (id) => jwt.sign({ userId: id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  const app = express();
  app.use((req, _r, n) => { req.db = pool; n(); });
  app.use('/api/updates', authMiddleware, routes.updateGrantRouter);
  app.use('/product', routes.default);
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const feedUrl = `${base}/api/updates/browser/feed`;          // what @xenosystem/primitives/updates sets
  try {
    check((await fetch(`${feedUrl}/latest.yml`)).status === 401, 'no token: 401');
    const refused = await fetch(`${feedUrl}/latest.yml`, { headers: { Authorization: `Bearer ${token(free)}` } });
    const refusedBody = await refused.text();
    check(refused.status === 403 && !refusedBody.includes('0.5.15'), 'no plan: refused, and the refusal names no version');

    const ok = await fetch(`${feedUrl}/latest.yml?noCache=abc`, { headers: { Authorization: `Bearer ${token(paid)}` } });
    const feed = await ok.text();
    check(ok.status === 200 && /^version: 0\.5\.15$/m.test(feed), 'a plan gets the feed for the released version');
    check((feed.match(/sha512: SHA==/g) || []).length === 2 && feed.includes('size: 116459480'), 'the checksum and size are what was published');
    const urls = [...feed.matchAll(/^\s*(?:-\s+)?(?:url|path):\s*'([^']+)'$/gm)].map((m) => m[1]);
    check(urls.length === 2 && urls.every((u) => u.startsWith('/product/browser/download/win/0.5.15?grant=')), 'every installer URL is the grant route for that version');

    // electron-updater's generic provider: new URL(fileUrl, `${feedUrl}/`)
    const resolved = new URL(urls[0], `${feedUrl}/`).toString();
    const dl = await fetch(resolved, { redirect: 'manual' });
    check(dl.status === 302 && decodeURIComponent(dl.headers.get('location') || '').endsWith(`/apps/browser/${INSTALLER}`), 'resolved as the updater resolves it, the grant redirects to the installer');
    check((await (await fetch(resolved)).text()) === 'installer-bytes', 'and the bytes arrive');

    const wrong = new URL(urls[0].replace('/0.5.15?', '/0.5.14?'), `${feedUrl}/`).toString();
    check((await fetch(wrong, { redirect: 'manual' })).status === 401, 'a grant for one version opens no other');
    const audit = await pool.query(`SELECT count(*)::int AS n FROM download_grants WHERE user_id = $1 AND slug = 'browser' AND version = '0.5.15'`, [paid]);
    check(audit.rows[0].n === 1, 'the grant is audited once');
    console.log(`\ngated-update-feed: ${passed} passed`);
  } finally { s.close(); }
} finally { r2.close(); await pool.end(); }

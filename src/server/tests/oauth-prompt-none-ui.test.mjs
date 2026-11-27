/**
 * The silent check, prompt=none (OIDC Core §3.1.2.1), in a real browser against the real authorize page and a real
 * Postgres. The product hosts (chat., tasks., tools. …) use it so a person signed in on xenosystem.ai is signed in there
 * with no click (owner, 2026-11-27: "not logged in even if I should have been already logged in").
 *
 *   - no session: the page never shows a form and never goes to /login; it answers the client's registered
 *     redirect_uri with error=login_required and the same state
 *   - a session: the page issues a code and goes to the redirect_uri with it, exactly as without prompt
 *   - prompt=select_account (any other value) is still refused, with no redirect
 *
 *   node src/server/tests/oauth-prompt-none-ui.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const CB = 'https://tools.xenosystem.ai/api/auth/host/callback';

await runAllMigrations(pool);
await migrateAccountV2(pool);
await migrateOidcClients(pool);
const { default: oauth2Routes } = await import('../routes/oauth2Routes.js');
const { default: authRoutes } = await import('../routes/authRoutes.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, _res, next) => { req.db = pool; next(); });
app.use('/api/', browserSessionMiddleware(pool)); // as index.js mounts it: the session cookie becomes the caller
app.use('/api/oauth2', oauth2Routes);
app.use('/api/auth', authRoutes);
app.get('/login', (_req, res) => res.type('html').send('<title>login form</title>'));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const tag = `pn${Date.now().toString(36)}`;
const password = crypto.randomBytes(18).toString('base64url'); // a local test account in a disposable database
const email = `${tag}@xeno.test`;
await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,'P',true,true,$3,NOW())`,
  [tag, email, await bcrypt.hash(password, 10)]);

const authorizeUrl = (prompt, state) => {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ client_id: 'xeno-tools-web', response_type: 'code', redirect_uri: CB, scope: 'openid profile email', state, code_challenge: challenge, code_challenge_method: 'S256', prompt });
  return `${base}/api/oauth2/authorize?${q}`;
};

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  let landed = null, sawLogin = false;
  page.on('request', (q) => {
    const u = q.url();
    if (u.startsWith(CB)) { landed = new URL(u); return q.respond({ status: 200, contentType: 'text/html', body: 'callback' }); }
    if (new URL(u).pathname === '/login') sawLogin = true;
    return q.continue();
  });
  page.on('response', (r) => { if (process.env.DEBUG) console.log('    RESP', r.request().method(), r.status(), r.url().slice(0, 90)); });
  page.on('console', (m) => { if (process.env.DEBUG) console.log('    CONSOLE', m.text().slice(0, 200)); });
  const waitLanded = async () => { for (let i = 0; i < 100 && !landed; i++) await new Promise((r) => setTimeout(r, 100)); return landed; };

  // 1. no session
  await page.goto(authorizeUrl('none', 'st-a'), { waitUntil: 'domcontentloaded' });
  const a = await waitLanded();
  check(!!a && a.searchParams.get('error') === 'login_required' && a.searchParams.get('state') === 'st-a' && !a.searchParams.get('code'),
    'no session: answered on the redirect_uri with error=login_required and the same state');
  check(!sawLogin, 'and no login form was shown');

  // 2. a session (signed in on this origin, as a person is on xenosystem.ai)
  landed = null;
  // the real login route, then its cookies handed to the browser as they would be on xenosystem.ai
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-xeno-surface': 'xeno-web', 'x-xeno-session-mode': 'browser' }, body: JSON.stringify({ email, password }) });
  const set = login.headers.getSetCookie().map((c) => c.split(';')[0].split('='));
  for (const [name, ...v] of set) await page.setCookie({ name, value: v.join('='), url: base });
  check(login.status === 200 && set.length >= 2, `the test account signs in on the identity host (${login.status}, ${set.map(([n]) => n).join(', ')})`);
  sawLogin = false;
  await page.goto(authorizeUrl('none', 'st-b'), { waitUntil: 'domcontentloaded' });
  const b = await waitLanded();
  if (!b || !b.searchParams.get('code')) console.log('    landed:', b && b.search, 'page:', await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '?'));
  check(!!b && !!b.searchParams.get('code') && b.searchParams.get('state') === 'st-b' && !b.searchParams.get('error'),
    'a session: a code on the redirect_uri, with no click');
  check(!sawLogin, 'and no login form was shown');

  // 3. an unsupported prompt value is refused, not redirected
  landed = null;
  const r = await page.goto(authorizeUrl('select_account', 'st-c'), { waitUntil: 'domcontentloaded' });
  await new Promise((r2) => setTimeout(r2, 500));
  check(r.status() >= 400 && !landed, `prompt=select_account is refused (${r.status()}), with no redirect`);
} finally {
  await browser.close();
  server.close();
  await pool.end();
}
console.log(`\noauth-prompt-none-ui: ${passed} checks passed`);

// The account pages on the platform: real data in, real saves out, and nothing invented for what the platform lacks.
// A Vite server serves the workspace; the test answers every /api/ call from a small in-memory account, so no real
// backend is touched. Each check names the user-visible outcome.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5188, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();

// ---- the fake platform ----
const db = {
  user: { id: 7, username: 'ada', email: 'ada@example.test', display_name: 'Ada Lovelace', avatar_url: null, email_verified: true, role: 'user' },
  sessions: [{ id: 's-now', browser: 'Edge', os: 'Windows', device_type: 'desktop', ip_address: '203.0.113.9', last_active_at: new Date().toISOString(), current: true }, { id: 's-old', browser: 'Safari', os: 'iOS', device_type: 'mobile', ip_address: '198.51.100.4', last_active_at: new Date(Date.now() - 864e5).toISOString(), current: false }],
  linked: [{ provider: 'google', email: 'ada@example.test', username: null, linkedAt: new Date(Date.now() - 30 * 864e5).toISOString() }],
  settings: { workspace: { bio: 'First programmer.' } }, credits: 1234, calls: [],
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch {}
  if (m !== 'GET') db.calls.push({ m, p, body, csrf: q.headers()['x-xeno-csrf'] || null });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (p === '/api/account/overview') return json(200, { success: true, overview: { user: { ...db.user, plan: 'free' }, credits: { balance: db.credits }, workspace_count: 1 } });
  if (p === '/api/account/sessions' && m === 'GET') return json(200, { success: true, sessions: db.sessions });
  if (p.startsWith('/api/account/sessions/') && m === 'DELETE') { const id = decodeURIComponent(p.split('/').pop()); const had = db.sessions.some((s) => s.id === id); db.sessions = db.sessions.filter((s) => s.id !== id); return had ? json(200, { success: true, revoked_session_id: id }) : json(404, { success: false, error: 'Session not found' }); }
  if (p === '/api/auth/linked-accounts') return json(200, { success: true, accounts: db.linked });
  if (p === '/api/billing/overview') return json(200, { success: true, overview: { credits: { balance: db.credits }, subscription: null } });
  if (p === '/api/dashboard/stats') return json(200, { success: true, stats: { credits: db.credits, plan: 'free', usage_available: true, usage_by_surface: [{ surface: 'chat', credits: 40 }, { surface: 'canvas', credits: 10 }] } });
  if (p === '/api/user-data/settings' && m === 'GET') return json(200, { success: true, settings: db.settings });
  if (p === '/api/user-data/settings' && m === 'PATCH') { for (const up of (body.updates || [{ path: body.path, value: body.value }])) { const [a, b] = String(up.path).split('.'); db.settings[a] = db.settings[a] || {}; db.settings[a][b] = up.value; } return json(200, { success: true, settings: db.settings }); }
  if (p === '/api/workspaces' && m === 'GET') return json(200, { success: true, workspaces: [] });
  if (p === '/api/chat/projects' && m === 'GET') return json(200, { success: true, projects: [] });
  if (p === '/api/chat/conversations' && m === 'GET') return json(200, { success: true, conversations: [] });
  if (p === '/api/auth/profile' && m === 'PUT') {
    if (body.username === 'taken') return json(400, { success: false, error: 'Username is already taken' });
    if (body.display_name !== undefined) db.user.display_name = body.display_name; if (body.username !== undefined) db.user.username = body.username;
    return json(200, { success: true, user: db.user });
  }
  return json(404, { success: false, error: 'not found in the fake platform: ' + m + ' ' + p });
}

const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = [], missing = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) { const r = answer(q); if (r.status === 404) missing.push(q.method() + ' ' + u.pathname); return q.respond(r); } if (u.host.includes('fonts.g')) return q.abort(); q.continue(); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const open = async (item) => { await p.evaluate((it) => window.XW.go('global', { global: 'settings', item: it }), item); await wait(350); };
const text = () => p.evaluate(() => document.querySelector('.pg--set')?.innerText || '');
const settle = async () => { await p.evaluate(() => window.XENO_NET.idle()); await wait(450); };
const SAMPLE = /Emilian|emilian@|Bucharest|Frankfurt|CI pipeline|Visa ending|2,380|xk_…|This computer|d+ saved — sign in|XENO Agent CLI|Google Drive/;

try {
  await p.goto(base + '/workspace/', { waitUntil: 'networkidle0' }); await wait(600);
  ok((await p.evaluate(() => window.XENO_ACCOUNT.state().status)) === 'ready', 'the account loads from the platform');

  await open('Profile'); let t = await text();
  ok(/Ada Lovelace/.test(t) && /@ada/.test(t) && /ada@example\.test/.test(t) && /First programmer\./.test(t), 'Profile shows the real name, handle, email and bio');
  ok(await p.evaluate(() => { const el = document.querySelector('.pg--set [data-set="changeEmail"]'); return !!el && el.getAttribute('aria-disabled') === 'true' && /Not available/.test(el.title); }), 'changing the email is shown as not available, with the reason');

  await open('Sessions & devices'); t = await text();
  ok(/Edge on Windows/.test(t) && /Safari on iOS/.test(t) && /This device/.test(t), 'Sessions lists the real devices and marks this one');

  await open('Sign-in & security'); t = await text();
  ok(/Google/.test(t) && /ada@example\.test/.test(t), 'Sign-in methods lists the linked Google account');
  ok(await p.evaluate(() => ['addPasskey', 'totpOn', 'addMethod'].every((a) => { const el = document.querySelector(`.pg--set [data-set="${a}"]`); return el && el.getAttribute('aria-disabled') === 'true'; })), 'passkeys, the authenticator and adding a method are shown as not available');

  await open('Usage & limits'); t = await text();
  ok(/1,234/.test(t) && /chat/i.test(t) && /canvas/i.test(t), 'Usage shows the real balance and usage by product (' + t.replace(/\s+/g, ' ').slice(0, 70) + ')');
  await open('Plan & billing'); t = await text();
  ok(/Free/.test(t) && /See plans/.test(t) && !/Invoices/.test(t), 'Plan shows the free plan and no invented invoices');

  const seen = [];
  for (const item of ['Profile', 'Sign-in & security', 'Sessions & devices', 'Apps & sign-in methods', 'API keys', 'Provider keys & inference', 'Plan & billing', 'Usage & limits', 'Gifts', 'Your data', 'Delete account', 'Workspace', 'Connections']) { await open(item); const s = await text(); if (SAMPLE.test(s)) seen.push(item + ': ' + s.match(SAMPLE)[0]); }
  ok(seen.length === 0, 'no account section shows sample data as yours (' + JSON.stringify(seen.slice(0, 3)) + ')');
  await open('API keys'); ok(/can’t be created or listed here yet/.test(await text()), 'a section with no platform API says so');

  // ---- saves ----
  await open('Profile'); db.calls.length = 0;
  await p.click('.pg--set [data-set="editProfile"]'); await wait(300);
  await p.evaluate(() => { const i = document.querySelector('#xdf-name'); i.value = 'Ada King'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await settle();
  const put = db.calls.find((c) => c.p === '/api/auth/profile');
  ok(!!put && put.body.display_name === 'Ada King' && put.body.username === undefined && put.csrf === 'csrf-test-token', 'saving the profile sends only what changed, with the CSRF token (' + JSON.stringify(put && put.body) + ')');
  ok(/Ada King/.test(await text()) && (await p.evaluate(() => window.XENO_ME.name())) === 'Ada King', 'the new name shows after the platform confirms it');

  db.calls.length = 0;
  await p.click('.pg--set [data-set="editProfile"]'); await wait(300);
  await p.evaluate(() => { const i = document.querySelector('#xdf-handle'); i.value = 'taken'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.xd [data-xd-submit]'); await wait(700);
  const refusal = await p.evaluate(() => document.querySelector('.xd')?.innerText || '');
  ok(/already taken/i.test(refusal) && !/Try again/.test(refusal), 'a refused handle shows the platform’s reason and offers no pointless retry (' + refusal.replace(/\s+/g, ' ').slice(0, 80) + ')');
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle();
  ok(/@ada\b/.test(await text()) && !/@taken/.test(await text()), 'the refused change is rolled back on screen');

  await open('Sessions & devices'); db.calls.length = 0;
  await p.click('.pg--set [data-set="endSession"]'); await settle();
  ok(db.calls.some((c) => c.m === 'DELETE' && c.p === '/api/account/sessions/s-old') && db.sessions.length === 1, 'signing out a device revokes that session on the platform');
  t = await text(); ok(!/Safari on iOS/.test(t) && /Edge on Windows/.test(t), 'the device is gone from the list and this device stays');

  const refused = await p.evaluate(async () => { window.XENO_NET.begin('settings', 'cap', null); const r = window.XENO_NET.end(() => { window.__applied = true; }); await new Promise((res) => setTimeout(res, 400)); const said = document.querySelector('.xd')?.innerText || ''; document.querySelector('.xd [data-xd-ok]')?.click(); return { ok: await r, said, applied: !!window.__applied }; });
  ok(refused.ok === false && !refused.applied && /isn’t available on XENO yet/.test(refused.said), 'a settings save with no platform API is refused and nothing is applied');

  ok(missing.length === 0, 'the workspace asked for no route the platform lacks (' + JSON.stringify([...new Set(missing)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;

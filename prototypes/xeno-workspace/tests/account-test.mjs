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
  // account security: the password, whether this session confirmed, a pending email change, keys and exports
  password: 'correct horse', hasPassword: true, confirmed: false, pending: null, mailed: [], keys: [], exports: [], nextKey: 1,
};
const need = () => (db.confirmed ? null : json(403, { success: false, error: 'Confirm it’s you first', code: 'confirmation_required' }));
const security = () => ({ confirmation: { confirmed: db.confirmed, available: true, expires_at: db.confirmed ? new Date(Date.now() + 6e5).toISOString() : null }, methods: [db.hasPassword ? 'password' : 'email_code'], has_password: db.hasPassword, email: db.user.email, pending_email: db.pending ? { new_email: db.pending.email, expires_at: new Date(Date.now() + 6e5).toISOString() } : null });
function accountSecurity(m, p, body) {
  if (p === '/api/account/security' && m === 'GET') return json(200, { success: true, security: security() });
  if (p === '/api/account/confirm/code' && m === 'POST') { db.mailed.push({ to: db.user.email, code: '424242', purpose: 'confirm' }); return json(200, { success: true, sent_to: 'a**@example.test', expires_in: 600 }); }
  if (p === '/api/account/confirm' && m === 'POST') {
    const right = db.hasPassword ? body.password === db.password : body.code === '424242';
    if (!right) return json(400, { success: false, error: db.hasPassword ? 'That password isn’t right' : 'That code isn’t right', code: db.hasPassword ? 'wrong_password' : 'wrong_code', remaining: 4 });
    db.confirmed = true; return json(200, { success: true, confirmation: security().confirmation });
  }
  if (p === '/api/account/email' && m === 'POST') { const no = need(); if (no) return no; const email = String(body.new_email || '').trim().toLowerCase(); if (email === 'taken@example.test') return json(409, { success: false, error: 'That address can’t be used', code: 'email_unavailable' }); db.pending = { email, code: '135790' }; db.mailed.push({ to: email, code: '135790', purpose: 'email_change' }); return json(200, { success: true, pending_email: { new_email: email, expires_in: 600 } }); }
  if (p === '/api/account/email' && m === 'DELETE') { const had = !!db.pending; db.pending = null; return json(200, { success: true, cancelled: had }); }
  if (p === '/api/account/email/confirm' && m === 'POST') { if (!db.pending || body.code !== db.pending.code) return json(400, { success: false, error: 'That code isn’t right', code: 'wrong_code', remaining: 4 }); db.user.email = db.pending.email; db.pending = null; db.confirmed = false; db.sessions = db.sessions.filter((s) => s.current); return json(200, { success: true, email: db.user.email, other_sessions_signed_out: true }); }
  if (p === '/api/account/sessions' && m === 'DELETE') { const n = db.sessions.filter((s) => !s.current).length; db.sessions = db.sessions.filter((s) => s.current); return json(200, { success: true, revoked_sessions: n, apps_signed_out: true, signed_out: false }); }
  if (p === '/api/account/exports' && m === 'GET') { for (const x of db.exports) if (x.status === 'building' && Date.now() - x.t > 900) Object.assign(x, { status: 'ready', ready_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), size_bytes: 2400000, summary: { errors: [], skipped_files: [] } }); return json(200, { success: true, exports: db.exports.map(({ t: _t, ...x }) => x) }); }
  if (p === '/api/account/exports' && m === 'POST') { const no = need(); if (no) return no; if (db.exports.some((x) => x.status === 'building')) return json(409, { success: false, error: 'A copy is already being made', code: 'export_in_progress' }); const x = { id: 'e' + (db.exports.length + 1), status: 'building', requested_at: new Date().toISOString(), ready_at: null, expires_at: null, size_bytes: null, summary: {}, t: Date.now() }; db.exports.unshift(x); return json(202, { success: true, export: x }); }
  const exp = p.match(/^\/api\/account\/exports\/([^/]+)$/);
  if (exp && m === 'DELETE') { const x = db.exports.find((y) => y.id === exp[1]); if (!x) return json(404, { success: false, error: 'That copy is not available', code: 'not_found' }); x.status = 'expired'; return json(200, { success: true }); }
  return null;
}
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const seenGets = [];
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch {}
  if (m === 'GET') seenGets.push({ p });
  if (m !== 'GET') db.calls.push({ m, p, body, csrf: q.headers()['x-xeno-csrf'] || null });
  if (p === '/api/auth/me') return json(200, { success: true, user: db.user });
  if (p === '/api/account/overview') return json(200, { success: true, overview: { user: { ...db.user, plan: 'free' }, credits: { balance: db.credits }, workspace_count: 1 } });
  if (p === '/api/account/sessions' && m === 'GET') return json(200, { success: true, sessions: db.sessions });
  { const sec = accountSecurity(m, p, body || {}); if (sec) return sec; }
  if (p.startsWith('/api/account/sessions/') && m === 'DELETE') { const id = decodeURIComponent(p.split('/').pop()); const had = db.sessions.some((s) => s.id === id); db.sessions = db.sessions.filter((s) => s.id !== id); return had ? json(200, { success: true, revoked_session_id: id }) : json(404, { success: false, error: 'Session not found' }); }
  if (p === '/api/auth/linked-accounts') return json(200, { success: true, accounts: db.linked });
  if (p === '/api/billing/overview') return json(200, { success: true, overview: { credits: { balance: db.credits }, subscription: null } });
  if (p === '/api/dashboard/stats') return json(200, { success: true, stats: { credits: db.credits, plan: 'free', usage_available: true, usage_by_surface: [{ surface: 'chat', credits: 40 }, { surface: 'canvas', credits: 10 }] } });
  if (p === '/api/user-data/settings' && m === 'GET') return json(200, { success: true, settings: db.settings });
  if (p === '/api/user-data/settings' && m === 'PATCH') { for (const up of (body.updates || [{ path: body.path, value: body.value }])) { const [a, b] = String(up.path).split('.'); db.settings[a] = db.settings[a] || {}; db.settings[a][b] = up.value; } return json(200, { success: true, settings: db.settings }); }
  if (p === '/api/workspaces' && m === 'GET') return json(200, { success: true, workspaces: [] });
  if (p === '/api/chat/projects' && m === 'GET') return json(200, { success: true, projects: [] });
  if (p === '/api/chat/conversations' && m === 'GET') return json(200, { success: true, conversations: [] });
  if (p === '/api/library/assets' && m === 'GET') return json(200, { success: true, items: [] });
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
  ok(await p.evaluate(() => { const el = document.querySelector('.pg--set [data-set="changeEmail"]'); return !!el && el.getAttribute('aria-disabled') !== 'true'; }), 'changing the email is offered');

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
  await open('Gifts'); ok(/isn’t available here yet/.test(await text()), 'a section with no platform API says so');

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

  // ---- helpers for the dialogs ----
  const dialog = () => p.evaluate(() => [...document.querySelectorAll('.xd')].pop()?.innerText || '');
  const type = (value) => p.evaluate((v) => { const i = [...document.querySelectorAll('.xd')].pop().querySelector('input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const submit = async () => { await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit]').click()); await wait(450); };
  const confirmYes = async () => { await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-ok]').click()); await wait(450); };
  const closeAll = async () => { for (let i = 0; i < 4 && await dialog(); i++) { await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-close]')?.click()); await wait(250); } };
  const sent = (m, re) => db.calls.filter((c) => c.m === m && re.test(c.p));

  // ---- API keys live on the API portal: this page has one row that opens it ----
  await open('API keys'); t = await text();
  const portal = await p.evaluate(() => { const a = document.querySelector('.pg--set a[href*="/dashboard/keys"]'); return a ? { href: a.href, target: a.target, rel: a.rel } : null; });
  ok(!!portal && portal.href === 'https://api.xenosystem.ai/dashboard/keys' && portal.target === '_blank' && /noopener/.test(portal.rel), 'API keys is one link to the API portal (' + JSON.stringify(portal) + ')');
  ok(/Your keys live on the XENO API portal/.test(t) && /this same account/.test(t), 'it says where keys are managed, and that the same account signs in there');
  ok(await p.evaluate(() => document.querySelectorAll('.pg--set .set-card').length === 1 && !document.querySelector('.pg--set [data-acct="newKey"], .pg--set [data-acct="revokeKey"]')), 'it is a single card, with no key management of its own');
  ok(!db.calls.concat(seenGets).some((c) => /\/api\/account\/api-keys/.test(c.p)), 'the page asks the platform for no keys');

  // ---- a copy of your data ----
  await open('Your data'); t = await text();
  ok(/Request a copy/.test(t) && /one archive/.test(t), 'Your data offers a copy');
  db.confirmed = false;   // a new session: the earlier confirmation is not carried over
  db.calls.length = 0; await p.click('.pg--set [data-acct="export"]'); await wait(500);
  let d = await dialog();
  ok(/Confirm it’s you/.test(d) && /everything in your account/.test(d) && sent('POST', /exports$/).length === 0, 'asking for a copy asks to confirm it’s you first, before anything is sent');
  ok(await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('input').type === 'password'), 'the password is typed into a password field');
  await type('wrong horse'); await submit(); d = await dialog();
  ok(/That password isn’t right/.test(d) && /4 tries left/.test(d) && /Confirm it’s you/.test(d), 'a wrong password is refused in the dialog, with the tries left (' + d.replace(/\s+/g, ' ').slice(-70) + ')');
  await type('correct horse'); await submit(); await settle(); t = await text();
  ok(db.confirmed === true && sent('POST', /exports$/).length === 1 && /Preparing/.test(t), 'the right password confirms, and the copy starts');
  await wait(5200); t = await text();
  const link = await p.evaluate(() => document.querySelector('.pg--set a[download]')?.getAttribute('href') || '');
  ok(/Download \(2\.4 MB\)/.test(t) && link === '/api/account/exports/e1/download' && /kept until/.test(t), 'when it is ready the page shows a real download link, its size and how long it is kept');
  db.calls.length = 0; await p.click('.pg--set [data-acct="removeExport"]'); await wait(400); await confirmYes(); await settle();
  ok(sent('DELETE', /exports\/e1$/).length === 1 && /Request a copy/.test(await text()), 'removing a copy removes it on the platform');

  // ---- email change ----
  await open('Profile'); db.calls.length = 0; db.confirmed = false;
  await p.click('.pg--set [data-set="changeEmail"]'); await wait(500);
  ok(/Confirm it’s you/.test(await dialog()) && /signs you out on every other device/.test(await dialog()), 'changing the email asks to confirm it’s you, and says what it does');
  await type('correct horse'); await submit();
  ok(/Change email/.test(await dialog()), 'then it asks for the new address');
  await type('taken@example.test'); await submit();
  ok(/can’t be used/.test(await dialog()) && db.user.email === 'ada@example.test', 'an address that cannot be used is refused in the dialog');
  await type('ada.new@example.test'); await submit(); d = await dialog();
  ok(/Enter the code/.test(d) && /ada\.new@example\.test/.test(d) && db.user.email === 'ada@example.test', 'a code is sent to the new address, and nothing has changed yet');
  await type('000000'); await submit();
  ok(/isn’t right/.test(await dialog()) && db.user.email === 'ada@example.test', 'a wrong code changes nothing');
  await type(db.mailed.find((x) => x.purpose === 'email_change').code); await submit(); await settle(); t = await text();
  ok(db.user.email === 'ada.new@example.test' && /ada\.new@example\.test/.test(t) && !(await dialog()), 'the right code changes the email, and the page shows the new one');

  // a change left half-done is picked up again
  db.confirmed = true; db.pending = { email: 'later@example.test', code: '246810' };
  await p.click('.pg--set [data-set="changeEmail"]'); await wait(500);
  ok(/Finish changing your email\?/.test(await dialog()) && /later@example\.test/.test(await dialog()), 'a pending change is offered to finish');
  await closeAll();

  // ---- an account with no password confirms with a mailed code ----
  db.hasPassword = false; db.confirmed = false; db.pending = null; db.calls.length = 0;
  db.exports = []; await p.evaluate(() => window.XENO_ACCOUNT.load()); await wait(300);
  await open('Your data'); await p.click('.pg--set [data-acct="export"]'); await wait(600); d = await dialog();
  ok(sent('POST', /confirm\/code$/).length === 1 && /We sent a 6-digit code to a\*\*@example\.test/.test(d), 'an account with no password is sent a code instead, and told where');
  ok(await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('input').type !== 'password'), 'and types it into a plain field');
  await type('424242'); await submit();
  await settle(); ok(db.confirmed === true && !(await dialog()), 'the mailed code confirms it');
  await closeAll(); db.hasPassword = true;

  // any settings action that asks to confirm goes to the server, never to a dialog that accepts anything
  db.confirmed = false; db.calls.length = 0;
  const stepped = p.evaluate(() => window.XENO_SETTINGS.stepUp('A test of the confirm step.')); await wait(500);
  ok(/Confirm it’s you/.test(await dialog()) && /A test of the confirm step/.test(await dialog()), 'the settings page’s own confirm step is the real one');
  await closeAll(); ok((await stepped) === false && db.confirmed === false, 'and closing it confirms nothing');

  // ---- sign out everywhere ----
  db.sessions.push({ id: 's-tab', browser: 'Firefox', os: 'Linux', device_type: 'desktop', ip_address: '192.0.2.7', last_active_at: new Date().toISOString(), current: false });
  await p.evaluate(() => window.XENO_ACCOUNT.load()); await wait(400);
  await open('Sessions & devices'); db.calls.length = 0;
  await p.click('.pg--set [data-set="endOthers"]'); await wait(400); await confirmYes(); await settle();
  const outs = db.calls.filter((c) => c.m === 'DELETE');
  ok(outs.length === 1 && outs[0].p === '/api/account/sessions' && outs[0].csrf === 'csrf-test-token', 'signing out everywhere is one call that also reaches the apps (' + JSON.stringify(outs.map((c) => c.p)) + ')');
  t = await text(); ok(!/Firefox on Linux/.test(t) && /Edge on Windows/.test(t), 'only this device is left');

  ok(missing.length === 0, 'the workspace asked for no route the platform lacks (' + JSON.stringify([...new Set(missing)].slice(0, 3)) + ')');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;

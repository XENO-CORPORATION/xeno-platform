// Two-step sign-in in a real browser with a virtual authenticator: Settings › Sign-in & security, and the sign-in page.
// A Vite server serves the pages; the test answers /api/ from a small in-memory account, so no real backend is touched.
// What the server decides is proven in src/server/tests/two-step-sign-in.test.mjs. This proves the pages carry it.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5293, base = `http://localhost:${PORT}`;
const server = await createServer({ configFile: path.join(repo, 'vite.config.ts'), root: repo, logLevel: 'error', server: { host: 'localhost', port: PORT, strictPort: true, proxy: {} } });
await server.listen();

const CODES = Array.from({ length: 10 }, (_, i) => `abcd-efgh-ijkl-mn${i}${i}`);
const b64 = (s) => Buffer.from(s).toString('base64url');
const db = {
  user: { id: 7, username: 'ada', email: 'ada@example.test', display_name: 'Ada Lovelace', avatar_url: null, email_verified: true, role: 'user' },
  signedIn: true, totp: false, passkeys: [], left: 0, total: 0, confirmed: null, posts: [], secondStep: null,
  regOptions: () => ({ challenge: b64('register-challenge-0123456789'), rp: { id: 'localhost', name: 'XENO' }, user: { id: b64('user-7'), name: 'ada', displayName: 'Ada' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none', excludeCredentials: [], authenticatorSelection: { residentKey: 'required', userVerification: 'required' } }),
  getOptions: () => ({ challenge: b64('sign-in-challenge-0123456789'), rpId: 'localhost', timeout: 60000, userVerification: 'required', allowCredentials: [] }),
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const twoState = () => ({ on: db.totp || db.passkeys.length > 0, totp: db.totp, passkeys: db.passkeys, recoveryLeft: db.left, recoveryTotal: db.total });
const methods = () => [...(db.totp ? ['authenticator'] : []), ...(db.passkeys.length ? ['passkey'] : []), ...(db.left ? ['recovery_code'] : [])];
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let body = null; try { body = JSON.parse(q.postData() || 'null'); } catch {}
  if (m !== 'GET') db.posts.push({ m, p, body });
  // the sign-in page
  if (p === '/api/auth/login' && m === 'POST') { if (body.password !== 'correct horse') return json(401, { success: false, error: 'Invalid email or password' }); return json(401, { success: false, code: 'two_step_required', error: 'Confirm it’s you with your second step.', methods: db.secondStep }); }
  if (p === '/api/auth/two-step' && m === 'GET') return db.secondStep ? json(200, { success: true, methods: db.secondStep }) : json(404, { success: false, code: 'challenge_expired' });
  if (p === '/api/auth/two-step' && m === 'DELETE') return json(200, { success: true });
  if (p === '/api/auth/two-step/passkey/options') return json(200, { success: true, options: db.getOptions() });
  if (p === '/api/auth/two-step/verify') {
    if (body.method === 'authenticator' && body.code !== '123456') return json(401, { success: false, code: 'code_wrong', error: 'That code isn’t right. Wait for a new one and try again.' });
    if (body.method === 'recovery_code' && body.code !== CODES[0]) return json(401, { success: false, code: 'code_wrong', error: 'That recovery code isn’t right, or it was already used.' });
    return json(200, { success: true, user: db.user, token: null });
  }
  if (p === '/api/auth/passkey/options') return json(200, { success: true, ceremonyId: 'c-sign', options: db.getOptions() });
  if (p === '/api/auth/passkey/verify') return json(200, { success: true, user: db.user, token: null });
  // the account
  if (p === '/api/auth/me') return db.signedIn ? json(200, { success: true, user: db.user }) : json(401, { success: false });
  if (p === '/api/auth/activation-status') return json(200, { success: true, activated: true });
  if (p === '/api/account/two-step' && m === 'GET') return json(200, { success: true, twoStep: twoState() });
  if (p === '/api/account/security') return json(200, { success: true, security: { confirmation: { confirmed: !!db.confirmed, available: true, method: db.confirmed, expires_at: null }, methods: [...methods(), 'password'], has_password: true, email: db.user.email, pending_email: null } });
  if (p === '/api/account/confirm/passkey/options') return json(200, { success: true, ceremonyId: 'c-conf', options: { ...db.getOptions(), allowCredentials: db.passkeys.map((k) => ({ id: k.credentialId, type: 'public-key' })) } });
  if (p === '/api/account/confirm' && m === 'POST') {
    if (body.password === 'correct horse') { db.confirmed = 'password'; return json(200, { success: true, confirmation: { confirmed: true, method: 'password' } }); }
    if (body.authenticator === '123456') { db.confirmed = 'authenticator'; return json(200, { success: true, confirmation: { confirmed: true, method: 'authenticator' } }); }
    if (body.recovery_code === CODES[0]) { db.confirmed = 'recovery_code'; return json(200, { success: true, confirmation: { confirmed: true, method: 'recovery_code' } }); }
    if (body.passkey?.response?.response?.authenticatorData) { db.confirmed = 'passkey'; return json(200, { success: true, confirmation: { confirmed: true, method: 'passkey' } }); }
    return json(400, { success: false, error: 'That didn’t work' });
  }
  const need = () => (db.confirmed ? null : json(403, { success: false, code: 'confirmation_required', error: 'Confirm it’s you first' }));
  const factor = () => (db.confirmed && db.confirmed !== 'password' ? null : json(403, { success: false, code: 'factor_required', error: 'Confirm it’s you with your second step' }));
  if (p === '/api/account/two-step/totp' && m === 'POST') { const no = need(); if (no) return no; return json(200, { success: true, key: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauth: 'otpauth://totp/XENO:ada?secret=X', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' }); }
  if (p === '/api/account/two-step/totp/confirm') { if (body.code !== '123456') return json(400, { success: false, code: 'code_wrong', error: 'That code isn’t right.' }); db.totp = true; const first = !db.total; if (first) { db.total = 10; db.left = 10; } return json(200, { success: true, recoveryCodes: first ? CODES : null }); }
  if (p === '/api/account/two-step/totp' && m === 'DELETE') { const no = factor(); if (no) return no; db.totp = false; if (!db.passkeys.length) { db.total = 0; db.left = 0; } return json(200, { success: true, removed: true }); }
  if (p === '/api/account/two-step/recovery-codes') { const no = factor(); if (no) return no; db.total = 10; db.left = 10; return json(200, { success: true, recoveryCodes: CODES }); }
  if (p === '/api/account/two-step/passkeys/options') { const no = need(); if (no) return no; return json(200, { success: true, ceremonyId: 'c-reg', options: db.regOptions() }); }
  if (p === '/api/account/two-step/passkeys' && m === 'POST') { db.passkeys.push({ id: 'pk' + (db.passkeys.length + 1), name: body.name, credentialId: body.response.id, addedAt: new Date().toISOString(), lastUsedAt: null, syncs: false }); const first = !db.total; if (first) { db.total = 10; db.left = 10; } return json(201, { success: true, id: 'pk1', recoveryCodes: first ? CODES : null }); }
  { const k = p.match(/^\/api\/account\/two-step\/passkeys\/([^/]+)$/);
    if (k && m === 'PATCH') { db.passkeys.find((x) => x.id === k[1]).name = body.name; return json(200, { success: true }); }
    if (k && m === 'DELETE') { const no = factor(); if (no) return no; db.passkeys = db.passkeys.filter((x) => x.id !== k[1]); if (!db.passkeys.length && !db.totp) { db.total = 0; db.left = 0; } return json(200, { success: true }); } }
  if (p === '/api/account/overview') return json(200, { success: true, overview: { user: { ...db.user, plan: 'free' }, credits: { balance: 0 }, workspace_count: 0 } });
  if (p === '/api/account/sessions') return json(200, { success: true, sessions: [] });
  if (p === '/api/auth/linked-accounts') return json(200, { success: true, accounts: [] });
  if (p === '/api/billing/overview') return json(200, { success: true, overview: { credits: { balance: 0 }, subscription: null } });
  if (p === '/api/dashboard/stats') return json(200, { success: true, stats: { usage_available: false, usage_by_surface: [] } });
  if (p === '/api/user-data/settings') return json(200, { success: true, settings: {} });
  if (p === '/api/account/exports') return json(200, { success: true, exports: [] });
  if (p === '/api/account/browsers') return json(200, { success: true, browsers: [] });
  if (p === '/api/account/deletion') return json(200, { success: true, deletion: null });
  if (p === '/api/workspaces') return json(200, { success: true, workspaces: [] });
  // every other area's first read: empty, not an error
  return json(200, { success: true, items: [], rows: [], projects: [], conversations: [], tasks: [], views: [], threads: [], agents: [], divisions: [], modes: [], tools: [], skills: [], machines: [], sizes: [], people: [], workflows: [], nodes: [], actions: [], channels: [], dms: [], services: [], connections: [], lends: [], transfers: [], summary: {}, areas: {}, unread: 0, total: 0 });
}

const b = await puppeteer.launch({ headless: true, protocolTimeout: 120000 });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) return q.respond(answer(q)); q.continue(); });
const cdp = await p.createCDPSession();
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const shot = async (name) => { if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); };
const top = `[...document.querySelectorAll('.xd')].pop()`;
const dlg = () => p.evaluate(`${top}?.innerText || ''`);
const closed = () => p.evaluate(`!document.querySelector('.xd')`);
const submit = async () => { await p.evaluate(`${top}.querySelector('[data-xd-submit],[data-xd-ok]').click()`); await wait(700); };
const fill = (selector, v) => p.evaluate((s, x) => { const d = [...document.querySelectorAll('.xd')].pop(), el = d.querySelector(s); el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, selector, v);
const press = async (act, arg) => { await p.evaluate((a, g) => { const el = [...document.querySelectorAll(`.pg--set [data-set="${a}"]`)].find((x) => !g || x.dataset.arg === g); el.click(); }, act, arg); await wait(600); };
const text = () => p.evaluate(() => document.querySelector('.pg--set')?.innerText || '');
const toast = () => p.evaluate(() => document.getElementById('toast')?.innerText || '');
const sent = (re) => db.posts.filter((x) => re.test(x.p));
const closeInfo = async () => { await p.evaluate(`${top}?.querySelector('[data-xd-close],[data-xd-ok]')?.click()`); await wait(300); };
try {
  // ---- Settings ----
  await p.goto(base + '/workspace/', { waitUntil: 'networkidle2' }); await wait(1200);
  await p.evaluate(() => window.XW.go('global', { global: 'settings', item: 'Sign-in & security' })); await wait(1200);
  let t = await text();
  ok(/Add a passkey/.test(t) && /Set up/.test(t), 'Sign-in & security offers a passkey and an authenticator app');
  ok(await p.evaluate(() => ['addPasskey', 'totpOn'].every((a) => document.querySelector(`.pg--set [data-set="${a}"]`).getAttribute('aria-disabled') !== 'true')), 'and neither is shown unavailable');

  await press('totpOn');
  ok(/Confirm it’s you/.test(await dlg()), 'setting up the authenticator asks who you are first');
  await fill('input[type=password]', 'correct horse'); await submit();
  t = await dlg();
  ok(/Set up an authenticator app/.test(t) && /JBSW Y3DP/.test(t) && await p.evaluate(`!!${top}.querySelector('.set-qr svg')`), 'then shows the QR code and the key to type');
  await shot('two-step-setup');
  await fill('input', '000000'); await submit();
  ok(/That code isn’t right/.test(await dlg()), 'a wrong code keeps the dialog open and says why');
  await fill('input', '123456'); await submit();
  t = await dlg();
  ok(/Your recovery codes/.test(t) && t.includes(CODES[0]) && t.includes(CODES[9]), 'a right code turns it on and shows the recovery codes, once');
  await shot('two-step-codes');
  await closeInfo(); await wait(500); t = await text();
  ok(/On — codes from your authenticator app/.test(t) && /10 of 10 left/.test(t), 'the page shows it on, with the codes left');

  await press('addPasskey'); t = await dlg();
  ok(/Add a passkey/.test(t), 'adding a passkey asks for a name');
  await fill('input', 'Test laptop'); await submit(); await wait(800);
  const reg = sent(/two-step\/passkeys$/).pop();
  ok(reg && reg.body.ceremonyId === 'c-reg' && reg.body.name === 'Test laptop', 'the browser really created a passkey and sent it');
  ok(reg && typeof reg.body.response.response.attestationObject === 'string' && reg.body.response.response.clientDataJSON && !/[+/=]/.test(reg.body.response.response.attestationObject), 'in the encoded form the server reads');
  t = await text();
  ok(/Test laptop/.test(t) && /not used yet/.test(t), 'it is listed by name');
  await press('renamePasskey', 'pk1'); await fill('input', 'Work laptop'); await submit();
  ok(/Work laptop/.test(await text()), 'it can be renamed');

  // taking it away needs the second step, not the password
  db.confirmed = 'password';
  await press('removePasskey', 'pk1');
  t = await dlg();
  ok(/Remove “Work laptop”/.test(t), 'removing asks first');
  await submit(); t = await dlg();
  ok(/With/.test(t) && !/Your password/.test(t), 'and then the password isn’t offered: only the second step will do');
  await fill('select', 'authenticator'); await submit();
  await fill('input', '123456'); await submit(); await wait(400);
  ok(db.passkeys.length === 0 && /Passkey removed/.test(await toast()), 'with the code it is removed');

  db.confirmed = null;
  await press('codes'); await fill('select', 'authenticator'); await submit();
  await fill('input', '123456'); await submit(); await wait(400);
  ok(/Your recovery codes/.test(await dlg()), 'new recovery codes take the second step too');
  await closeInfo(); await wait(300);
  db.confirmed = 'authenticator';
  await press('totpOff'); await submit(); await wait(600);
  ok(!db.totp && /Authenticator turned off/.test(await toast()), 'and the authenticator can be turned off');
  ok(/Codes from an app/.test(await text()), 'the page says it is off');

  // ---- the sign-in page ----
  db.signedIn = false; db.secondStep = ['authenticator', 'passkey', 'recovery_code'];
  // the whole app, unbundled, on a dev server: slow on first load
  const goLogin = async (q, sel) => { await p.goto(base + '/login' + q, { waitUntil: 'domcontentloaded', timeout: 240000 }); await p.waitForSelector(sel, { timeout: 240000 }).catch(() => null); await wait(800); };
  await goLogin('', '[data-passkey-sign-in]');
  ok(await p.evaluate(() => !!document.querySelector('[data-passkey-sign-in]')), 'the sign-in page offers a passkey');
  if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'login.png') });
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /continue with email|email/i.test(x.textContent))?.click()); await wait(400);
  const typeIn = async (sel, v) => { await p.click(sel, { clickCount: 3 }); await p.type(sel, v); };
  await typeIn('input[type=email], input[name=email], input[autocomplete=email]', 'ada@example.test'); await typeIn('input[type=password]', 'correct horse');
  await p.keyboard.press('Enter'); await wait(1200);
  ok(await p.evaluate(() => !!document.querySelector('[data-two-step]')), 'a right password brings up the second step');
  await shot('login-second-step');
  await p.type('[data-two-step] input', '000000'); await p.keyboard.press('Enter'); await wait(800);
  let two = await p.evaluate(() => document.querySelector('[data-two-step]')?.innerText || '');
  ok(/That code isn’t right/.test(two), 'a wrong code says so and stays');
  await p.evaluate(() => [...document.querySelectorAll('[data-two-step] button')].find((x) => /recovery code/i.test(x.textContent)).click()); await wait(300);
  two = await p.evaluate(() => document.querySelector('[data-two-step]').innerText);
  ok(/recovery codes/.test(two), 'a recovery code can be used instead');
  await p.type('[data-two-step] input', 'nope'); await p.keyboard.press('Enter'); await wait(800);
  ok(/already used/.test(await p.evaluate(() => document.querySelector('[data-two-step]').innerText)), 'a wrong one says so');
  await p.evaluate(() => [...document.querySelectorAll('[data-two-step] button')].find((x) => /another way/i.test(x.textContent)).click()); await wait(300);
  db.signedIn = true;
  await p.type('[data-two-step] input', '123456');
  await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null), p.keyboard.press('Enter')]); await wait(1200);
  ok(/\/workspace/.test(await p.evaluate(() => location.pathname)), 'the right code signs in and opens the workspace');
  ok(sent(/two-step\/verify$/).some((x) => x.body.code === '123456' && x.body.method === 'authenticator'), 'with the code it was given');

  // coming back from Google with a second step waiting
  db.signedIn = false; db.posts.length = 0;
  await goLogin('?two_step=1', '[data-two-step]');
  ok(await p.evaluate(() => !!document.querySelector('[data-two-step]')), 'a provider sign-in lands on the second step');
  db.secondStep = null;
  await goLogin('?two_step=1', '[data-passkey-sign-in]');
  ok(await p.evaluate(() => !document.querySelector('[data-two-step]')), 'with nothing waiting it is the ordinary page');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;

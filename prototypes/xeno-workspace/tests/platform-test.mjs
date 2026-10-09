// The workspace served by the platform at /workspace/: the sign-in gate, the real account, and what is never served.
// Starts a Vite server in-process with only the workspace plugin; /api/auth/me is answered by the test, so nothing reaches a real backend.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5187, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
let slow = 0;   // when set, the library's first answer is held this long
async function open(me) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('requestfailed', (q) => { if (!q.url().includes('fonts.g') && !q.url().endsWith('/api/auth/me')) bad.push('failed ' + q.url()); });
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/api/auth/me')) bad.push(r.status() + ' ' + r.url()); });
  await p.setRequestInterception(true);
  const handle = (q, late) => { const u = new URL(q.url());
    if (slow && !late && u.pathname === '/api/library/assets') return void setTimeout(() => handle(q, true), slow);
    if (u.pathname === '/api/auth/me') return me === 'down' ? q.abort('failed') : q.respond(me);
    // the account pages load with the workspace; this suite is about the gate, so they get an empty, valid account
    if (me !== 'down' && me.status === 200 && u.pathname.startsWith('/api/')) { const user = JSON.parse(me.body).user; const body = { '/api/account/overview': { success: true, overview: { user, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/api-keys': { success: true, keys: [] }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] } }[u.pathname]; if (body) return q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
    if (u.pathname === '/login') return q.respond({ status: 200, contentType: 'text/html', body: '<title>login</title>' });
    q.continue(); };
  p.on('request', (q) => handle(q));
  return { p, errs, bad };
}
const USER = { success: true, user: { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true } };
try {
  { // signed out
    const { p } = await open({ status: 401, contentType: 'application/json', body: '{"success":false}' });
    await p.goto(base + '/workspace/#/library', { waitUntil: 'networkidle0' }); await wait(300);
    const u = new URL(p.url());
    ok(u.pathname === '/login' && u.searchParams.get('returnUrl') === '/workspace/#/library', 'a signed-out visitor goes to sign-in and comes back to the same place (' + u.pathname + u.search + ')');
    await p.close();
  }
  { // signed in
    const { p, errs, bad } = await open({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) });
    await p.goto(base + '/workspace', { waitUntil: 'networkidle0' }); await wait(500);
    ok(new URL(p.url()).pathname === '/workspace/', 'the address without a slash is redirected to /workspace/');
    const s = await p.evaluate(() => ({ wait: document.documentElement.classList.contains('xp-wait'), main: !!document.querySelector('#main') && getComputedStyle(document.querySelector('#main')).visibility, name: JSON.parse(localStorage.getItem('xw.acct') || '{}').profile?.name, email: JSON.parse(localStorage.getItem('xw.acct') || '{}').profile?.email, chip: document.getElementById('net-chip') ? getComputedStyle(document.getElementById('net-chip')).display : 'absent', note: document.getElementById('xp-note')?.textContent || '', user: window.XENO_PLATFORM.user?.username, hist: !!window.XENO_HIST, sel: !!window.XENO_SEL }));
    ok(!s.wait && s.main === 'visible', 'the workspace shows once the account is confirmed');
    ok(s.name === 'Test Person' && s.email === 'test@example.test' && s.user === 'test-person', 'the profile is the signed-in account, not the sample (' + s.name + ', ' + s.email + ')');
    ok(s.chip === 'none' || s.chip === 'absent', 'the prototype network controls are hidden (' + s.chip + ')');
    ok(/sample data/.test(s.note), 'the page says the areas still show sample data');
    ok(s.hist && s.sel, 'the history and the selection are loaded');
    ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
    // the person named on screen is the signed-in account, wherever the workspace speaks to or about them
    await p.evaluate(() => { location.hash = '#/studio'; }); await wait(500);
    const who = await p.evaluate(() => ({ head: [...document.querySelectorAll('#main h1')].map((h) => h.textContent).join(' | '), me: window.XENO_ME.name(), first: window.XENO_ME.first(), email: window.XENO_ME.email(), sample: /\bEmilian\b/.test([...document.querySelectorAll('#main h1')].map((h) => h.textContent).join(' ')) }));
    ok(who.me === 'Test Person' && who.first === 'Test' && who.email === 'test@example.test', 'the workspace knows the signed-in person (' + who.me + ', ' + who.email + ')');
    ok(/\bTest\b/.test(who.head) && !who.sample, 'the home heading greets the signed-in person, not the sample name (' + who.head.slice(0, 60) + ')');
    // every image the workspace draws must load: on the first deploy the product icons pointed at a folder on one PC
    const seen = { total: 0, broken: [] };
    for (const place of ['#/', '#/studio', '#/office', '#/dev', '#/library']) {
      await p.evaluate((h) => { location.hash = h; }, place); await wait(500);
      const r = await p.evaluate(async () => { const imgs = [...document.images]; await Promise.all(imgs.map((i) => i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; }))); return { n: imgs.length, broken: imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')) }; });
      seen.total += r.n; seen.broken.push(...r.broken);
    }
    ok(seen.total > 10 && seen.broken.length === 0, 'every image loads across five places (' + seen.total + ' images, broken: ' + JSON.stringify([...new Set(seen.broken)].slice(0, 3)) + ')');
    ok(bad.length === 0, 'no request fails or returns an error (' + JSON.stringify([...new Set(bad)].slice(0, 3)) + ')');
    await p.close();
  }
  { // the platform cannot be reached
    const { p } = await open('down');
    await p.goto(base + '/workspace/', { waitUntil: 'networkidle0' }); await wait(300);
    const s = await p.evaluate(() => ({ text: document.getElementById('xp-state')?.textContent || '', main: getComputedStyle(document.querySelector('#main')).visibility, retry: !!document.getElementById('xp-retry') }));
    ok(/could not reach XENO/.test(s.text) && s.retry && s.main === 'hidden', 'a failed check says so, offers a retry, and shows no workspace');
    await p.close();
  }
  { // a refresh shows the page once, complete: nothing is visible while the first loads are still arriving
    slow = 1500;
    const { p } = await open({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) });
    const nav = p.goto(base + '/workspace/', { waitUntil: 'domcontentloaded' }); await nav; await wait(700);
    const during = await p.evaluate(() => ({ held: document.documentElement.classList.contains('xp-wait'), main: getComputedStyle(document.querySelector('#main') || document.body).visibility, said: document.getElementById('xp-state')?.innerText || '' }));
    ok(during.held && during.main === 'hidden' && /Opening your workspace/.test(during.said), 'while the first loads are still arriving the page stays held, with its message (' + JSON.stringify(during) + ')');
    await wait(1700);
    const after = await p.evaluate(() => ({ held: document.documentElement.classList.contains('xp-wait'), main: getComputedStyle(document.querySelector('#main')).visibility, lib: window.XENO_LIB.state().status, work: window.XENO_WORK.state().projects, acct: window.XENO_ACCOUNT.state().status }));
    ok(!after.held && after.main === 'visible' && after.lib === 'ready' && after.work === 'ready' && after.acct === 'ready', 'it appears once every first load has landed (' + JSON.stringify(after) + ')');
    slow = 0; await p.close();
  }
  { // what is never served
    const p = await b.newPage(); const st = async (u) => (await p.goto(base + u)).status();
    const a = await st('/workspace/tests/hist-test.mjs'), r = await st('/workspace/README.md'), t = await st('/workspace/..%2f..%2fpackage.json'), k = await st('/workspace/keys.js');
    ok(a === 404 && r === 404 && t === 404 && k === 200, `tests, notes and paths outside the folder are refused; a script is served (${a} ${r} ${t} ${k})`);
    await p.close();
  }
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;

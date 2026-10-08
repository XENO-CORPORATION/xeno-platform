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
async function open(me) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => { const u = new URL(q.url());
    if (u.pathname === '/api/auth/me') return me === 'down' ? q.abort('failed') : q.respond(me);
    if (u.pathname === '/login') return q.respond({ status: 200, contentType: 'text/html', body: '<title>login</title>' });
    q.continue(); });
  return { p, errs };
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
    const { p, errs } = await open({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) });
    await p.goto(base + '/workspace', { waitUntil: 'networkidle0' }); await wait(500);
    ok(new URL(p.url()).pathname === '/workspace/', 'the address without a slash is redirected to /workspace/');
    const s = await p.evaluate(() => ({ wait: document.documentElement.classList.contains('xp-wait'), main: !!document.querySelector('#main') && getComputedStyle(document.querySelector('#main')).visibility, name: JSON.parse(localStorage.getItem('xw.acct') || '{}').profile?.name, email: JSON.parse(localStorage.getItem('xw.acct') || '{}').profile?.email, chip: document.getElementById('net-chip') ? getComputedStyle(document.getElementById('net-chip')).display : 'absent', note: document.getElementById('xp-note')?.textContent || '', user: window.XENO_PLATFORM.user?.username, hist: !!window.XENO_HIST, sel: !!window.XENO_SEL }));
    ok(!s.wait && s.main === 'visible', 'the workspace shows once the account is confirmed');
    ok(s.name === 'Test Person' && s.email === 'test@example.test' && s.user === 'test-person', 'the profile is the signed-in account, not the sample (' + s.name + ', ' + s.email + ')');
    ok(s.chip === 'none' || s.chip === 'absent', 'the prototype network controls are hidden (' + s.chip + ')');
    ok(/sample data/.test(s.note), 'the page says the areas still show sample data');
    ok(s.hist && s.sel, 'the history and the selection are loaded');
    ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
    await p.close();
  }
  { // the platform cannot be reached
    const { p } = await open('down');
    await p.goto(base + '/workspace/', { waitUntil: 'networkidle0' }); await wait(300);
    const s = await p.evaluate(() => ({ text: document.getElementById('xp-state')?.textContent || '', main: getComputedStyle(document.querySelector('#main')).visibility, retry: !!document.getElementById('xp-retry') }));
    ok(/could not reach XENO/.test(s.text) && s.retry && s.main === 'hidden', 'a failed check says so, offers a retry, and shows no workspace');
    await p.close();
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

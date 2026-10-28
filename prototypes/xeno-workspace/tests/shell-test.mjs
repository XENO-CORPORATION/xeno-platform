import { shot } from './shot.mjs';
// Cloud Shell (platform-shell.js) in a real browser, against stand-ins for /api/compute/cloud-shell and the terminal socket:
//   1. the rail button appears only when Cloud Shell is open to the account; off → no button, nothing opened
//   2. the button opens the dock: POST /cloud-shell, then a WebSocket to …/ports/shell/ws offering the ticket protocols
//   3. output appears in the terminal; typing is sent as binary; the size is sent as a resize message
//   4. Ctrl+` hides and shows it, the session is kept while hidden; it stays open across a page change
//   5. the machine stopping says why and offers a new session; /workspace/shell/<id> opens the same shell full height
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5231, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const MID = 'mch_' + 'a'.repeat(32);

// A stand-in WebSocket: records what the page opens and sends, answers like the terminal server.
const FAKE_WS = () => {
  window.__ws = [];
  window.WebSocket = class {
    constructor(url, protocols) {
      this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = []; window.__ws.push(this);
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); this.push('\x1b[1mwelcome\x1b[0m to cloud shell\r\n$ '); }, 50);
    }
    push(text) { if (this.onmessage) this.onmessage({ data: new TextEncoder().encode(text).buffer }); }
    send(d) { this.sent.push(typeof d === 'string' ? d : new TextDecoder().decode(d)); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; setTimeout(() => this.onclose && this.onclose({ code, reason }), 0); }
  };
};

async function open(pathname, enabled) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const calls = [];
  await p.evaluateOnNewDocument(FAKE_WS);
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const M = q.method(), P = u.pathname;
    if (P.startsWith('/api/compute')) calls.push([M, P]);
    if (P === '/api/auth/me') return json({ success: true, user: USER });
    if (P === '/api/compute/cloud-shell' && M === 'GET') return json({ success: true, shell: enabled ? { enabled: true, machineId: MID } : { enabled: false } });
    if (P === '/api/compute/cloud-shell' && M === 'POST') return enabled
      ? json({ success: true, shell: { machineId: MID, workspaceId: 'w', url: `/workspace/shell/${MID}`, connect: { path: `/api/compute/machines/${MID}/ports/shell/`, protocols: ['xeno-port.v1', 'xeno-ticket.T1'] } } })
      : json({ success: false, error: 'Cloud Shell is not open to your account yet', code: 'shell_not_enabled' }, 403);
    if (P === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + pathname, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs, calls };
}
const termText = (p) => p.evaluate(() => [...document.querySelectorAll('.csh-dock .xterm-rows > div')].map((r) => r.textContent).join('\n'));
const ctrlBackquote = async (p) => { await p.keyboard.down('Control'); await p.keyboard.press('Backquote'); await p.keyboard.up('Control'); await wait(300); };

try {
  { // 1. off
    const { p, errs, calls } = await open('/workspace/', false);
    ok(await p.$('.rbtn[data-go="shell"]') === null && !calls.some((c) => c[0] === 'POST'), 'Cloud Shell closed to this account: no rail button, nothing opened');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }

  // 2–5. on
  const { p, errs, calls } = await open('/workspace/', true);
  ok(await p.$('.rbtn[data-go="shell"]') !== null, 'Cloud Shell open to the account: the rail shows its button');
  await p.click('.rbtn[data-go="shell"]'); await wait(1500);
  const w = await p.evaluate(() => window.__ws.map((x) => ({ url: x.url, protocols: x.protocols })));
  ok(calls.some((c) => c[0] === 'POST' && c[1] === '/api/compute/cloud-shell'), 'the button asks the platform to open the shell');
  ok(w.length === 1 && w[0].url.endsWith(`/api/compute/machines/${MID}/ports/shell/ws`) && w[0].protocols.join() === 'xeno-port.v1,xeno-ticket.T1', `the terminal connects to the machine's shell port with the ticket (${JSON.stringify(w)})`);
  ok(/welcome to cloud shell/.test(await termText(p)), 'the machine’s output appears in the terminal');
  await shot(p, 'shell-dock');
  await p.click('.csh-dock .xterm'); await p.keyboard.type('xeno ws list'); await p.keyboard.press('Enter'); await wait(300);
  const sent = await p.evaluate(() => window.__ws[0].sent);
  const typed = sent.filter((s) => !s.startsWith('{')).join('');
  ok(typed === 'xeno ws list\r', `typing is sent to the machine (${JSON.stringify(typed)})`);
  const rs = sent.filter((s) => s.startsWith('{')).map((s) => JSON.parse(s));
  ok(rs.length && rs.at(-1).type === 'resize' && rs.at(-1).cols > 20 && rs.at(-1).rows > 4, `the terminal size is sent (${JSON.stringify(rs.at(-1))})`);

  await ctrlBackquote(p);
  ok(await p.evaluate(() => document.querySelector('.csh-dock').hidden), 'Ctrl+` hides it');
  await ctrlBackquote(p);
  ok(await p.evaluate(() => !document.querySelector('.csh-dock').hidden && window.__ws.length === 1 && window.__ws[0].readyState === 1), 'and shows it again with the same session');
  await p.evaluate(() => window.XW.go('global', { global: 'support' })); await wait(800);
  ok(await p.evaluate(() => !document.querySelector('.csh-dock').hidden && window.__ws[0].readyState === 1), 'it stays open while you move to another page');

  await p.evaluate(() => window.__ws[0].close(4409, '')); await wait(300);
  ok(/machine stopped/.test(await p.evaluate(() => document.querySelector('.csh-note')?.textContent || '')), 'when the machine stops it says so');
  await p.click('.csh-note [data-csh="retry"]'); await wait(1200);
  ok(await p.evaluate(() => window.__ws.length === 2 && window.__ws[1].readyState === 1), 'a new session can be started');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();

  {
    const { p, errs } = await open(`/workspace/shell/${MID}`, true);
    await wait(1200);
    ok(await p.evaluate(() => !!document.querySelector('.csh-dock.max') && !document.querySelector('.csh-dock').hidden && window.__ws.length === 1), 'the shell has its own address and opens full height');
    ok(/xeno ws list/.test(await p.evaluate(() => document.querySelector('#main')?.textContent || '')), 'the page says how to use xeno in it');
    await shot(p, 'shell-page');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);

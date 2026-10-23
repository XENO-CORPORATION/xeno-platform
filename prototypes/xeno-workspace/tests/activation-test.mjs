// activation-test — an account that has not confirmed its email is sent to /auth/activate instead of opening a
// workspace where every platform route answers 403 account_not_activated and nothing says why (live, 2026-10-23).
// Proves both directions: activated:false → /auth/activate; activated:true, or the status route failing → the
// workspace opens as before (the server stays the gate, this is only the explanation).
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5262, base = 'http://127.0.0.1:' + PORT;
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
let STATUS = { code: 200, body: { success: true, activated: false } };
const USER = { id: 'u1', username: 'ada', email: 'a@x.test', display_name: 'Ada', avatar_url: null, email_verified: true, role: 'user' };
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/auth/activate') return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>activate</title><body>activate</body>' });
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/auth/activation-status') return json(STATUS.code, STATUS.body);
  return json(200, { success: true });
});
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await p.goto(base + '/workspace/', { waitUntil: 'domcontentloaded' }); await settle(2500);
  ok(new URL(p.url()).pathname === '/auth/activate', 'an unactivated account is sent to /auth/activate');
  STATUS = { code: 200, body: { success: true, activated: true } };
  await p.goto(base + '/workspace/', { waitUntil: 'domcontentloaded' }); await settle(2500);
  ok(new URL(p.url()).pathname.startsWith('/workspace'), 'an activated account opens the workspace');
  STATUS = { code: 500, body: { success: false } };
  await p.goto(base + '/workspace/', { waitUntil: 'domcontentloaded' }); await settle(2500);
  ok(new URL(p.url()).pathname.startsWith('/workspace'), 'a failing status check does not lock anyone out');
} finally { await br.close(); await server.close(); }
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);

// depot-host-test — XENO Depot's web page on its own host (xeno-depot docs/design/0006-web-ui.md), on depot.localhost
// against a stand-in platform API and a stand-in for Depot's /api/v1 (Depot's real API answers behind its Worker; this
// test proves the PAGE). The token route itself is proven against real Postgres in src/server/tests/depot-authority.
// Proves: only Depot's scripts load; / goes to /w/<ws>/repos; the page asks POST /api/auth/depot-token with the CSRF
// header and sends that token as Bearer to Depot's API; the list and a repo's branches show at their own addresses,
// survive a refresh and Back; a repo with no access reads exactly like a missing one; a closed door says so; the token
// is never put in storage; no page errors.
//   node prototypes/xeno-workspace/tests/depot-host-test.mjs        (SHOT=1 saves screenshots to scratchpad/)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import net from 'node:net'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace, PRODUCT_SCRIPTS } = await import('../../../scripts/vite-workspace.mjs');
const PORT = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const HOST = 'http://depot.localhost:' + PORT;
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const USER = { id: '00000007-0000-4000-8000-000000000007', username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'admin', kind: 'human' };
const WS = '0000000b-0000-4000-8000-00000000000b', REPO = '01a2006168da76c3b7d3447784891668', TIP = 'c'.repeat(64);
const S = { tokens: 0, csrfSent: false, bearers: new Set(), door: true };

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true, allowedHosts: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const scripts = new Set(); p.on('request', (q) => { if (q.resourceType() === 'script' && q.frame() === p.mainFrame()) scripts.add(new URL(q.url()).pathname.split('/').pop()); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test', url: HOST });
await p.setRequestInterception(true);
const answer = (q) => {
  const u = new URL(q.url());
  if (!/(^|\.)localhost$|^127\.0\.0\.1$/.test(u.hostname)) return q.respond({ status: 204, body: '' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const h = q.headers();
  // the platform
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [{ id: WS, name: 'BUNKERCORPO', workspace_type: 'personal', member_role: 'owner' }] });
  if (u.pathname === '/api/auth/depot-token') {
    if (q.method() !== 'POST') return json({ success: false }, 405);
    S.csrfSent = h['x-xeno-csrf'] === 'csrf-test';
    if (!S.door) return json({ success: false, error: 'depot_closed', message: 'XENO Depot is open to XENO staff only for now.' }, 403);
    S.tokens++; return json({ access_token: 'tok-' + S.tokens, token_type: 'Bearer', expires_in: 300, scope: 'depot:read' });
  }
  // Depot's API (behind its Worker on the real host)
  if (u.pathname.startsWith('/api/v1/')) {
    const auth = h.authorization || ''; S.bearers.add(auth);
    if (!/^Bearer tok-\d+$/.test(auth)) return json({ error: 'unauthorized', message: 'no token' }, 401);
    if (u.pathname === `/api/v1/w/${WS}/repos`) return json({ repos: [{ id: REPO, name: 'runner-pilot' }] });
    if (u.pathname === `/api/v1/repos/${REPO}/branches`) return json({ branches: [{ id: 'b1', name: 'main', tip: TIP }] });
    return json({ error: 'not_found', message: 'not found' }, 404);   // no access and missing answer the same
  }
  return json({ success: true });
};
p.on('request', answer);
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { if (!process.env.SHOT) return; const f = path.join(repo, 'scratchpad', 'depot-host-' + name + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); console.log('SHOT', f); };
const at = () => p.evaluate(() => decodeURIComponent(location.pathname));
const state = () => p.evaluate(() => document.querySelector('[data-dp-page]')?.dataset.dpPage || null);
const waitState = async (want, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await state()) === want) return true; await settle(200); } return false; };
try {
  await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
  ok(await waitState('ready'), 'the list page is ready');
  await shot('list');
  const want = new Set(PRODUCT_SCRIPTS.depot);
  ok([...scripts].every((s) => want.has(s)) && scripts.size === want.size, `the Depot host loads only Depot's ${want.size} scripts (loaded ${scripts.size})`);
  ok(await at() === `/w/${WS}/repos`, `/ goes to the workspace's repos (${await at()})`);
  ok(S.tokens === 1 && S.csrfSent, `the page asked the token route once, with the CSRF header (${S.tokens}, ${S.csrfSent})`);
  ok([...S.bearers].every((b) => /^Bearer tok-\d+$/.test(b)) && S.bearers.size >= 1, 'every Depot call carried that token as Bearer');
  ok(await p.evaluate((r) => !!document.querySelector(`[data-dp-repo="${r}"]`) && document.body.innerText.includes('runner-pilot'), REPO), 'the repo is listed by its name');
  ok(await p.evaluate(() => { const all = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }); return !all.includes('tok-'); }), 'the token is in no storage');

  await p.click(`[data-dp-repo="${REPO}"]`);
  await p.waitForSelector('[data-dp-branch="b1"]', { timeout: 15000 }).catch(() => {});
  ok(await waitState('ready') && await at() === `/w/${WS}/repos/${REPO}`, `the repo opens at its own address (${await at()})`);
  ok(await p.evaluate(() => document.body.innerText.includes('main') && !!document.querySelector('[data-dp-branch="b1"]')), 'its branch is shown with its tip');
  await shot('repo');
  await p.reload({ waitUntil: 'domcontentloaded' });
  ok(await waitState('ready') && await at() === `/w/${WS}/repos/${REPO}` && await p.evaluate(() => !!document.querySelector('[data-dp-branch="b1"]')), 'a refresh lands on the same repo');
  await p.goBack({ waitUntil: 'domcontentloaded' });
  ok(await waitState('ready') && await at() === `/w/${WS}/repos`, `Back returns to the list (${await at()})`);

  await p.goto(HOST + `/w/${WS}/repos/not-mine`, { waitUntil: 'domcontentloaded' });
  ok(await waitState('missing'), 'a repo with no access shows the not-found page');
  const missingText = await p.evaluate(() => document.querySelector('[data-dp-missing]')?.innerText || '');
  ok(/no repository at this address, or you cannot open it/.test(missingText), 'and never says which');

  S.door = false;
  const fresh = await br.newPage(); await fresh.setRequestInterception(true);
  fresh.on('request', answer);
  fresh.on('pageerror', (e) => errs.push(e.message));
  await fresh.goto(HOST + `/w/${WS}/repos`, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now(); let closedOk = false; while (Date.now() - t0 < 15000) { if (await fresh.evaluate(() => document.querySelector('[data-dp-page]')?.dataset.dpPage) === 'closed') { closedOk = true; break; } await settle(200); }
  ok(closedOk && await fresh.evaluate(() => document.body.innerText.includes('XENO staff only')), 'a closed door shows its own words');
  await fresh.close();

  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
} finally {
  await br.close(); await server.close();
}
console.log(failed ? `depot-host: ${failed} failed` : 'depot-host: all passed');
process.exit(failed ? 1 : 0);

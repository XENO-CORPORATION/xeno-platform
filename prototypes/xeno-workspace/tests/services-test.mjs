// services-test — a workspace admin's Service accounts pages (D-3), against a stand-in /api that keeps the server's
// rules (admin only; a grant is a capability tuple; every change writes an audit row).
// Proves: the list at /workspace/workspace/Services, one account at its id, the breadcrumb names it (never the id),
// refresh / Back / a fresh tab land on the same view, grant and revoke send the right calls and the history shows
// both, a non-admin sees the refusal, and an address that is not an id is refused.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5207, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]);
const WS = uuid(), SVC = uuid();
const CAPS = [['tasks', 'Tasks'], ['storage', 'Storage'], ['marketplace.listings', 'Marketplace listings']];
const db = { admin: true, grants: new Set(), audit: [], calls: [] };
const shape = () => ({ id: SVC, name: 'Release bot', username: 'release-bot', createdAt: new Date().toISOString(), capabilities: CAPS.map(([n, l]) => ({ name: n, label: l, granted: db.grants.has(n) })) });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
let p;
const open = async () => {
  p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => {
    const u = new URL(q.url());
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const method = q.method(); const path = u.pathname; db.calls.push([method, path]);
    const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return json(200, { success: true, user: USER });
    if (path === '/api/workspaces') return json(200, { success: true, workspaces: [{ id: WS, name: 'Acme', workspace_type: 'team', member_role: 'admin' }] });
    const m = path.match(/^\/api\/workspaces\/([0-9a-f-]{36})\/service-accounts(?:\/([^/]+))?(?:\/capabilities\/([^/]+))?$/);
    if (m) {
      if (!db.admin) return json(403, { success: false, code: 'not_workspace_admin', error: 'Only a workspace admin manages service accounts' });
      if (!m[2]) return json(200, { success: true, capabilities: CAPS.map(([n, l]) => ({ name: n, label: l })), serviceAccounts: [shape()] });
      if (m[2] !== SVC) return json(404, { success: false, code: 'service_account_not_found' });
      if (m[3]) {
        const cap = decodeURIComponent(m[3]); const on = method === 'PUT';
        if (on !== db.grants.has(cap)) { on ? db.grants.add(cap) : db.grants.delete(cap); db.audit.unshift({ action: on ? 'service.grant' : 'service.revoke', capability: cap, at: new Date().toISOString(), actor: 'Me' }); }
        return json(200, { success: true, changed: true, serviceAccount: shape() });
      }
      return json(200, { success: true, serviceAccount: shape(), history: db.audit });
    }
    if (path === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
    if (path === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
    if (path === '/api/workspace/needs') return json(200, { success: true, items: [] });
    return json(200, { success: true });
  });
};
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1900); };

try {
  await open();
  await fresh('/workspace/workspace/Services?ws=' + WS);
  let t = await main();
  ok(/Service account/.test(t) && /Release bot/.test(t) && /Nothing yet/.test(t), `the list shows the workspace's service account and that it may use nothing (${t.slice(0, 160).replace(/\s+/g, ' ')})`);

  await p.click('[data-xsv="open"]'); await settle(1200);
  ok(new URL(p.url()).pathname === `/workspace/workspace/Services/${SVC}`, 'opening it goes to its id address');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Release bot/.test(crumb) && !crumb.includes(SVC), `the breadcrumb names it, never its id (${crumb.replace(/\s+/g, ' ')})`);

  await p.$eval('[data-xsv-cap="storage"]', (x) => x.click()); await settle(1200);
  ok(db.grants.has('storage') && db.calls.some(([m, u]) => m === 'PUT' && u.endsWith(`/service-accounts/${SVC}/capabilities/storage`)), 'checking Storage grants it (PUT the capability)');
  t = await main();
  ok(/Granted Storage/.test(t), 'the history records the grant');

  await p.$eval('[data-xsv-cap="storage"]', (x) => x.click()); await settle(500);
  await p.evaluate(() => (document.querySelector('.xd [data-xd-ok]') || document.querySelector('.xd [data-xd-submit]'))?.click()); await settle(1200);
  ok(!db.grants.has('storage') && db.calls.some(([m, u]) => m === 'DELETE' && u.endsWith('/capabilities/storage')), 'unchecking asks, then revokes (DELETE the capability)');
  t = await main();
  ok(/Revoked Storage/.test(t) && /Granted Storage/.test(t), 'the history shows the grant and the revoke');

  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1900);
  ok(new URL(p.url()).pathname === `/workspace/workspace/Services/${SVC}` && /Release bot/.test(await main()), 'refresh lands on the same service account');
  await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(1500);
  ok(new URL(p.url()).pathname === '/workspace/workspace/Services' && /Release bot/.test(await main()), 'Back returns to the list');

  const tab = p; await open();
  await fresh(`/workspace/workspace/Services/${SVC}?ws=${WS}`);
  ok(/Release bot/.test(await main()) && /What it may use/.test(await main()), 'a fresh tab at the id opens the same view');
  await tab.close();

  await fresh('/workspace/workspace/Services/Release%20bot?ws=' + WS);
  ok(/not valid/.test(await main()), 'an address by name is not a service account address');

  db.admin = false;
  await fresh('/workspace/workspace/Services?ws=' + WS);
  ok(/Only a workspace admin/.test(await main()), 'a non-admin is told only an admin manages service accounts');
  ok(!p.errs.length, `no page errors (${p.errs.join(' | ')})`);
} catch (e) { failed++; console.log('FAIL threw', e.message); }
finally { await br.close(); await server.close(); }
console.log(failed ? `${failed} FAILED` : 'services-test: all passed'); process.exit(failed ? 1 : 0);

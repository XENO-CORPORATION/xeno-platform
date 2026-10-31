// site-access-test — Support ▸ Site access: the admin console for personal site access codes (routes/siteGateRoutes.js
// /api/site-gate/codes), against a stand-in that answers like the real routes (403 to anyone but an admin).
// Proves: a non-admin has no Site access tab and no page; an admin creates a code at /workspace/support/access, sees it
// ONCE with the mail wording, the list never shows it again, Usage reads the audit, Revoke takes two presses.
import { shot } from './shot.mjs';
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5251, base = 'http://127.0.0.1:' + PORT;
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const now = () => new Date().toISOString();
let STAFF = false;
const USER = () => ({ id: 'u1', username: STAFF ? 'mod' : 'ada', email: 'a@x.test', display_name: STAFF ? 'Mod' : 'Ada', avatar_url: null, email_verified: true, role: STAFF ? 'admin' : 'user' });
const db = { codes: [], calls: [] };
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
const view = (c) => ({ ...c, live: !c.revokedAt });
const handler = (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER() });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname.startsWith('/api/support/')) return json(u.pathname.endsWith('/mine') ? 200 : 403, { success: true, tickets: [] });
  if (u.pathname.startsWith('/api/site-gate/codes')) {
    if (!STAFF) return json(403, { success: false, error: 'Admin access required' });
    if (u.pathname === '/api/site-gate/codes' && method === 'GET') return json(200, { codes: db.codes.map(view) });
    if (u.pathname === '/api/site-gate/codes' && method === 'POST') {
      const c = { id: '00000000-0000-4000-8000-00000000000' + db.codes.length, label: b.label, scope: b.scope, expiresAt: new Date(Date.now() + b.days * 86400_000).toISOString(), maxUses: b.maxUses, uses: 0, revokedAt: null, lastUsedAt: null, accounts: 0 };
      db.codes.push(c); return json(201, { code: 'XENO-ABCDE-FGHJK-MNPQR-STVWX', accessCode: view(c) });
    }
    const m = u.pathname.match(/codes\/([0-9a-f-]+)\/(events|revoke)$/);
    if (m && m[2] === 'events') return json(200, { events: [{ event: 'redeemed', country: 'DE', at: new Date().toISOString(), actor: null }, { event: 'created', at: new Date().toISOString(), actor: 'a@x.test' }] });
    if (m && m[2] === 'revoke') { const c = db.codes.find((x) => x.id === m[1]); c.revokedAt = new Date().toISOString(); return json(200, { accessCode: view(c) }); }
  }
  const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER(), credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/tasks': { success: true, tasks: [] } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
};
p.on('request', handler);
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
try {
  await p.goto(base + '/workspace/support', { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!(await p.$('#main [data-sp-go="access"]')), 'a non-admin sees no Site access tab');
  await p.goto(base + '/workspace/support/access', { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!(await p.$('#main [data-sp-create="access"]')), 'a non-admin gets no console at its address');
  STAFF = true;
  await p.goto(base + '/workspace/support/access', { waitUntil: 'domcontentloaded' }); await settle(1800);
  await shot(p, 'site-access');
  ok(/Site access/.test(await main()) && !!(await p.$('#main .topbar .pg-top-acts [data-sp-create="access"]')), 'an admin opens the console at /workspace/support/access, Create code right-aligned in the header bar');
  ok(!!(await p.$('#main .topbar .pg-top-tabs [data-sp-go="access"][aria-selected="true"]')) && !!(await p.$('#main .topbar .pg-top-tabs [data-sp-go=""]')) && !(await p.$('#main .mview .pg-tabs')), 'My requests · Site access are tabs in the header bar, not a row in the body');
  ok(!(await p.$('#main .mview form')), 'no create form is stacked above the list');
  await p.click('#main .topbar [data-sp-create="access"]'); await settle(400);
  ok(!!(await p.$('.xd-sh[role="dialog"] #xdf-label')), 'Create code opens the workspace dialog');
  await shot(p, 'site-access-create');
  await p.type('.xd-sh #xdf-label', 'Investor — Example Fund');
  await p.click('.xd-sh [data-v="account"]');
  await p.click('.xd-sh [data-xd-submit]'); await settle(1000);
  ok(!(await p.$('.xd-sh[role="dialog"]')), 'the dialog closes once the code is made');
  const made = db.calls.find(([mm, pth]) => mm === 'POST' && pth === '/api/site-gate/codes');
  ok(made && made[2].scope === 'account' && made[2].days === 30 && made[2].label === 'Investor — Example Fund', 'Create posts label, scope and the 30-day default');
  ok(/XENO-ABCDE-FGHJK-MNPQR-STVWX/.test(await main()) && /xenosystem\.ai — access code XENO-ABCDE/.test(await main()), 'the new code is shown once, with the mail wording');
  ok(/Investor — Example Fund/.test(await main()) && /Pages \+ account/.test(await main()), 'the list shows the code by its label and scope');
  await p.click('#main [data-sac-done]'); await settle(400);
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!/XENO-ABCDE/.test(await main()) && /Example Fund/.test(await main()), 'after Done or a refresh the code is never shown again');
  await p.click('#main [data-sac-events]'); await settle(800);
  ok(/redeemed/.test(await main()) && /DE/.test(await main()), 'Usage shows the audit');
  await p.click('#main [data-sac-revoke]'); await settle(300);
  ok(!db.calls.some(([, pth]) => /\/revoke$/.test(pth)), 'the first press only arms revoke');
  await p.click('#main [data-sac-revoke]'); await settle(1000);
  ok(db.calls.some(([mm, pth]) => mm === 'POST' && /\/revoke$/.test(pth)) && /Revoked/.test(await main()), 'the second press revokes');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);

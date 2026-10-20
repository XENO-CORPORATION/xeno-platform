import { shot } from './shot.mjs';
// Corpo › Customers is real: the workspace's own CRM from /api/customers (a stand-in here).
//   1. no sample rows ("Acme renewal €12k") and no "Preview — sample data" mark
//   2. add a contact → it opens at its id address (/workspace/…/customers/contacts/<id>), refresh lands on it
//   3. an agent's draft note shows as a draft; Keep sends it to /keep
//   4. support tickets show on the record; the pipeline moves a deal; a CSV import previews before it runs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5213, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const CID = '11111111-1111-4111-8111-111111111111';
const stages = [['s1', 'Lead'], ['s2', 'Qualified'], ['s3', 'Won']].map(([id, name]) => ({ id, name, outcome: name === 'Won' ? 'won' : 'open', deals: [], totalCents: 0 }));
const db = { calls: [], contacts: [], deal: { id: 'd1', title: 'Renewal', amountCents: 120000, currency: 'EUR', stageId: 's1', stageName: 'Lead', state: 'active', contactName: 'Ada' } };
const contactFull = (c) => ({ ...c, deals: [db.deal], activities: [{ id: 'a1', kind: 'call', body: 'Agent: called, wants a quote', state: db.kept ? 'kept' : 'draft', agentDrafted: true, authorName: 'Juno', createdAt: new Date().toISOString() }],
  tickets: [{ key: 'T-9', title: 'Login broken', status: 'new' }], tasks: [] });

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/customers')) db.calls.push([q.method(), u.pathname + u.search, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/customers/summary') return json({ success: true, summary: { contacts: db.contacts.length, companies: 0, openDeals: 1, openCents: 120000, drafts: db.kept ? 0 : 1 } });
    if (u.pathname === '/api/customers/contacts' && q.method() === 'GET') return json({ success: true, contacts: db.contacts });
    if (u.pathname === '/api/customers/contacts' && q.method() === 'POST') { const c = { id: CID, name: sent.name, email: sent.email, tags: [], companyName: null }; db.contacts.push(c); return json({ success: true, contact: c }); }
    if (u.pathname === `/api/customers/contacts/${CID}`) return json({ success: true, contact: contactFull(db.contacts[0] || { id: CID, name: 'Ada', email: 'ada@x.example', tags: [] }) });
    if (u.pathname === '/api/customers/activities/a1/keep') { db.kept = true; return json({ success: true }); }
    if (u.pathname === '/api/customers/companies') return json({ success: true, companies: [] });
    if (u.pathname === '/api/customers/pipeline') return json({ success: true, pipeline: { stages: stages.map((s) => ({ ...s, deals: s.id === db.deal.stageId ? [db.deal] : [] })) } });
    if (u.pathname === '/api/customers/deals/d1/move') { db.deal.stageId = sent.stageId; return json({ success: true, deal: db.deal }); }
    if (u.pathname === '/api/customers/import') return json({ success: true, report: { rows: 2, created: 1, merged: 0, skipped: 1, invalid: [], confirm: !!sent.confirm } });
    if (u.pathname.startsWith('/api/customers/')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800); await shot(p, 'customers');
  return { p, errs };
}

try {
  const { p, errs } = await open('/workspace/#/corpo/z/customers');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-cr-page]')?.dataset.crPage, live: !!(window.XENO_ZONE_LIVE || {})['corpo.customers'], mark: !!document.querySelector('#main [data-sample-badge]'), panelMark: !!document.querySelector('#panel [data-sample-badge]'), fake: document.body.textContent.includes('€12k') }));
  ok(s0.page === 'ready' && s0.live && !s0.mark && !s0.panelMark && !s0.fake, `Customers is real: no sample rows, no sample mark (${JSON.stringify(s0)})`);
  ok(await p.$('[data-cr-empty]') !== null, 'an empty workspace says so');

  ok(await p.$('#main .topbar .pg-top-acts [data-cr-add]') !== null, 'New contact sits right in the header bar');
  ok(await p.$('#main .topbar .pg-top-tabs [data-cr-view-go="contacts"][aria-selected="true"]') !== null && await p.$('#main .topbar .pg-top-tabs [data-cr-view-go="pipeline"]') !== null && await p.$('#main .mview .pg-tabs, #main .mview [data-cr-view-go]') === null, 'the views are tabs in the header bar, not a row in the body');
  await p.click('#main .topbar [data-cr-add]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-name') !== null && await p.$('#main .mview input[placeholder="Name"]') === null, 'New contact opens the workspace dialog, not a form in the page');
  await p.type('.xd-sh #xdf-name', 'Ada Lovelace'); await p.type('.xd-sh #xdf-email', 'ada@x.example');
  await p.click('.xd-sh [data-xd-submit]'); await wait(1200);
  const post = db.calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/customers/contacts'));
  ok(post && post[2].name === 'Ada Lovelace' && post[2].email === 'ada@x.example', 'the contact is created on the server');
  const url1 = await p.evaluate(() => location.pathname);
  ok(url1.endsWith(`/customers/contacts/${CID}`), `it opens at its id address (${url1})`);
  ok(await p.$(`[data-cr-contact="${CID}"]`) !== null, 'the contact page shows');
  ok(await p.$('[data-cr-act="a1"][data-cr-state="draft"]') !== null && await p.$('[data-cr-keep="a1"]') !== null, 'an agent’s note shows as a draft with Keep');
  ok(await p.$('[data-cr-ticket="T-9"]') !== null, 'the customer’s support ticket shows on the record');
  await p.click('[data-cr-keep="a1"]'); await wait(900);
  ok(db.calls.some((x) => x[1].startsWith('/api/customers/activities/a1/keep')) && await p.$('[data-cr-act="a1"][data-cr-state="kept"]') !== null, 'Keep keeps it');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();

  // a fresh tab on the contact's address lands on it
  const t2 = await open(url1);
  ok(await t2.p.$(`[data-cr-contact="${CID}"]`) !== null, 'a fresh tab on the address lands on the contact');
  await t2.p.goto(base + url1.replace(/\/contacts\/.*$/, '/pipeline'), { waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await t2.p.$('[data-cr-board] [data-cr-deal="d1"]') !== null, 'the pipeline shows the deal in its stage');
  await t2.p.select('[data-cr-move="d1"]', 's2'); await wait(900);
  ok(db.calls.some((x) => x[1].startsWith('/api/customers/deals/d1/move') && x[2].stageId === 's2') && await t2.p.$('[data-cr-stage="s2"] [data-cr-deal="d1"]') !== null, 'moving a deal changes its stage');
  await t2.p.goto(base + url1.replace(/\/contacts\/.*$/, '/import'), { waitUntil: 'domcontentloaded' }); await wait(1800);
  await t2.p.type('[data-cr-csv]', 'name,email\nGrace,grace@x.example');
  await t2.p.click('[data-cr-preview]'); await wait(700);
  const imp = db.calls.filter((x) => x[1].startsWith('/api/customers/import'));
  ok(imp.length === 1 && imp[0][2].confirm === false && /Preview/.test(await t2.p.$eval('[data-cr-report]', (e) => e.textContent)), 'an import previews first (dry run)');
  ok(!t2.errs.length, `no page errors (${t2.errs.join(' | ')})`);
  await t2.p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);

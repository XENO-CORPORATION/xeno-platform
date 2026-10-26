import { shot } from './shot.mjs';
// Dev › Compute is real: XENO Compute's machines from /api/compute (a stand-in here).
//   1. Compute is a live area; with no prices set it says machines cannot start yet
//   2. New machine opens the workspace dialog; the machine opens at its id address
//      (/workspace/dev/spaces/compute/machines/<mch_…>) and a fresh tab lands on it
//   3. Start / Stop reach the server; an unfunded machine says it keeps running and will stop
//   4. Usage shows machine time by machine and the AI-vs-machines split; Budgets lists the caps
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5217, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const MID = 'mch_' + 'a'.repeat(32);
const db = { calls: [], machines: [], priced: false, unfunded: false };
const sizes = () => [{ size: 'small', vcpus: 2, memoryGb: 4, diskGb: 20, priced: db.priced, creditsPerHour: db.priced ? 36 : null }];
const machineFull = (m) => ({ ...m, unfundedSince: db.unfunded ? new Date().toISOString() : null,
  events: [{ kind: 'created', detail: { size: 'small' }, at: new Date().toISOString() }, ...(db.unfunded ? [{ kind: 'unfunded', detail: { reason: 'Not enough credits to run this machine for the next hour', stopsInSeconds: 900 }, at: new Date().toISOString() }] : [])] });

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/compute')) db.calls.push([q.method(), u.pathname + u.search, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/compute/sizes') return json({ success: true, sizes: sizes() });
    if (u.pathname === '/api/compute/machines' && q.method() === 'GET') return json({ success: true, machines: db.machines });
    if (u.pathname === '/api/compute/machines' && q.method() === 'POST') { const m = { id: MID, name: sent.name, size: sent.size, state: 'stopped', agent: null, costSoFarCredits: 0, url: `/workspace/compute/machines/${MID}`, createdAt: new Date().toISOString() }; db.machines.push(m); return json({ success: true, machine: m }); }
    if (u.pathname === `/api/compute/machines/${MID}`) return json({ success: true, machine: machineFull(db.machines[0] || { id: MID, name: 'Build box', size: 'small', state: 'stopped', costSoFarCredits: 0 }) });
    if (u.pathname === `/api/compute/machines/${MID}/start`) { if (!db.priced) return json({ success: false, error: 'XENO Compute has no price for the small size yet, so it cannot run', code: 'no_price' }, 409); db.machines[0].state = 'running'; return json({ success: true, machine: db.machines[0] }); }
    if (u.pathname === `/api/compute/machines/${MID}/stop`) { db.machines[0].state = 'stopped'; db.machines[0].costSoFarCredits = 18; return json({ success: true, machine: db.machines[0] }); }
    if (u.pathname === '/api/compute/usage') return json({ success: true, usage: { machineCredits: 18, byMachine: [{ id: MID, name: 'Build box', size: 'small', credits: 18, hours: 0.5 }], byAgent: [{ agent: null, credits: 18 }] } });
    if (u.pathname === '/api/compute/usage/split') return json({ success: true, split: { aiCredits: 4.5, machineCredits: 18 } });
    if (u.pathname === '/api/compute/caps') return json({ success: true, caps: [{ scope: 'workspace', scopeId: 'w', maxMachines: 3, maxSize: 'small', monthlyCredits: 500 }] });
    if (u.pathname.startsWith('/api/compute/')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800); await shot(p, 'compute');
  return { p, errs };
}

try {
  const { p, errs } = await open('/workspace/#/dev/z/compute');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-cm-page]')?.dataset.cmPage, live: !!(window.XENO_ZONE_LIVE || {})['dev.compute'], mark: !!document.querySelector('#main [data-sample-badge]') }));
  ok(s0.page === 'ready' && s0.live && !s0.mark, `Compute is a live area with no sample mark (${JSON.stringify(s0)})`);
  ok(await p.$('[data-cm-unpriced]') !== null, 'with no prices set, it says machines cannot start yet');
  ok(await p.$('[data-cm-empty]') !== null, 'an empty workspace says so');
  ok(await p.$('#main .topbar .pg-top-acts [data-cm-add]') !== null && await p.$('#main .topbar .pg-top-tabs [data-cm-view-go="machines"][aria-selected="true"]') !== null, 'New machine and the views sit in the header bar');
  await p.click('#main .topbar [data-cm-add]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-name') !== null, 'New machine opens the workspace dialog');
  await p.type('.xd-sh #xdf-name', 'Build box');
  await p.click('.xd-sh [data-xd-submit]'); await wait(1200);
  const post = db.calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/compute/machines'));
  ok(post && post[2].name === 'Build box' && post[2].size === 'small' && post[2].idempotencyKey, 'the machine is created on the server, with an idempotency key');
  const url1 = await p.evaluate(() => location.pathname);
  ok(url1.endsWith(`/compute/machines/${MID}`), `it opens at its id address (${url1})`);
  ok(await p.$(`[data-cm-machine="${MID}"]`) !== null && await p.$('[data-cm-start]') !== null, 'the machine page shows, with Start');
  await p.click('[data-cm-start]'); await wait(900);
  ok(db.calls.some((x) => x[1].startsWith(`/api/compute/machines/${MID}/start`)) && db.machines[0].state === 'stopped', 'Start reaches the server; an unpriced size is refused and nothing changes');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();

  db.priced = true;
  const t2 = await open(url1);
  ok(await t2.p.$(`[data-cm-machine="${MID}"]`) !== null, 'a fresh tab on the address lands on the machine');
  await t2.p.click('[data-cm-start]'); await wait(1200);
  ok(db.machines[0].state === 'running' && await t2.p.$('[data-cm-stop]') !== null, 'once priced, Start runs it and offers Stop');
  db.unfunded = true;
  await t2.p.goto(base + url1, { waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await t2.p.$('[data-cm-unfunded]') !== null && await t2.p.$('[data-cm-event="unfunded"]') !== null, 'an unfunded machine says it keeps running and will stop, and its timeline shows why');
  await t2.p.click('[data-cm-stop]'); await wait(1200);
  ok(db.calls.some((x) => x[1].startsWith(`/api/compute/machines/${MID}/stop`)), 'Stop reaches the server');
  await t2.p.goto(base + url1.replace(/\/machines\/.*$/, '/usage'), { waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await t2.p.$('[data-cm-split]') !== null && (await t2.p.$eval('[data-cm-split]', (e) => e.textContent)).includes('AI'), 'Usage shows what you used on AI versus machines');
  ok(await t2.p.$(`[data-cm-by-machine] [data-cm-open="${MID}"]`) !== null, 'and machine time by machine');
  await t2.p.goto(base + url1.replace(/\/machines\/.*$/, '/budgets'), { waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await t2.p.$('[data-cm-cap-row="workspace"]') !== null, 'Budgets lists the workspace cap');
  ok(!t2.errs.length, `no page errors (${t2.errs.join(' | ')})`);
} finally {
  await b.close(); await server.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

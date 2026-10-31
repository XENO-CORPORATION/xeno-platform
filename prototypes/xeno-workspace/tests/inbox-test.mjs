// The Inbox shows what was written for the person and keeps its state on the platform, not in this browser.
//   1. the page lists the server's rows and no sample activity; what asks something sits under Needs you
//   2. archive and snooze are sent to the server and survive a fresh browser profile; undo sends the reverse
//   3. a refused write takes the change back and says so
//   4. a row opens at its own address and is read on the server
//   5. the digest and levels are saved on the server; desktop asks the browser and a no is said
//   6. a row that arrives later rings once; the first load rings nothing
import { shot } from './shot.mjs';
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5223, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, host: '127.0.0.1', strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const WS = '33333333-3333-4333-8333-333333333333';
const R = (id) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(id).padStart(12, '0')}`;
const AGENT = 'agt_realagent', FLOW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = (id, o) => ({ id: R(id), source: 'tasks', kind: 'status', ref: 'T-1', title: 'A row', detail: '', area: null, read: false, at: new Date(Date.now() - id * 60000).toISOString(), archived: false, snoozedUntil: null, label: 'Update', asks: false, actor: null, ...o });
const fresh = () => ({ writes: [], fail: false, prefs: { digest: 'off', levels: {} }, items: [
  row(1, { kind: 'run_failed', source: 'agents', title: 'Real Agent failed a run', label: 'Run failed', asks: true, ref: `/workspace/workspace/Agents/${AGENT}/Work`, area: 'dev', actor: { name: 'Real Agent', kind: 'agent' } }),
  row(2, { kind: 'assigned', title: 'T-9 · Real task', label: 'Assigned', asks: true, ref: 'T-9' }),
  row(3, { kind: 'workflow_failed', source: 'automate', title: 'Real Workflow failed', label: 'Run failed', asks: true, ref: `/workspace/dev/spaces/automate/workflows/${FLOW}`, area: 'dev' }),
  row(4, { kind: 'shared', source: 'storage', title: 'Sam shared Designs with you', label: 'Shared', ref: '/workspace/library', read: true }),
] });
let db = fresh();
const SAMPLES = /Atlas finished|Nightly asset sync|Invoice paid|3 posts scheduled/;

async function open(url, { ctx } = {}) {
  const p = await (ctx || b).newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const m = q.method(), body = () => JSON.parse(q.postData() || '{}');
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [{ id: WS, name: 'Real Co', slug: 'real-co', member_role: 'owner', workspace_type: 'company' }] });
    if (u.pathname === '/api/workspace/needs') return json({ success: true, items: [] });
    if (u.pathname === '/api/notifications/prefs') { if (m === 'PUT') { db.writes.push(['prefs', body()]); db.prefs = { ...db.prefs, ...body() }; } return json({ success: true, prefs: db.prefs }); }
    if (u.pathname === '/api/notifications') return json({ success: true, unread: db.items.filter((x) => !x.read).length, items: db.items, prefs: db.prefs });
    const act = u.pathname.match(/^\/api\/notifications\/(read|archive|snooze)$/);
    if (act) {
      const x = body(); db.writes.push([act[1], x]);
      if (db.fail) return json({ success: false, error: 'nope' }, 500);
      for (const it of db.items) if (x.ids.includes(it.id)) {
        if (act[1] === 'read') it.read = x.read !== false;
        if (act[1] === 'archive') { it.archived = x.archived !== false; if (it.archived) it.read = true; }
        if (act[1] === 'snooze') { it.snoozedUntil = x.until; if (x.until) it.read = false; }
      }
      return json({ success: true, unread: 0, items: [] });
    }
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const page = (p) => p.evaluate(() => document.querySelector('.rp-page')?.innerText || '');
const clickRow = (p, title, sel) => p.evaluate((t, s) => { const r = [...document.querySelectorAll('.rp-page .nt2')].find((x) => x.innerText.includes(t)); if (!r) return false; (s ? r.querySelector(s) : r).click(); return true; }, title, sel);
const tab = (p, k) => p.evaluate((x) => document.querySelector(`.rp-page [data-nt-tab="${x}"]`)?.click(), k);
const undo = (p) => p.evaluate(() => { const u = [...document.querySelectorAll('button')].find((x) => /^undo$/i.test(x.innerText.trim())); u?.click(); return !!u; });
const address = (p) => p.evaluate(() => location.pathname);

try {
  {
    const { p, errs } = await open('/workspace/inbox?ws=' + WS);
    let t = await page(p);
    ok(/Real Agent failed a run/.test(t) && /T-9 · Real task/.test(t) && /Sam shared Designs/.test(t) && !SAMPLES.test(t), 'the Inbox lists the server’s rows and no sample');
    ok(/Needs you/.test(t) && t.indexOf('Needs you') < t.indexOf('Real Agent failed'), 'what asks something sits under Needs you');
    await shot(p, 'inbox-list');

    // archive: to the server, and undo sends the reverse
    ok(await clickRow(p, 'T-9 · Real task', '[data-nt-arch]'), 'a row has Archive'); await wait(300);
    let w = db.writes.find((x) => x[0] === 'archive');
    ok(w && w[1].ids[0] === R(2) && w[1].archived === true, 'archive goes to the server');
    ok(!/T-9 · Real task/.test(await page(p)), 'and the row leaves the inbox at once');
    ok(await undo(p), 'Undo is offered'); await wait(400);
    ok(db.writes.some((x) => x[0] === 'archive' && x[1].archived === false), 'undo sends the reverse');
    ok(/T-9 · Real task/.test(await page(p)), 'and the row is back');

    // snooze: a real time
    await clickRow(p, 'T-9 · Real task', '[data-nt-snz]'); await wait(200);
    await p.evaluate(() => [...document.querySelectorAll('.rp-page [data-nt-snooze]')].find((x) => /Tomorrow/.test(x.innerText)).click()); await wait(300);
    w = db.writes.find((x) => x[0] === 'snooze');
    const when = w && new Date(w[1].until);
    ok(when && when.getTime() > Date.now() && when.getHours() === 9, `snooze sends a real time, 9:00 tomorrow (${w && w[1].until})`);
    await tab(p, 'snoozed'); await wait(300);
    t = await page(p);
    ok(/T-9 · Real task/.test(t), 'it is in Snoozed');
    await shot(p, 'inbox-snoozed');
    await tab(p, 'inbox'); await wait(200);
    ok(errs.length === 0, `no page errors (${errs[0] || ''})`);
    await p.close();
  }
  {
    // the state came from the server: a browser that never did any of this shows the same
    const ctx = await b.createBrowserContext();
    const { p } = await open('/workspace/inbox?ws=' + WS, { ctx });
    ok(!/T-9 · Real task/.test(await page(p)), 'another browser does not show the snoozed row in the inbox');
    await tab(p, 'snoozed'); await wait(300);
    ok(/T-9 · Real task/.test(await page(p)), 'and shows it in Snoozed: it followed the person');
    await p.close(); await ctx.close();
  }
  {
    // a row whose time has passed is back
    db = fresh(); db.items[1].snoozedUntil = new Date(Date.now() - 60000).toISOString();
    const { p } = await open('/workspace/inbox?ws=' + WS);
    ok(/T-9 · Real task/.test(await page(p)), 'a row whose snooze has passed is back in the inbox');
    // a refused write takes the change back
    db.fail = true;
    await clickRow(p, 'Real Workflow failed', '[data-nt-arch]'); await wait(500);
    ok(/Real Workflow failed/.test(await page(p)), 'a refused archive puts the row back');
    ok(/could not be changed/.test(await p.evaluate(() => document.body.innerText)), 'and says so');
    db.fail = false; await p.close();
  }
  {
    // opening: its own address, read on the server
    db = fresh();
    const { p } = await open('/workspace/inbox?ws=' + WS);
    await clickRow(p, 'Real Agent failed a run'); await wait(600);
    ok((await address(p)).endsWith(`/workspace/Agents/${AGENT}/Work`), `an agent's row opens its page (${await address(p)})`);
    ok(db.writes.some((x) => x[0] === 'read' && x[1].ids[0] === R(1)), 'and it is read on the server');
    await p.close();
    const o2 = await open('/workspace/inbox?ws=' + WS);
    await clickRow(o2.p, 'Real Workflow failed'); await wait(600);
    ok((await address(o2.p)).endsWith(`/dev/spaces/automate/workflows/${FLOW}`), `a workflow's row opens the workflow (${await address(o2.p)})`);
    await o2.p.close();
    const o3 = await open('/workspace/inbox?ws=' + WS);
    await clickRow(o3.p, 'T-9 · Real task'); await wait(600);
    ok(/tasks\/T-9$/.test(await address(o3.p)), `a task's row opens the task (${await address(o3.p)})`);
    await o3.p.close();
  }
  {
    // mark all read
    db = fresh();
    const { p } = await open('/workspace/inbox?ws=' + WS);
    await p.evaluate(() => document.querySelector('.rp-page [data-nt-all]')?.click()); await wait(400);
    const w = db.writes.find((x) => x[0] === 'read');
    ok(w && w[1].ids.length === 3, 'Mark all read reads the unread rows on the server');
    await undo(p); await wait(300);
    ok(db.writes.some((x) => x[0] === 'read' && x[1].read === false), 'undo makes them unread again');
    await p.close();
  }
  {
    // preferences
    db = fresh(); db.prefs = { digest: 'weekly', levels: { dev: 'needs' } };
    const { p } = await open('/workspace/settings/notifications?ws=' + WS);
    ok(await p.evaluate(() => document.querySelector('[data-set="ntdigest"][data-arg="weekly"]')?.getAttribute('aria-checked') === 'true'), 'Settings shows the digest the server holds');
    await p.evaluate(() => document.querySelector('[data-set="ntdigest"][data-arg="daily"]').click()); await wait(400);
    ok(db.writes.some((x) => x[0] === 'prefs' && x[1].digest === 'daily'), 'choosing a digest saves it on the server');
    await p.evaluate(() => document.querySelector('[data-set="ntlevel"][data-arg="dev=off"]').click()); await wait(400);
    ok(db.writes.some((x) => x[0] === 'prefs' && x[1].levels && x[1].levels.dev === 'off'), 'a level is saved on the server');
    // the browser says no to desktop notifications: said, and the switch stays off
    await p.evaluate(() => { window.Notification = class { static permission = 'denied'; static requestPermission() { return Promise.resolve('denied'); } }; });
    await p.evaluate(() => document.querySelector('[data-set="ntdevice"][data-arg="desktop"]').click()); await wait(400);
    ok(/did not allow notifications/.test(await p.evaluate(() => document.body.innerText)), 'a browser’s no is said');
    ok(await p.evaluate(() => document.querySelector('[data-set="ntdevice"][data-arg="desktop"]').getAttribute('aria-checked') === 'false'), 'and the switch stays off');
    await p.close();
  }
  {
    // arriving: only new rows ring
    db = fresh();
    const { p } = await open('/workspace/inbox?ws=' + WS);
    await p.evaluate(() => { window.__rung = []; const was = window.XENO_NT.arrived; window.XENO_NT.arrived = (r) => { window.__rung.push(...r.map((x) => x.t)); was(r); }; });
    await p.evaluate(() => window.XENO_AREA_LIVE.loadNeeds()); await wait(400);
    ok((await p.evaluate(() => window.__rung.length)) === 0, 'loading again rings nothing');
    db.items.unshift(row(0, { kind: 'mentioned', title: 'Something new', label: 'Mention', asks: true }));
    await p.evaluate(() => window.XENO_AREA_LIVE.loadNeeds()); await wait(400);
    ok(JSON.stringify(await p.evaluate(() => window.__rung)) === '["Something new"]', 'a new row rings once');
    ok(/Something new/.test(await page(p)), 'and is in the inbox');
    await p.close();
  }
} catch (e) { fails++; console.log('FAIL threw', e.message); }
finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);

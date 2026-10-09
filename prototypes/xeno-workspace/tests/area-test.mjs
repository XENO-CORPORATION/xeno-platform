// platform-area.js: on the platform, Scheduled, Needs you, the Inbox and Ctrl K are the person's own, per area.
// A stand-in platform answers the routes; the suite is about the workspace's side.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5193, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString(), soon = (h) => new Date(Date.now() + h * 3600000).toISOString();
const CV = '00000001-0000-4000-8000-000000000000', CM = '00000002-0000-4000-8000-000000000000';
const db = {};
const reset = () => Object.assign(db, { balance: 321, billDown: false, calls: [], down: false, refuse: false, slow: 0, settings: { models: { defaultModel: 'acct-model' }, areas: { dev: { model: 'dev-model' } } },
  tasks: [
    { id: 't-dev', title: 'Dev digest', prompt: 'Summarise the repo', cadence_label: 'Every day · 09:00', status: 'active', next_run_at: soon(5), area: 'dev', project_id: null, last_run_status: 'failed', last_run_error: 'The model was not available' },
    { id: 't-studio', title: 'Studio brief', prompt: 'What changed', cadence_label: 'Weekdays · 08:30', status: 'paused', next_run_at: soon(9), area: 'studio', project_id: null, last_run_status: 'succeeded', last_run_error: null },
    { id: 't-none', title: 'Loose <b>one</b>', prompt: 'p', cadence_label: 'Once · Oct 12, 10:00', status: 'active', next_run_at: soon(40), area: null, project_id: null, last_run_status: null, last_run_error: null },
    { id: 't-gone', title: 'Cancelled one', prompt: 'p', cadence_label: 'Every day · 07:00', status: 'cancelled', next_run_at: soon(2), area: 'dev', project_id: null, last_run_status: null, last_run_error: null },
  ],
  convs: [{ id: CV, title: 'Zebra plan', updated_at: iso(2), last_message_at: iso(2), project_id: null, area: 'dev' }] });
const CHAT = `<!doctype html><html><body><div class="chat-themed"><div data-chat-composer-shell></div></div><script>const say = () => parent.postMessage({ source: 'xeno-chat', type: 'location', path: location.pathname, title: 'Chat' }, location.origin); addEventListener('popstate', say); say();</script></body></html>`;
async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: CHAT });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/chat/scheduled') || u.pathname.startsWith('/api/workspace/')) db.calls.push([q.method(), u.pathname + u.search, sent, q.headers()['x-xeno-area'] || null]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/chat/scheduled' && q.method() === 'GET') { if (db.down) return json({ success: false, error: 'Internal server error' }, 500); const want = u.searchParams.get('area'); return json({ success: true, tasks: db.tasks.filter((t) => want === null || (want === 'none' ? !t.area : t.area === want)) }); }
    if (u.pathname === '/api/chat/scheduled' && q.method() === 'POST') { if (db.refuse) return json({ success: false, error: 'Schedule has no future occurrence' }, 400); const t = { id: 't-new', status: 'active', next_run_at: soon(20), project_id: null, last_run_status: null, last_run_error: null, ...sent }; db.tasks.push(t); return json({ success: true, task: t }); }
    const one = u.pathname.match(/^\/api\/chat\/scheduled\/([^/]+)$/);
    if (one) { const t = db.tasks.find((x) => x.id === one[1]); if (!t) return json({ success: false, error: 'Task not found' }, 404); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500);
      if (q.method() === 'PUT') { Object.assign(t, sent); return json({ success: true, task: t }); }
      if (q.method() === 'DELETE') { t.status = 'cancelled'; return json({ success: true }); } }
    if (u.pathname === '/api/workspace/needs') return json({ success: true, items: db.tasks.filter((t) => t.status !== 'cancelled' && t.last_run_status === 'failed').map((t) => ({ kind: 'schedule_failed', id: t.id, title: t.title, detail: t.last_run_error, area: t.area, conversation_id: null, at: iso(1) })) });
    if (u.pathname === '/api/workspace/search') { if (db.slow) await wait(db.slow); const qq = (u.searchParams.get('q') || '').toLowerCase(); if (qq !== 'zebra') return json({ success: true, query: qq, results: [], counts: {} });
      return json({ success: true, query: qq, results: [
        { kind: 'chat', id: CM, title: 'Lunch <i>notes</i>', snippet: '…repaint the zebra crossing before launch…', matched: 'message', area: 'studio', at: iso(3) },
        { kind: 'chat', id: CV, title: 'Zebra plan', snippet: '', matched: 'title', area: 'dev', at: iso(2) },
        { kind: 'chat', id: '00000009-0000-4000-8000-000000000000', title: 'Zebra budget', snippet: '', matched: 'title', area: 'dev', at: iso(9) },
        { kind: 'project', id: 'p-9', title: 'Zebra habitat', snippet: '', matched: 'name', area: 'office', at: iso(4) }], counts: {} }); }
    if (u.pathname === '/api/chat/conversations') { const want = u.searchParams.get('area'); const rows = want === null ? db.convs : db.convs.filter((c) => (want === 'none' ? !c.area : c.area === want)); return json({ success: true, conversations: rows, total: rows.length }); }
    if (u.pathname === '/api/user-data/settings') return json({ success: true, settings: db.settings });
    if (u.pathname === '/api/billing/overview') return db.billDown ? json({ success: false, error: 'Internal server error' }, 500) : json({ success: true, overview: { credits: { balance: db.balance }, subscription: null } });
    if (u.pathname === '/api/v2/ledger/usage') { const days = Math.round((Date.now() - Date.parse(u.searchParams.get('from'))) / 86400000), model = u.searchParams.get('groupBy') === 'model';
      if (days <= 1) return json({ from: '', to: '', groupBy: '', rows: [] });
      return json({ from: '', to: '', groupBy: '', rows: model ? [{ key: 'model-x', events: 4, costMicro: 30e6 }, { key: 'model-y', events: 1, costMicro: 12e6 }] : [{ key: 'xeno_chat', events: 5, costMicro: days > 7 ? 42e6 : 17e6 }, { key: 'free_thing', events: 3, costMicro: 0 }] }); }
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [] });
    const body = { '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/workspaces': { success: true, workspaces: [] }, '/api/library/assets': { success: true, items: [] } }[u.pathname];
    return body ? json(body) : json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1600);
  return { p, errs };
}
const sheet = (p) => p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].filter((x) => x.querySelector('.xd-info')).at(-1); if (!sh) return null;
  return { sub: sh.querySelector('.xd-head small')?.textContent || '', state: sh.querySelector('[data-sc-state]')?.dataset.scState || null, text: sh.querySelector('.xd-info').textContent,
    rows: [...sh.querySelectorAll('[data-sc]')].map((li) => ({ id: li.dataset.sc, title: li.querySelector('b').textContent, line: li.querySelector('small').textContent, fail: li.querySelector('.xd-sc-fail')?.textContent || '', off: li.classList.contains('off'), tog: li.querySelector('[data-sc-tog]').textContent, html: li.querySelector('b').innerHTML })) }; });
const openSheet = async (p) => { await p.evaluate(() => window.XA.scheduled()); await wait(500); };
const closeAll = async (p) => { for (let i = 0; i < 4; i++) { const more = await p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); if (!sh) return false; sh.querySelector('[data-xd-close]')?.click(); return true; }); if (!more) break; await wait(350); } };
const calls = (m, part) => db.calls.filter((c) => c[0] === m && c[1].includes(part));

try {
  // ── Scheduled, inside an area
  reset();
  { const { p, errs } = await open('#/dev/p/chat');
    const mock = await p.evaluate(() => document.body.innerHTML.includes('Weekly competitor digest'));
    await openSheet(p); let s = await sheet(p);
    ok(s && calls('GET', '/api/chat/scheduled').at(-1)[1].includes('area=dev') && s.rows.map((r) => r.id).join() === 't-dev', `inside Dev, Scheduled asks for Dev’s and lists only them (${s && s.rows.map((r) => r.id).join()})`);
    ok(!mock && !/Weekly competitor digest|Morning brief/.test(s.text), 'the picture’s sample tasks are not shown');
    ok(/Dev/.test(s.sub) && /Last run failed: The model was not available/.test(s.rows[0].fail) && /Every day · 09:00 · next /.test(s.rows[0].line), `a row says when it runs next and why its last run failed (${s.rows[0].line})`);
    ok(!s.rows.some((r) => r.id === 't-gone'), 'a deleted scheduled chat is not listed');

    // new
    await p.evaluate(() => document.querySelector('.xd [data-xd-act]').click()); await wait(400);
    await p.evaluate(() => { const set = (id, v) => { const i = document.querySelector('#xdf-' + id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('name', 'Friday wrap-up'); set('prompt', 'Sum up the week'); set('at', '07:45'); });
    await p.evaluate(() => [...document.querySelectorAll('.xd [data-xd-submit]')].at(-1).click()); await wait(900);
    const made = calls('POST', '/api/chat/scheduled').at(-1);
    ok(made && made[2].title === 'Friday wrap-up' && made[2].prompt === 'Sum up the week' && made[2].area === 'dev', `a new scheduled chat is made in the area it was set up in (${made && JSON.stringify(made[2]).slice(0, 90)})`);
    ok(made && made[2].rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' && made[2].schedule_kind === 'recurring' && made[2].cadence === 'weekly' && made[2].dtstart_local.endsWith('T07:45:00') && made[2].dtstart_local.length === 19 && !!made[2].timezone && made[2].cadence_label === 'Weekdays · 07:45', `it says when in the platform’s terms: rule, local start, time zone, label (${made && made[2].dtstart_local})`);
    ok(made && made[2].model_id === 'dev-model', 'it uses the model this area uses');
    s = await sheet(p);
    ok(s.rows.map((r) => r.id).join() === 't-dev,t-new', 'the list shows it at once');

    // pause, move, delete
    db.calls.length = 0;
    await p.evaluate(() => document.querySelector('[data-sc-tog="t-dev"]').click()); await wait(600); s = await sheet(p);
    ok(calls('PUT', '/t-dev')[0]?.[2].status === 'paused' && s.rows[0].tog === 'Resume' && s.rows[0].off && / · paused/.test(s.rows[0].line), 'Pause pauses it on the platform and the row says so');
    await p.evaluate(() => document.querySelector('[data-sc-move="t-dev"]').click()); await wait(300);
    const shown = await p.evaluate(() => document.body.textContent.includes('No area'));
    const menu = await p.evaluate(() => window.XENO_AREA_LIVE.moveItems('t-dev').flat().map((i) => i.label + (i.checked ? '*' : '')));
    ok(shown && menu.includes('Dev*') && menu.includes('Studio') && menu.at(-1) === 'No area', `Move opens a menu of every area, the current one ticked, and “No area” (${menu.join(', ')})`);
    await p.evaluate(() => [...document.querySelectorAll('.xcm .xcm-i')].find((x) => x.textContent.trim().startsWith('Studio')).click()); await wait(900); s = await sheet(p);
    ok(calls('PUT', '/t-dev').at(-1)?.[2].area === 'studio' && !s.rows.some((r) => r.id === 't-dev'), 'moving it to Studio takes it out of Dev’s list');
    await p.evaluate(() => document.querySelector('[data-sc-del="t-new"]').click()); await wait(350);
    const asked = await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).textContent);
    ok(/Delete “Friday wrap-up”\?/.test(asked) && calls('DELETE', '/t-new').length === 0, 'Delete asks first');
    await p.evaluate(() => [...document.querySelectorAll('.xd [data-xd-ok]')].at(-1).click()); await wait(800); s = await sheet(p);
    ok(calls('DELETE', '/t-new').length === 1 && s.state === 'empty' && /Nothing scheduled in Dev/.test(s.text), `after deleting, Dev says it has nothing scheduled (${s.state})`);

    // a refusal changes nothing; a failed load says so
    db.tasks.find((t) => t.id === 't-studio').area = 'dev'; db.refuse = true; await closeAll(p); await openSheet(p);
    await p.evaluate(() => document.querySelector('[data-sc-tog="t-studio"]').click()); await wait(600); s = await sheet(p);
    const said = await p.evaluate(() => document.body.textContent.includes('That couldn’t be changed. It is as it was.'));
    ok(said && s.rows.find((r) => r.id === 't-studio').tog === 'Resume', 'when the platform refuses, the row stays as it was and the person is told');
    db.refuse = false; db.down = true; await closeAll(p); await openSheet(p); s = await sheet(p);
    ok(s.state === 'error' && s.rows.length === 0, 'when the list cannot be loaded it says so, and shows no stand-in tasks');
    db.down = false; await p.evaluate(() => document.querySelector('[data-sc-retry]').click()); await wait(600); s = await sheet(p);
    ok(s.state === null && s.rows.length >= 1, 'Try again loads it');
    ok(errs.length === 0, `no page errors inside an area (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // ── Scheduled on Overview, and the rule for "when"
  reset();
  { const { p, errs } = await open('#/overview/p/chat'); db.calls.length = 0;
    await openSheet(p); const s = await sheet(p);
    ok(!calls('GET', '/api/chat/scheduled').at(-1)[1].includes('area=') && s.rows.map((r) => r.id).join() === 't-dev,t-studio,t-none', 'on Overview, Scheduled lists every area’s');
    ok(/ · Dev$/.test(s.rows[0].line) && / · Studio$/.test(s.rows[1].line) && / · Overview$/.test(s.rows[2].line), `on Overview each row names its area (${s.rows.map((r) => r.line.split(' · ').at(-1)).join(', ')})`);
    ok(s.rows[2].html === 'Loose &lt;b&gt;one&lt;/b&gt;', 'a title is shown as text, never as markup');
    const rule = await p.evaluate(() => { const f = window.XENO_AREA_LIVE.scheduleOf, now = new Date(2026, 9, 14, 15, 0, 0);   // a Wednesday, 15:00
      return { past: f('Once', '09:00', now), later: f('Once', '18:00', now), weekly: f('Weekly', '09:00', now), daily: f('Daily', '09:00', now) }; });
    ok(rule.past.dtstart_local === '2026-10-15T09:00:00' && rule.later.dtstart_local === '2026-10-14T18:00:00' && rule.past.schedule_kind === 'once' && !('rrule' in rule.past), 'Once at a time already gone today means tomorrow; later today means today');
    ok(rule.weekly.rrule === 'FREQ=WEEKLY;BYDAY=WE' && rule.weekly.cadence_label === 'Wednesdays · 09:00' && rule.daily.rrule === 'FREQ=DAILY', 'Weekly repeats on the day it was set up; Daily every day');
    ok(errs.length === 0, `no page errors on Overview (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // ── Needs you and the Inbox
  reset();
  { const { p, errs } = await open('#/overview');
    const panel = () => p.evaluate(() => ({ needs: [...document.querySelectorAll('#panel [data-need-schedule]')].map((r) => r.textContent.trim()), text: document.querySelector('#panel').textContent }));
    let v = await panel();
    ok(v.needs.length === 1 && /Dev digest/.test(v.needs[0]) && /Run failed/.test(v.needs[0]), `Overview’s “Needs you” is what really waits: the scheduled chat whose run failed (${v.needs.join(' | ')})`);
    await p.evaluate(() => document.querySelector('#panel [data-need-schedule]').click()); await wait(600);
    ok(!!(await sheet(p)), 'opening it shows Scheduled');
    await closeAll(p);
    await p.evaluate(() => window.XW.go('global', { global: 'inbox' })); await wait(1200);
    const inbox = await p.evaluate(() => document.querySelector('#main').textContent);
    ok(/Dev digest/.test(inbox) && !/Atlas finished a research brief|Invoice paid|Nightly asset sync/.test(inbox), 'the Inbox holds what waits on the person and none of the picture’s sample activity');
    await p.evaluate(() => window.__xw.push()); await wait(400);
    const after = await p.evaluate(() => document.querySelector('#main').textContent);
    ok(!/Launch trailer v3/.test(after), 'no sample notification arrives by itself');
    await p.evaluate(() => { location.hash = '#/studio'; }); await wait(900); v = await panel();
    ok(v.needs.length === 0, 'an area with nothing waiting shows no “Needs you”');
    await p.evaluate(() => { location.hash = '#/dev'; }); await wait(900); v = await panel();
    ok(v.needs.length === 1, 'the area the failed scheduled chat lives in shows it');
    ok(errs.length === 0, `no page errors around Needs you (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // ── Search (Ctrl K)
  reset();
  { const { p, errs } = await open('#/dev'); db.calls.length = 0; db.slow = 500;
    await p.evaluate(() => window.XW.search('')); await wait(300);
    const pal = () => p.evaluate(() => ({ groups: [...document.querySelectorAll('#palette .grp')].map((g) => g.textContent), rows: [...document.querySelectorAll('#palette [data-pi]')].map((r) => ({ t: r.querySelector('.t').textContent, sub: r.querySelector('.meta').textContent, html: r.querySelector('.t').innerHTML })), pending: !!document.querySelector('#palette [data-pal-pending]'), none: /No results/.test(document.querySelector('#palette .res').textContent) }));
    const type = async (text) => { await p.evaluate((t) => { const i = document.querySelector('#palette input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text); };
    await type('z'); await wait(500);
    ok(calls('GET', '/api/workspace/search').length === 0, 'one letter does not ask the platform');
    await type('zebra'); await wait(120); let v = await pal();
    ok(v.pending && !v.none, 'while the platform is asked the palette says it is searching, not “No results”');
    await wait(1100); v = await pal();
    const asks = calls('GET', '/api/workspace/search');
    ok(asks.length === 1 && asks[0][1].includes('q=zebra'), `typing asks the platform once, after a pause (${asks.length})`);
    const said = v.rows.find((r) => r.t.startsWith('Lunch'));
    ok(!v.pending && v.groups.includes('In conversations') && said && /Studio · …repaint the zebra crossing/.test(said.sub), `a chat is found by what was said in it, with the words around the match and its area (${said && said.sub})`);
    ok(said.html === 'Lunch &lt;i&gt;notes&lt;/i&gt;', 'a found title is shown as text, never as markup');
    ok(v.rows.filter((r) => r.t === 'Zebra plan').length === 1, 'a chat this page already lists is not listed twice');
    ok(v.rows.some((r) => r.t === 'Zebra budget' && /Dev/.test(r.sub)) && v.rows.some((r) => r.t === 'Zebra habitat' && /Project · Office/.test(r.sub)), 'work this page had not loaded is found too, each result naming its area');
    await type('zebr'); await wait(60); await type('zebra'); await wait(200); v = await pal();
    ok(!v.pending && calls('GET', '/api/workspace/search').length <= 2 && v.rows.some((r) => r.t.startsWith('Lunch')), 'a search already answered is shown at once the second time');
    await p.evaluate(() => { const r = [...document.querySelectorAll('#palette [data-pi]')].find((x) => x.querySelector('.t').textContent.startsWith('Lunch')); r.click(); }); await wait(900);
    ok((await p.evaluate(() => location.hash)).includes('00000002-0000-4000-8000-000000000000'), 'opening a found chat opens that conversation');
    ok(errs.length === 0, `no page errors in search (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }
  // ── Usage: the person's real credits
  reset();
  { const { p, errs } = await open('#/overview'); await wait(900);
    const btn = () => p.evaluate(() => document.querySelector('#rail [data-go="usage"]')?.textContent.trim());
    const pop = () => p.evaluate(() => { const m = document.querySelector('.usm'); return m ? { text: m.textContent.replace(/\s+/g, ' '), tabs: [...m.querySelectorAll('[data-us-group]')].map((x) => x.textContent.trim()), none: m.querySelector('[data-us-none]')?.dataset.usNone || null, shapes: !!m.querySelector('.ph-shape') } : null; });
    await p.evaluate(() => document.querySelector('#rail [data-go="usage"]').click()); await wait(1400);
    let v = await pop();
    ok(v && /321\s*credits available/.test(v.text) && !/2,480|Launch trailer|held by/.test(v.text) && !v.shapes, `Usage shows the person’s own balance and none of the picture’s sample (${v && v.text.slice(0, 60)})`);
    ok(/321/.test(await btn()), `the Usage button shows it too (${await btn()})`);
    ok(/42/.test(v.text) && !/free_thing/i.test(v.text), 'spending by product is what the platform recorded for the last 30 days');
    ok(v.tabs.join('|') === 'By product|By model', `no “Recent” list is offered when the platform has none (${v.tabs.join('|')})`);
    await p.evaluate(() => document.querySelector('.usm [data-us-group="model"]').click()); await wait(300); v = await pop();
    ok(/model-x/.test(v.text) && /model-y/.test(v.text), 'By model lists the real models');
    await p.evaluate(() => document.querySelector('.usm [data-us-range="7d"]').click()); await wait(300);
    await p.evaluate(() => document.querySelector('.usm [data-us-group="surface"]').click()); await wait(300); v = await pop();
    ok(/17/.test(v.text) && !/11.3/.test(v.text), '7 days is read from the platform, not scaled from one month');
    await p.evaluate(() => document.querySelector('.usm [data-us-range="24h"]').click()); await wait(300); v = await pop();
    ok(v.none === 'empty' && !/NaN/.test(v.text), 'a period with nothing spent says so');
    await p.evaluate(() => window.__xw.push('charge')); await wait(300); v = await pop();
    ok(/321/.test(await btn()), 'no sample charge is taken from the balance by itself');
    db.billDown = true; await p.evaluate(() => document.querySelector('.usm [data-retry="usage"]').click()); await wait(1400); v = await pop();
    ok(v && !/2,480/.test(v.text) && /Try again|couldn’t|could not|Retry/i.test(v.text), `when the balance cannot be read the popover says so and shows no number (${v && v.text.slice(0, 80)})`);
    ok(errs.length === 0, `no page errors in Usage (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }
} catch (e) { fails++; console.log('FAIL the suite threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} check(s) failed` : 'ALL PASS'); process.exit(fails ? 1 : 0);

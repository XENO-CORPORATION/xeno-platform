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
  convs: [{ id: CV, title: 'Zebra plan', updated_at: iso(2), last_message_at: iso(2), project_id: null, area: 'dev' }, { id: 'c-old1', title: 'Old trip notes', updated_at: iso(300), last_message_at: iso(300), project_id: null, area: null }, { id: 'c-old2', title: 'Old <b>recipe</b>', updated_at: iso(400), last_message_at: iso(400), project_id: null, area: null }, { id: 'c-inproj', title: 'Inside a project', updated_at: iso(500), last_message_at: iso(500), project_id: 'p-old', area: null }],
  projects: [{ id: 'p-old', name: 'Old project', updated_at: iso(600), area: null }],
  pins: [], extraLoose: 0,
  files: [{ id: 'f-1', name: 'Diagram.png', source: 'library_file', source_id: 's-1', updated_at: iso(3), area: null }, { id: 'f-2', name: 'Dev <i>notes</i>.md', source: 'library_file', source_id: 's-2', updated_at: iso(4), area: 'dev' }], failMove: null });
const CHAT = `<!doctype html><html><body><div class="chat-themed"><div data-chat-composer-shell></div></div><script>const say = () => parent.postMessage({ source: 'xeno-chat', type: 'location', path: location.pathname, title: 'Chat' }, location.origin); addEventListener('popstate', say); say();</script></body></html>`;
async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: CHAT });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/chat/scheduled') || u.pathname.startsWith('/api/workspace/') || (u.pathname === '/api/chat/conversations' && q.method() === 'GET')) db.calls.push([q.method(), u.pathname + u.search, sent, q.headers()['x-xeno-area'] || null]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/chat/scheduled' && q.method() === 'GET') { if (db.down) return json({ success: false, error: 'Internal server error' }, 500); const want = u.searchParams.get('area'); return json({ success: true, tasks: db.tasks.filter((t) => want === null || (want === 'none' ? !t.area : t.area === want)) }); }
    if (u.pathname === '/api/chat/scheduled' && q.method() === 'POST') { if (db.refuse) return json({ success: false, error: 'Schedule has no future occurrence' }, 400); const t = { id: 't-new', status: 'active', next_run_at: soon(20), project_id: null, last_run_status: null, last_run_error: null, ...sent }; db.tasks.push(t); return json({ success: true, task: t }); }
    const one = u.pathname.match(/^\/api\/chat\/scheduled\/([^/]+)$/);
    if (one) { const t = db.tasks.find((x) => x.id === one[1]); if (!t) return json({ success: false, error: 'Task not found' }, 404); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500);
      if (q.method() === 'PUT') { Object.assign(t, sent); return json({ success: true, task: t }); }
      if (q.method() === 'DELETE') { t.status = 'cancelled'; return json({ success: true }); } }
    if (u.pathname === '/api/workspace/pins') return json({ success: true, items: db.pins.map((id) => db.convs.find((c) => c.id === id)).filter(Boolean).map((c) => ({ kind: 'chat', id: c.id, title: c.title, area: c.area || null, at: c.updated_at })) });
    { const pm = u.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/pin$/); if (pm) { db.calls.push(['PIN', q.method() + ' ' + pm[1], null, null]); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500); db.pins = db.pins.filter((x) => x !== pm[1]); if (q.method() === 'PUT') db.pins.push(pm[1]); return json({ success: true, pinned: q.method() === 'PUT' }); } }
    if (u.pathname === '/api/workspace/summary') return db.sumDown ? json({ success: false, error: 'Internal server error' }, 500) : json({ success: true, days: 7, areas: { dev: { chats: [0, 1, 0, 2, 0, 1, 3], messages: [0, 4, 0, 9, 0, 2, 11], runs: [0, 0, 0, 0, 0, 0, 0] }, studio: { chats: [0, 0, 0, 0, 0, 0, 0], messages: [0, 0, 0, 0, 0, 0, 0], runs: [0, 0, 0, 0, 0, 0, 0] } } });
    if (u.pathname === '/api/tasks') return json({ success: true, tasks: [] });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname === '/api/tasks/views') return json({ success: true, views: [] });
    if (u.pathname === '/api/workspace/needs') return json({ success: true, items: db.tasks.filter((t) => t.status !== 'cancelled' && t.last_run_status === 'failed').map((t) => ({ kind: 'schedule_failed', id: t.id, title: t.title, detail: t.last_run_error, area: t.area, conversation_id: null, at: iso(1) })) });
    if (u.pathname === '/api/workspace/search') { if (db.slow) await wait(db.slow); const qq = (u.searchParams.get('q') || '').toLowerCase(); if (qq === 'plan') return json({ success: true, query: qq, results: [{ kind: 'chat', id: CV, title: 'Zebra plan', snippet: '…the plan for the zebra…', matched: 'message', area: 'dev', at: iso(2) }], counts: {} }); if (qq !== 'zebra') return json({ success: true, query: qq, results: [], counts: {} });
      return json({ success: true, query: qq, results: [
        { kind: 'chat', id: CM, title: 'Lunch <i>notes</i>', snippet: '…repaint the zebra crossing before launch…', matched: 'message', area: 'studio', at: iso(3) },
        { kind: 'chat', id: CV, title: 'Zebra plan', snippet: '', matched: 'title', area: 'dev', at: iso(2) },
        { kind: 'chat', id: '00000009-0000-4000-8000-000000000000', title: 'Zebra budget', snippet: '', matched: 'title', area: 'dev', at: iso(9) },
        { kind: 'project', id: 'p-9', title: 'Zebra habitat', snippet: '', matched: 'name', area: 'office', at: iso(4) }].filter((r) => !u.searchParams.get('area') || r.area === u.searchParams.get('area')), counts: {} }); }
    if (u.pathname === '/api/chat/conversations') { const want = u.searchParams.get('area'); const rows = want === null ? db.convs : db.convs.filter((c) => (want === 'none' ? !c.area : c.area === want)); return json({ success: true, conversations: rows, total: rows.length + (want === 'none' ? db.extraLoose : 0) }); }
    if (u.pathname === '/api/user-data/settings') return json({ success: true, settings: db.settings });
    if (u.pathname === '/api/billing/overview') return db.billDown ? json({ success: false, error: 'Internal server error' }, 500) : json({ success: true, overview: { credits: { balance: db.balance }, subscription: null } });
    if (u.pathname === '/api/v2/ledger/usage') { const days = Math.round((Date.now() - Date.parse(u.searchParams.get('from'))) / 86400000), model = u.searchParams.get('groupBy') === 'model';
      if (days <= 1) return json({ from: '', to: '', groupBy: '', rows: [] });
      return json({ from: '', to: '', groupBy: '', rows: model ? [{ key: 'model-x', events: 4, costMicro: 30e6 }, { key: 'model-y', events: 1, costMicro: 12e6 }, ...(db.many ? Array.from({ length: 20 }, (_, n) => ({ key: 'tiny-' + n, events: 1, costMicro: 1e6 })) : [])] : [{ key: 'xeno_chat', events: 5, costMicro: days > 7 ? 42e6 : 17e6 }, { key: 'free_thing', events: 3, costMicro: 0 }] }); }
    if (u.pathname === '/api/chat/projects') { const want = u.searchParams.get('area'); return json({ success: true, projects: db.projects.filter((x) => want === null || (want === 'none' ? !x.area : x.area === want)) }); }
    if (u.pathname === '/api/library/assets') { const want = u.searchParams.get('area'); return json({ success: true, items: db.files.filter((x) => want === null || (want === 'none' ? !x.area : x.area === want)) }); }
    { const mv = u.pathname.match(/^\/api\/(chat\/conversations|chat\/projects)\/([^/]+)$/) || u.pathname.match(/^\/api\/(library\/assets)\/[^/]+\/([^/]+)\/area$/);
      if (mv && q.method() === 'PUT') { db.calls.push(['MOVE', mv[1] + '/' + mv[2], sent, null]); if (db.failMove === mv[2]) return json({ success: false, error: 'Internal server error' }, 500);
        const list = mv[1] === 'chat/conversations' ? db.convs : mv[1] === 'chat/projects' ? db.projects : db.files; const it = list.find((x) => x.id === mv[2] || x.source_id === mv[2]); if (!it) return json({ success: false, error: 'Not found' }, 404); it.area = sent.area; return json({ success: true }); } }
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
    ok(made && !('model_id' in made[2]), 'it names no model: the platform picks the area’s, the person’s default, or its own');
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
  // ── the Chats sheet, files in Recent, and sorting what is in no area
  reset();
  { const { p, errs } = await open('#/dev/p/chat'); db.calls.length = 0;
    await p.evaluate(() => window.XA.allChats()); await wait(800);
    const chats = () => p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); return { sub: sh.querySelector('.xd-head small')?.textContent || '', n: sh.querySelector('.xd-chats-n').textContent, rows: [...sh.querySelectorAll('[data-ac-id]')].map((r) => r.dataset.acId + ':' + r.querySelector('span').textContent + '|' + r.querySelector('small').textContent), head: sh.querySelector('.xd-chats-h')?.textContent || '', state: sh.querySelector('[data-ac-state]')?.dataset.acState || null }; });
    let c = await chats();
    ok(/In Dev/.test(c.sub) && calls('GET', '/api/chat/conversations').some((x) => x[1].includes('area=dev')) && c.rows.length === 1 && c.rows[0].startsWith(CV + ':Zebra plan'), `inside Dev the Chats sheet lists Dev’s chats (${c.rows.join(', ')})`);
    await p.evaluate(() => { const i = [...document.querySelectorAll('.xd')].at(-1).querySelector('input'); i.value = 'zebra'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(900); c = await chats();
    const asked = calls('GET', '/api/workspace/search').at(-1);
    ok(asked && asked[1].includes('q=zebra') && asked[1].includes('area=dev'), 'typing asks the platform what was said, in this area only');
    await p.evaluate(() => { const i = [...document.querySelectorAll('.xd')].at(-1).querySelector('input'); i.value = 'plan'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(900); c = await chats();
    ok(c.rows.length === 1 && c.head === '', `a chat found both by its title and by what was said is listed once (${c.rows.length})`);
    await closeAll(p);
    await p.evaluate(() => { location.hash = '#/overview/p/chat'; }); await wait(900); await p.evaluate(() => window.XA.allChats()); await wait(700);
    await p.evaluate(() => { const i = [...document.querySelectorAll('.xd')].at(-1).querySelector('input'); i.value = 'zebra'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(900); c = await chats();
    ok(c.head === 'Said in a chat' && c.rows.some((r) => r.startsWith(CM + ':Lunch <i>notes</i>|') && r.includes('zebra crossing')) && c.rows.filter((r) => r.startsWith(CV + ':')).length === 1, `a chat is found by what was said in it, shown as text, and one found by title is not listed twice (${c.rows.length} rows)`);
    await p.evaluate((id) => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-ac-id="' + id + '"]').click(), CM); await wait(800);
    ok((await p.evaluate(() => location.hash)).includes(CM), 'opening one opens that conversation');
    ok(errs.length === 0, `no page errors in the Chats sheet (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  reset();
  { const { p, errs } = await open('#/overview'); await wait(600);
    const rec = await p.evaluate(() => [...document.querySelectorAll('#panel [data-recent-file]')].map((r) => r.dataset.recentFile + ':' + r.querySelector('.t').textContent));
    ok(rec.includes('f-1:Diagram.png'), `Recent lists the person’s recent files too (${rec.join(', ')})`);
    await p.evaluate(() => document.querySelector('#panel [data-recent-file="f-1"]').click()); await wait(700);
    ok(/library/.test(await p.evaluate(() => location.hash)), 'a recent file opens in the Library');
    await p.evaluate(() => { location.hash = '#/overview'; }); await wait(800);
    const entry = await p.evaluate(() => document.querySelector('#panel [data-sort-entry]')?.textContent.trim() || '');
    ok(/Sort into areas/.test(entry) && /4$/.test(entry), `Overview offers “Sort into areas” with how many items are in none (${entry})`);
    db.calls.length = 0;
    await p.evaluate(() => document.querySelector('#panel [data-sort-entry]').click()); await wait(900);
    const sort = () => p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); return { state: sh.querySelector('[data-sort-state]')?.dataset.sortState || null, rows: [...sh.querySelectorAll('[data-sort-pick]')].map((x) => x.dataset.sortPick + (x.checked ? '*' : '')), to: [...sh.querySelectorAll('[data-sort-to]')].map((x) => x.textContent + (x.disabled ? '-' : '')), html: sh.querySelector('.xd-sort b')?.innerHTML || '', text: sh.textContent }; });
    let s = await sort();
    ok(s.rows.join() === 'chat:c-old1,chat:c-old2,project:p-old,file:f-1', `the sheet lists what is in no area: loose chats, projects and files; a chat inside a project is moved with its project (${s.rows.join()})`);
    ok(s.to.length >= 6 && s.to.every((x) => x.endsWith('-')), 'no area can be chosen until something is selected');
    ok(/Old &lt;b&gt;recipe/.test(await p.evaluate(() => [...document.querySelectorAll('.xd-sort b')].map((b) => b.innerHTML).join('|'))), 'a title is shown as text');
    await p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); for (const k of ['chat:c-old1', 'project:p-old', 'file:f-1']) sh.querySelector('[data-sort-pick="' + k + '"]').click(); }); await wait(300); s = await sort();
    ok(s.rows.filter((r) => r.endsWith('*')).length === 3 && /Move 3 to/.test(s.text) && s.to.some((x) => x === 'Dev'), 'selecting items enables the areas and says how many will move');
    db.failMove = 's-1';
    await p.evaluate(() => [...[...document.querySelectorAll('.xd')].at(-1).querySelectorAll('[data-sort-to]')].find((x) => x.textContent === 'Dev').click()); await wait(1300); s = await sort();
    const moves = calls('MOVE', '/').map((x) => x[1] + '>' + x[2].area).sort().join();
    ok(moves === 'chat/conversations/c-old1>dev,chat/projects/p-old>dev,library/assets/s-1>dev', `each selected item is moved on the platform (${moves})`);
    ok(s.rows.join() === 'chat:c-old2,file:f-1*' && (await p.evaluate(() => document.body.textContent.includes('Moved 2 to Dev. 1 couldn’t be moved and stay where they were.'))), `what moved leaves the list; what the platform refused stays, selected, and the person is told (${s.rows.join()})`);
    db.failMove = null;
    await p.evaluate(() => { const sh = [...document.querySelectorAll('.xd')].at(-1); sh.querySelector('[data-sort-all="chat"]').click(); }); await wait(200);
    await p.evaluate(() => [...[...document.querySelectorAll('.xd')].at(-1).querySelectorAll('[data-sort-to]')].find((x) => x.textContent === 'Studio').click()); await wait(1300); s = await sort();
    ok(s.state === 'done', `when nothing is left the sheet says everything is in an area (${s.state})`);
    await closeAll(p); await wait(500);
    ok(!(await p.evaluate(() => !!document.querySelector('#panel [data-sort-entry]'))), 'and Overview stops offering it');
    ok(errs.length === 0, `no page errors in sorting (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // ── pins
  reset(); db.pins = ['c-old1'];
  { const { p, errs } = await open('#/overview/p/chat'); await wait(500); db.calls.length = 0;
    const side = () => p.evaluate(() => { const secs = {}; let cur = null; for (const el of document.querySelectorAll('#panel .sec, #panel [data-chat-live]')) { if (el.classList.contains('sec')) { cur = el.textContent.trim().split('\n')[0].trim(); continue; } } const sec = (name) => { const h = [...document.querySelectorAll('#panel [data-sec]')].find((x) => x.dataset.sec === name); return h ? [...h.querySelectorAll('[data-chat-live]')].map((r) => r.dataset.chatLive) : null; }; return { pinned: sec('pinned'), recents: sec('recents'), pins: window.XENO_CHAT.pins() }; });
    let v = await side();
    ok(v.pinned && v.pinned.join() === 'c-old1' && v.recents && !v.recents.includes('c-old1') && v.recents.includes('c-old2'), `a pinned chat sits under Pinned and leaves the day groups (${JSON.stringify(v)})`);
    await p.evaluate(() => window.XENO_CHAT.pin('c-old2', true)); await wait(700); v = await side();
    ok(calls('PIN', 'PUT c-old2').length === 1 && v.pinned.join() === 'c-old1,c-old2', 'pinning a chat tells the platform and adds it to Pinned, after the ones already there');
    await p.evaluate(() => window.XENO_CHAT.pin('c-old1', false)); await wait(700); v = await side();
    ok(calls('PIN', 'DELETE c-old1').length === 1 && v.pinned.join() === 'c-old2' && v.recents.includes('c-old1'), 'unpinning returns it to its day');
    db.refuse = true; await p.evaluate(() => window.XENO_CHAT.pin('c-old1', true)); await wait(700); v = await side(); db.refuse = false;
    ok(v.pinned.join() === 'c-old2' && (await p.evaluate(() => document.body.textContent.includes('That couldn’t be pinned.'))), 'when the platform refuses, the pin is taken back and the person is told');
    await p.evaluate(() => { location.hash = '#/overview'; }); await wait(1200);
    const ov = await p.evaluate(() => { const h = [...document.querySelectorAll('#panel [data-sec]')].find((x) => x.dataset.sec === 'pinned'); return h ? [...h.querySelectorAll('[data-recent-chat]')].map((r) => r.dataset.recentChat + ':' + r.querySelector('.t').innerHTML) : null; });
    ok(ov && ov.join() === 'c-old2:Old &lt;b&gt;recipe&lt;/b&gt;', `Overview’s Pinned is what the person pinned, shown as text (${ov && ov.join()})`);
    await p.evaluate(() => document.querySelector('#panel [data-sec="pinned"] [data-recent-chat]').click()); await wait(800);
    ok((await p.evaluate(() => location.hash)).includes('c-old2'), 'a pinned chat opens that conversation');
    ok(errs.length === 0, `no page errors in pins (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }
  reset(); db.extraLoose = 57;
  { const { p } = await open('#/overview'); await wait(600);
    await p.evaluate(() => window.XA.sortAreas()); await wait(900);
    const more = await p.evaluate(() => [...document.querySelectorAll('.xd')].at(-1).querySelector('[data-sort-more="chats"]')?.textContent || '');
    ok(/^57 more chats are in no area/.test(more), `a list longer than one request says how many more there are (${more.slice(0, 40)})`); await p.close(); }

  // ── each area's home
  reset();
  { const { p, errs } = await open('#/dev'); await wait(900);
    const home = () => p.evaluate(() => { const m = document.querySelector('#main'); return { text: m.textContent.replace(/\s+/g, ' '), kpis: [...m.querySelectorAll('.kpi')].map((k) => k.querySelector('small').textContent + '=' + k.querySelector('.kpi-v').textContent), work: [...m.querySelectorAll('[data-home-work]')].map((r) => r.dataset.homeWork + ':' + r.querySelector('b').innerHTML), empty: !!m.querySelector('[data-home-work-empty]'), head: m.querySelector('[data-home-work-sec] h2')?.textContent || '' }; });
    let h = await home();
    ok(h.kpis.join() === 'Chats started=7,Messages sent=26', `Dev’s “This week” is the person’s own week: chats started and messages sent; a count of nothing is not shown (${h.kpis.join()})`);
    ok(!/128|Renders this week|Agent runs|Launch trailer|Refactor auth gate|Atlas|€/.test(h.text), 'none of the picture’s sample numbers, jobs or agent runs are on the page');
    ok(h.head === 'Your work in Dev' && h.work.join() === 'chat:Zebra plan,file:Dev &lt;i&gt;notes&lt;/i&gt;.md', `“Your work in Dev” lists what the person touched there, newest first, as text (${h.work.join()})`);
    await p.evaluate(() => document.querySelector('#main [data-home-work="chat"]').click()); await wait(800);
    ok((await p.evaluate(() => location.hash)).includes(CV), 'opening a chat from the home opens that conversation');
    await p.evaluate(() => { location.hash = '#/studio'; }); await wait(1000); h = await home();
    ok(h.kpis.length === 0 && h.empty && /Nothing in Studio yet/.test(h.text) && !/Hero stills|Teaser 15s|rendering/i.test(h.text), `an area with nothing in it says so, shows no numbers and no sample production (${h.kpis.length})`);
    await p.evaluate(() => { location.hash = '#/overview'; }); await wait(1000);
    const ov = await p.evaluate(() => document.querySelector('#main').textContent.replace(/\s+/g, ' '));
    ok(!/Running now|rendering|Launch trailer/i.test(ov) && /Chats started/.test(ov), 'Overview shows no sample running jobs, and each area’s headline number is real');
    ok((await p.evaluate(() => document.getElementById('xp-note')?.textContent || '')).includes('tasks, library, people, community and each area’s home are real'), 'the note says which parts are real and which still show samples');
    ok(errs.length === 0, `no page errors on the homes (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }
  reset(); db.sumDown = true;
  { const { p, errs } = await open('#/dev'); await wait(900);
    const t = await p.evaluate(() => ({ k: document.querySelectorAll('#main .kpi').length, text: document.querySelector('#main').textContent }));
    ok(t.k === 0 && !/128|Renders this week/.test(t.text), 'when the week cannot be loaded no numbers are shown, not sample ones');
    ok(errs.length === 0, `no page errors when the week fails (${JSON.stringify(errs.slice(0, 2))})`); db.sumDown = false; await p.close(); }

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
    db.many = true; await p.evaluate(() => document.querySelector('.usm [data-retry="usage"]').click()); await wait(1400); v = await pop(); db.many = false;
    ok(/model-x/.test(v.text) && /tiny-2/.test(v.text) && !/tiny-3/.test(v.text) && /17 others/.test(v.text), 'a long list is the five that cost most and one line for the rest');
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

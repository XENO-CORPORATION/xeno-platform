// tasks-test — XENO Tasks in the workspace against a stand-in /api/tasks that enforces the same state machine.
// Proves the board (per area, Overview, search, filters, sort, list layout, saved views, drag, multi-select), the New
// task window (fields, images, Ctrl+Enter), the task page (moves, claim, stale-screen refusal, property rows, agent
// assignees, images, markdown with checklists and inline images, inline description editing, comments with edit,
// remove and @mention suggestions, readable history, watch, sub-tasks), undo, keyboard shortcuts, the inbox, that
// every change redraws only the tasks region, that other people's changes appear without a reload, and failure text.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5197, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0, fail = false;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const db = { tasks: [], seq: 0, uploads: 0, views: [], calls: [], notes: [{ id: '00000000-0000-4000-8000-000000000001', source: 'tasks', kind: 'assigned', ref: 'T-1', title: 'T-1 · Fix the signup copy', detail: 'Codrin assigned it to you', area: 'studio', read: false, at: new Date().toISOString(), actor: { name: 'Codrin', kind: 'human' } }] };
const now = () => new Date().toISOString();
const MOVES = { raised: ['todo', 'wont_do'], todo: ['in_progress', 'wont_do'], in_progress: ['blocked', 'in_review', 'done'], blocked: ['in_progress'], in_review: ['done', 'in_progress'], done: ['raised'], wont_do: ['raised'] };
const ME = { id: 'u1', kind: 'human', name: 'Me' };
const PEOPLE = [{ id: 'u1', name: 'Me', username: 'me', kind: 'human', me: true }, { id: 'u2', name: 'Codrin', username: 'codrin', kind: 'human' }, { id: 'a1', name: 'Builder', username: 'builder', kind: 'agent' }];
const view = (t) => ({ attachments: [], children: db.tasks.filter((c) => c.parentKey === t.key).map((c) => ({ key: c.key, title: c.title, status: c.status, priority: c.priority, assignee: c.assignee })), links: [], watchers: t.watching ? [ME] : [], canLink: true, subtasks: { total: db.tasks.filter((c) => c.parentKey === t.key).length, done: 0 }, parent: t.parentKey ? { key: t.parentKey, title: (db.tasks.find((x) => x.key === t.parentKey) || {}).title } : null, ...t, can: { edit: true, attach: true, delete: true, moves: (MOVES[t.status] || []).filter((m) => !(m === 'done' && t.status === 'in_progress' && t.reviewRequired)) } });
const mk = (b) => { const t = { key: 'T-' + ++db.seq, number: db.seq, title: b.title, body: b.body || '', kind: b.kind || 'task', priority: b.priority || 'none', status: 'raised', area: b.area ?? null, project: b.projectId ? { id: b.projectId, name: 'Website' } : null, assignee: b.assigneeId ? PEOPLE.find((p) => p.id === b.assigneeId) : null, reviewer: null, reviewRequired: false, reporter: ME, labels: b.labels || [], dueAt: b.dueAt || null, parentKey: b.parentKey || null, watching: true, createdAt: now(), updatedAt: now(), events: [{ id: 'e' + Math.random(), kind: 'created', actor: ME, at: now() }] }; if (t.parentKey) { const p = db.tasks.find((x) => x.key === t.parentKey); t.area = p.area; } db.tasks.push(t); return t; };
mk({ title: 'Fix the signup copy', area: 'studio', priority: 'high', labels: ['copy'] }); mk({ title: 'Office budget', area: 'office' });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname + u.search, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: db.notes.filter((n) => !n.read).length, items: db.notes });
  if (u.pathname === '/api/notifications/read') { for (const n of db.notes) if (b.all || (b.ids || []).includes(n.id)) n.read = true; return json(200, { success: true, unread: 0, items: [] }); }
  if (u.pathname === '/api/tasks/views') { if (method === 'POST') db.views.push({ id: 'v' + (db.views.length + 1), name: b.name, area: b.area, filters: b.filters }); if (method === 'DELETE') db.views = []; return json(200, { success: true, views: db.views }); }
  if (u.pathname === '/api/tasks' && method === 'GET') { if (fail) return json(500, { success: false }); const a = u.searchParams.get('area'), pid = u.searchParams.get('projectId'); return json(200, { success: true, tasks: db.tasks.filter((t) => (!a || t.area === a) && (!pid || (t.project && t.project.id === pid))).map(view) }); }
  if (u.pathname === '/api/tasks' && method === 'POST') { const t = mk(b); return json(201, { success: true, task: view(t) }); }
  if (u.pathname === '/api/tasks/assignees') return json(200, { success: true, assignees: PEOPLE });
  const am = u.pathname.match(/^\/api\/tasks\/(T-\d+)\/attachments(?:\/([\w-]+))?$/);
  if (am) {
    const t = db.tasks.find((x) => x.key === am[1]); t.attachments = t.attachments || [];
    if (method === 'POST') { const id = '00000000-0000-4000-8000-0000000000' + String(10 + t.attachments.length + db.uploads); t.attachments.push({ id, filename: u.searchParams.get('name'), mime: 'image/png', size: 10, at: now(), uploader: ME }); db.uploads++; t.updatedAt = now(); return json(201, { success: true, task: view(t) }); }
    return q.respond({ status: 200, contentType: 'image/png', body: PNG });
  }
  const m = u.pathname.match(/^\/api\/tasks\/(T-\d+)(\/\w+)?(?:\/([\w.-]+))?$/);
  if (m) {
    if (m[2] === '/restore' && db.deleted && db.deleted.key === m[1]) { db.tasks.push(db.deleted); const back = db.deleted; db.deleted = null; return json(200, { success: true, task: view(back) }); }
    const t = db.tasks.find((x) => x.key === m[1]); if (!t) return json(404, { success: false, error: 'Task not found' });
    const ev = (e) => { t.events.push({ id: 'e' + Math.random(), actor: ME, at: now(), ...e }); t.updatedAt = now(); };
    if (!m[2] && method === 'GET') return json(200, { success: true, task: view(t) });
    if (!m[2] && method === 'PATCH') {
      for (const [k, f] of [['title', 'title'], ['priority', 'priority'], ['kind', 'kind'], ['dueAt', 'due']]) if (b[k] !== undefined) { ev({ kind: 'edited', field: f, from: t[k], to: b[k] }); t[k] = b[k]; }
      if (b.body !== undefined) { t.body = b.body; ev({ kind: 'edited', field: 'description' }); }
      if (b.labels !== undefined) t.labels = b.labels;
      if (b.assigneeId !== undefined) { const to = b.assigneeId ? PEOPLE.find((x) => x.id === b.assigneeId) : null; ev({ kind: 'assigned', from: t.assignee && t.assignee.id, to: b.assigneeId, toName: to && to.name, fromName: t.assignee && t.assignee.name }); t.assignee = to; }
      return json(200, { success: true, task: view(t) });
    }
    if (!m[2] && method === 'DELETE') { db.tasks.splice(db.tasks.indexOf(t), 1); db.deleted = t; return json(200, { success: true, key: t.key, deleted: true }); }
    if (m[2] === '/watch') { t.watching = method === 'PUT'; return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/transition') { if (b.from && b.from !== t.status) return json(409, { success: false, error: 'Someone moved this task first.' }); if (!(MOVES[t.status] || []).includes(b.to)) return json(400, { success: false, error: 'Not allowed' }); ev({ kind: 'status', from: t.status, to: b.to, note: b.note }); t.status = b.to; return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/claim') { if (t.assignee) return json(409, { success: false, error: 'Someone already took it' }); t.assignee = ME; ev({ kind: 'claimed' }); return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/comments' && method === 'POST') { ev({ kind: 'comment', note: b.body }); return json(200, { success: true, task: view(t) }); }
    if (m[2] === '/comments' && m[3]) { const c = t.events.find((x) => x.id === m[3]); if (method === 'PATCH') { c.note = b.body; c.editedAt = now(); } else { c.note = null; c.removed = true; } t.updatedAt = now(); return json(200, { success: true, task: view(t) }); }
  }
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: db.tasks.filter((t) => t.status === 'in_review').map((t) => ({ kind: 'task_review', id: t.key, title: t.key + ' · ' + t.title, detail: 'Waiting for your review', area: t.area, conversation_id: null, at: t.updatedAt })) });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const nav = async (hash) => { await p.evaluate((h) => (location.hash = h), hash); await settle(); };
const countRenders = () => p.evaluate(() => { window.__renders = 0; if (!window.__wrapped) { window.__wrapped = 1; const o = window.XW.render; window.XW.render = function (...a) { window.__renders++; return o.apply(this, a); }; } });
const renders = () => p.evaluate(() => window.__renders);
const menuClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.xcm .xcm-i')].reverse().find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
const pickOpen = () => p.waitForSelector('.tk-pick:not([hidden])', { timeout: 3000 });
const pickClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.tk-pick:not([hidden]) .tk-pick-i')].find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
const pasteImage = (sel) => p.evaluate((s) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'shot.png', { type: 'image/png' })); const el = document.querySelector(s); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); }, sel);
const T3 = () => db.tasks.find((x) => x.key === 'T-3');
try {
  await p.goto(base + '/workspace/#/studio/g/tasks', { waitUntil: 'domcontentloaded' }); await settle(1600);
  await nav('#/studio/g/tasks'); let t = await main();
  ok(/Fix the signup copy/.test(t) && !/Office budget/.test(t) && await p.$('[data-tk-col="raised"] [data-tk-card="T-1"]'), 'an area board shows only that area’s tasks, in Triage');
  await nav('#/overview/g/tasks'); t = await main();
  ok(/Fix the signup copy/.test(t) && /Office budget/.test(t), 'Overview shows every area’s tasks');
  // real addresses: clean paths, deep links, Back, old #/ links upgraded
  { const loc = () => p.evaluate(() => location.pathname + location.search + location.hash);
    ok(await loc() === '/workspace/tasks', `an old #/ address is upgraded to a clean path (${await loc()})`);
    await nav('#/studio/g/tasks'); const a1 = await loc();
    await p.click('[data-tk-card="T-1"]'); await settle(); const a2 = await loc();
    await p.goBack(); await settle(); const a3 = await loc(), board = !!(await p.$('[data-tk-card="T-1"]'));
    ok(a1 === '/workspace/studio/tasks' && a2 === '/workspace/studio/tasks/T-1' && a3 === '/workspace/studio/tasks' && board, `opening a task gives it its own path and Back returns to the board (${[a1, a2, a3]})`);
    await p.goto(base + '/workspace/studio/tasks/T-1', { waitUntil: 'domcontentloaded' }); await settle(1800);
    ok(/Fix the signup copy/.test(await main()) && await loc() === '/workspace/studio/tasks/T-1', 'a deep link opens that task on a fresh load');
    await p.reload({ waitUntil: 'domcontentloaded' }); await settle(1800);
    ok(/Fix the signup copy/.test(await main()) && await loc() === '/workspace/studio/tasks/T-1', 'refreshing keeps you on the same task');
    const miss = await p.evaluate(async () => (await fetch('/workspace/no-such-script.js')).status);
    ok(miss === 404, 'a missing script is still a 404, never the app page'); }
  ok(await p.evaluate(() => (window.XENO_NEEDS || []).some((n) => n.kind === 'task_assigned' && n.ref === 'T-1' && n.g === 'needs')), 'a notification that asks something of you (assigned) reaches the inbox and Needs you');

  const xss = await p.evaluate(() => window.XENO_TASKS.md('<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](https://ok.test/?q="><script>) ![c](attachment:x) <script>alert(2)</script> `<b>` **bold** T-1 @codrin\n- [ ] <i>x</i>', 'T-1'));
  const box = await p.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; return { scripts: d.querySelectorAll('script').length, handlers: [...d.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => /^on/i.test(a.name))), js: [...d.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') || '')), imgs: d.querySelectorAll('img').length, bold: !!d.querySelector('b'), ref: !!d.querySelector('.tk-ref'), mention: !!d.querySelector('.tk-mention') }; }, xss);
  ok(box.scripts === 0 && !box.handlers && !box.js && box.imgs === 0 && box.bold && box.ref && box.mention, 'the markdown renderer never lets through a script, an event handler, a javascript: link or a foreign image, and still formats');

  // ── the New task window
  await nav('#/studio/g/tasks');
  await p.keyboard.press('c'); await p.waitForSelector('.xd [data-tk-new]', { timeout: 4000 });
  { const lay = await p.evaluate(() => { const m = document.querySelector('.xd .tk-nw-main').getBoundingClientRect(), s = document.querySelector('.xd .tk-nw-props').getBoundingClientRect(); return { right: s.left >= m.right - 1, rows: document.querySelectorAll('.xd .tk-nw-props .tk-prop').length, crumb: document.querySelector('.xd .tk-nw-crumb').textContent }; });
    ok(lay.right && lay.rows >= 9 && /Tasks\s*\/\s*New task/.test(lay.crumb) && !!(await p.$('.xd .tk-ed-bar')), 'C opens the New task window as a workspace pane: breadcrumb, editor, and the properties column on the right (' + lay.rows + ' rows)'); }
  { const open = () => p.evaluate(() => !document.querySelector('.tk-pick').hidden), c = '.xd [data-n-chip="kind"]';
    await p.click(c); await settle(250); const s1 = await open(); await p.click(c); await settle(250); const s2 = await open(); await p.click(c); await settle(250); const s3 = await open();
    ok(s1 && !s2 && s3, `a field in the New task window toggles its picker: open, close, open (${[s1, s2, s3]})`); await p.keyboard.press('Escape'); await settle(200); }
  await p.type('.xd [data-n-title]', 'Write the launch post');
  await p.type('.xd textarea', 'Cover what changed.\n- [ ] draft\n- [ ] review\n');
  await pasteImage('.xd textarea'); await settle(300);
  ok(await p.$$eval('.xd .tk-nimg', (els) => els.length) === 1 && /pending:1/.test(await p.$eval('.xd textarea', (e) => e.value)), 'an image pasted while writing shows as a thumbnail and is placed in the description');
  await p.click('.xd [data-n-chip="assignee"]'); await pickOpen(); await settle(200);
  const groups = await p.$$eval('.tk-pick:not([hidden]) .tk-pick-g', (els) => els.map((e) => e.textContent));
  ok(groups.includes('People') && groups.includes('Agents') && !!(await p.$('.tk-pick:not([hidden]) .tk-face')), 'the assignee picker groups people and agents and shows their faces');
  await p.type('.tk-pick .tk-pick-s input', 'cod'); await settle(100);
  ok(await p.$$eval('.tk-pick:not([hidden]) .tk-pick-i', (els) => els.length) === 1, 'typing in a picker narrows it');
  await p.keyboard.press('Enter'); await settle(200);
  await p.click('.xd [data-n-chip="priority"]'); await pickOpen(); await p.keyboard.press('3'); await settle(200);
  ok(/Codrin/.test(await p.$eval('.xd [data-n-chips]', (e) => e.textContent)) && /Medium/.test(await p.$eval('.xd [data-n-chips]', (e) => e.textContent)), 'the chips set the assignee and priority in place');
  await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await settle(1200);
  const created = T3();
  ok(created && created.area === 'studio' && created.assignee?.id === 'u2' && created.priority === 'medium' && db.uploads === 1 && /\(attachment:[0-9a-f-]{36}\)/.test(created.body) && !/pending:/.test(created.body), 'Ctrl+Enter creates the task with its fields, uploads the image and links it into the description');
  ok(!(await p.$('.xd [data-tk-new]')) && /Write the launch post/.test(await main()), 'the window closes and the new task opens');
  ok(!!(await p.$('.tk-md .tk-md-img')) && await p.$$eval('.tk-md-box', (els) => els.length) === 2 && /0 of 2/.test(await main()), 'the description renders: the inline image and a two-item checklist with its progress');
  ok(!!(await p.$('.tk-side [data-tk-prop="assignee"]')) && await p.$$eval('.tk-side .tk-prop', (els) => els.length > 8 && els.every((e) => e.getBoundingClientRect().height < 44)), 'each property is one row, label and value side by side');
  { const lay = await p.evaluate(() => { const m = document.getElementById('main').getBoundingClientRect(), s = document.querySelector('.tk-side').getBoundingClientRect(), c = document.querySelector('.tk-main-in').getBoundingClientRect(); return { flush: Math.abs(m.right - s.right) < 4, full: s.height >= m.height - 120, read: c.width <= 870 }; });
    ok(lay.flush && lay.full && lay.read, 'the details sidebar runs the full height at the right edge, and the work column keeps a readable width'); }
  ok(/Accept/.test(await p.$eval('.tk-next .tk-act--main', (e) => e.textContent)) && /triage/i.test(await p.$eval('.tk-next-h', (e) => e.textContent)), 'the next step says what to do now and offers it as the one main action');

  await countRenders();
  await p.click('.tk-md-box'); await settle();
  ok(/- \[x\] draft/.test(T3().body) && /1 of 2/.test(await main()), 'ticking a checklist item saves it on the task');
  await p.click('[data-tk-move="todo"]'); await settle();
  ok(T3().status === 'todo' && /moved it\s*Triage\s*→\s*To do/.test(await main()), 'Accept moves it and the activity records it');
  ok(/Start/.test(await p.$eval('.tk-next .tk-act--main', (e) => e.textContent)) && !/Accept/.test(await p.$eval('.tk-next', (e) => e.textContent)), 'after accepting, the main action becomes Start — no wrong labels like Accept on a task already accepted');
  await p.click('[data-tk-prop="priority"]'); await pickOpen(); await p.keyboard.press('2'); await settle();
  ok(T3().priority === 'high' && /changed the priority from\s*Medium\s*to\s*High/.test(await main()), 'the history says what changed, from what, to what');
  await p.evaluate(() => window.XENO_HIST.undo()); await settle();
  ok(T3().priority === 'medium', 'undo puts the priority back');
  { const pickShown = () => p.evaluate(() => !document.querySelector('.tk-pick').hidden), menuShown = () => p.evaluate(() => !!document.querySelector('.xcm'));
    await p.click('[data-tk-prop="priority"]'); await settle(250); const a1 = await pickShown();
    await p.click('[data-tk-prop="priority"]'); await settle(250); const a2 = await pickShown();
    await p.click('[data-tk-prop="priority"]'); await settle(250); const a3 = await pickShown();
    await p.keyboard.press('Escape'); await settle(150);
    await p.click('.tk-titlerow [data-tk="menu"]'); await settle(250); const b1 = await menuShown();
    await p.click('.tk-titlerow [data-tk="menu"]'); await settle(350); const b2 = await menuShown();
    ok(a1 && !a2 && a3 && b1 && !b2, `a button toggles its picker or menu: click opens, click again closes, click again opens (${[a1, a2, a3, b1, b2]})`); }
  ok(await renders() === 0, 'none of that redrew the workspace around the task');
  db.tasks[2].status = 'blocked';    // someone else moved it; this screen still shows To do
  await p.click('[data-tk-move="in_progress"]'); await settle();
  ok(T3().status === 'blocked' && /Blocked/.test(await main()), 'a stale screen cannot overwrite a newer state; the task redraws to the truth');

  // inline description editing
  await p.click('[data-tk-desc]'); await p.waitForSelector('[data-tk-dedit] textarea', { timeout: 3000 });
  await p.evaluate(() => { const ta = document.querySelector('[data-tk-dedit] textarea'); ta.setSelectionRange(ta.value.length, ta.value.length); });
  await p.type('[data-tk-dedit] textarea', '\n**Ship it** by Friday');
  await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await settle();
  ok(/\*\*Ship it\*\* by Friday/.test(T3().body) && !!(await p.$eval('.tk-desc', (e) => e.innerHTML.includes('<b>Ship it</b>'))), 'the description edits in place and renders the formatting');

  // comments: @mention suggestions, edit, remove
  await p.click('[data-tk-comment] textarea'); await p.type('[data-tk-comment] textarea', 'thanks @co'); await settle(300);
  ok(!(await p.$eval('.tk-mpop', (e) => e.hidden)) && /Codrin/.test(await p.$eval('.tk-mpop', (e) => e.textContent)), '@ suggests the people on the task');
  await p.keyboard.press('Enter'); await settle(100);
  ok(await p.$eval('[data-tk-comment] textarea', (e) => e.value) === 'thanks @codrin ', 'choosing a suggestion writes the username');
  await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await settle();
  ok(!!(await p.$('.tk-comment .tk-mention')), 'the comment shows the mention');
  const cid = T3().events.filter((e) => e.kind === 'comment').at(-1).id;
  await p.click(`[data-tk="cmenu"][data-arg="T-3|${cid}"]`); await p.waitForSelector('.xcm', { timeout: 3000 }); await menuClick(/^Edit comment/); await p.waitForSelector('[data-tk-cedit] textarea', { timeout: 3000 });
  await p.evaluate(() => { const ta = document.querySelector('[data-tk-cedit] textarea'); ta.value = 'thanks, edited'; });
  await p.keyboard.down('Control'); await p.click('[data-tk-cedit] textarea'); await p.keyboard.press('Enter'); await p.keyboard.up('Control'); await settle();
  ok(T3().events.find((e) => e.id === cid).note === 'thanks, edited' && /edited/.test(await main()), 'the author edits a comment and it shows as edited');
  await p.click(`[data-tk="cmenu"][data-arg="T-3|${cid}"]`); await p.waitForSelector('.xcm', { timeout: 3000 }); await menuClick(/^Remove comment/); await p.waitForSelector('.xd [data-xd-ok]', { timeout: 3000 }); await p.click('.xd [data-xd-ok]'); await settle();
  ok(/removed a comment/.test(await main()), 'a removed comment leaves a marker in the thread');

  await p.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async (s) => { window.__clip = s; }; });
  await p.click('[data-tk="prompt"]'); await settle(400);
  const clip = await p.evaluate(() => window.__clip) || '';
  ok(/^# T-3: Write the launch post/.test(clip) && /## Description[\s\S]*Ship it/.test(clip) && clip.includes('## Done means\n- [ ] review') && clip.includes('(already done: draft)') && clip.includes('/api/tasks/T-3/attachments/') && clip.includes('## When you finish'),'Copy for agent puts a complete handoff brief on the clipboard (task, description with image links, open checklist as done-criteria, how to report)');
  // watch, sub-tasks
  await p.click('[data-tk="watch"]'); await settle();
  ok(T3().watching === false && /Watch\b/.test(await p.$eval('[data-tk="watch"]', (e) => e.textContent)), 'Watch can be turned off');
  await p.type('[data-tk-kidadd] input', 'Pick the hero image'); await p.keyboard.press('Enter'); await settle(900);
  ok(db.tasks.some((x) => x.parentKey === 'T-3' && x.title === 'Pick the hero image') && /Pick the hero image/.test(await main()), 'a sub-task added under the task appears in its list');
  db.tasks[2].title = 'Write the launch post v2'; db.tasks[2].updatedAt = new Date(Date.now() + 5000).toISOString();
  await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(/launch post v2/.test(await main()) && await renders() === 0, 'another person’s change appears on the open task without a reload');

  // ── the board: search, filters, list, views, multi-select
  await nav('#/studio/g/tasks'); await countRenders();
  await p.type('[data-tk-search]', 'hero'); await settle(400);
  ok(!!(await p.$('[data-tk-card="T-4"]')) && !(await p.$('[data-tk-card="T-1"]')), 'search narrows the board as you type');
  await p.evaluate(() => { const s = document.querySelector('[data-tk-search]'); s.focus(); }); await p.keyboard.press('Escape'); await settle(300);
  await p.click('[data-tk="filters"]'); await p.waitForSelector('.xcm', { timeout: 3000 });
  await p.evaluate(() => [...document.querySelectorAll('.xcm .xcm-i')].find((b) => /^Priority/.test(b.textContent.trim()))?.focus());
  await p.keyboard.press('ArrowRight'); await settle(300); await menuClick(/^High/); await settle(300);
  ok(!!(await p.$('[data-tk-card="T-1"]')) && !(await p.$('[data-tk-card="T-3"]')) && /Priority: High/.test(await main()), 'a filter narrows the board and shows as a removable chip');
  await p.click('[data-tk="save-view"]'); await p.waitForSelector('.xd input', { timeout: 3000 }); await p.type('.xd input', 'Hot ones'); await p.keyboard.press('Enter'); await settle();
  ok(db.views.length === 1 && db.views[0].filters.priority?.includes('high') && !!(await p.$('[data-tk-view="v1"]')), 'the current filters save as a named view');
  await p.click('[data-tk="clear-filters"]').catch(() => {}); await p.evaluate(() => { const b = document.querySelector('[data-tk="unfilter"]'); b && b.click(); }); await settle(300);
  await p.click('[data-tk="layout"][data-arg="list"]'); await settle(300);
  ok(!!(await p.$('[data-tk-list] [data-tk-rowkey="T-3"]')) && !!(await p.$('.tk-list-h')), 'the list layout shows the tasks as rows grouped by status');
  await p.click('[data-tk="layout"][data-arg="board"]'); await settle(300);
  await p.keyboard.down('Control'); await p.click('[data-tk-card="T-1"]'); await p.keyboard.up('Control');
  await p.keyboard.down('Control'); await p.click('[data-tk-card="T-4"]'); await p.keyboard.up('Control'); await settle(300);
  ok(/2 selected/.test(await main()), 'Ctrl-click selects several tasks and a bar offers what to do with them');
  await p.click('[data-tk="bulk"][data-arg="priority"]'); await p.waitForSelector('.xcm', { timeout: 3000 }); await menuClick(/^Low/); await settle(900);
  ok(db.tasks.find((x) => x.key === 'T-1').priority === 'low' && db.tasks.find((x) => x.key === 'T-4').priority === 'low' && !/selected/.test(await main()), 'one action changes every selected task');
  ok(await renders() === 0, 'the board redrew in place throughout');
  db.tasks.push({ ...db.tasks[0], key: 'T-9', number: 9, title: 'Raised by Codrin', status: 'raised', assignee: null, priority: 'none', events: [], updatedAt: now() });
  await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(!!(await p.$('[data-tk-col="raised"] [data-tk-card="T-9"]')), 'a task someone else adds appears on the board without reloading the page');
  await p.click('[data-tk-card="T-9"]', { button: 'right' }); await p.waitForSelector('.xcm', { timeout: 3000 });
  const items = await p.$$eval('.xcm .xcm-i', (els) => els.map((e) => e.textContent.trim()));
  ok(['Open', 'Take it', 'Move to', 'Assign to', 'Priority', 'Rename', 'Add sub-task', 'Select', 'Delete task'].every((w) => items.some((x) => x.startsWith(w))), 'right-clicking a card gives its full menu (' + items.length + ' items)');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const card = document.querySelector('[data-tk-card="T-9"]'), col = document.querySelector('[data-tk-col="todo"] .tk-col-b'); const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); });
  await settle();
  ok(db.tasks.find((x) => x.key === 'T-9')?.status === 'todo', 'dragging a card to another column moves the task');
  await p.click('[data-tk-card="T-9"]', { button: 'right' }); await p.waitForSelector('.xcm', { timeout: 3000 });
  await menuClick(/^Delete task/); await p.waitForSelector('.xd [data-xd-ok]', { timeout: 3000 }); await p.click('.xd [data-xd-ok]'); await settle();
  ok(!db.tasks.some((x) => x.key === 'T-9') && !(await p.$('[data-tk-card="T-9"]')), 'Delete removes the task from the board, after a confirmation');
  await p.evaluate(() => window.XENO_HIST.undo());
  await p.waitForSelector('[data-tk-card="T-9"]', { timeout: 5000 }).catch(() => {});
  ok(db.tasks.some((x) => x.key === 'T-9') && !!(await p.$('[data-tk-card="T-9"]')), 'undo restores a deleted task');
  await p.keyboard.press('?'); await settle(300);
  ok(/Task shortcuts/.test(await p.$eval('.xd', (e) => e.textContent).catch(() => '')), '? lists the keyboard shortcuts');
  await p.keyboard.press('Escape'); await settle(300);

  await nav('#/studio/g/tasks/T-3');
  await p.type('[data-tk-comment] textarea', 'half written');
  db.tasks[2].title = 'Write the launch post v3'; db.tasks[2].updatedAt = new Date(Date.now() + 9000).toISOString(); await p.evaluate(() => window.XENO_TASKS.poll()); await settle();
  ok(/launch post v3/.test(await main()) && await p.$eval('[data-tk-comment] textarea', (e) => e.value) === 'half written', 'a comment being written survives the task redrawing under it');
  fail = true; await nav('#/office/g/tasks');
  ok(/couldn’t be loaded/.test(await main()), 'a failed load says so and offers a retry'); fail = false;
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);

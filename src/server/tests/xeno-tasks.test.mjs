/**
 * XENO Tasks (codename Telos) — /api/tasks against a real Postgres and the REAL router.
 *
 *   node src/server/tests/xeno-tasks.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  const mk = async (name) => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`])).rows[0].id; };
  const ids = { ada: await mk('tk-ada'), bob: await mk('tk-bob'), cyd: await mk('tk-cyd'), eve: await mk('tk-eve'), bot: await mk('tk-bot') };
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin) VALUES ($1, $2, 'other', 'xeno') ON CONFLICT DO NOTHING", [ids.bot, ids.ada]).catch((e) => console.log('    (agent row:', e.message, ')'));
  let actor = ids.ada;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; if (!String(req.headers.authorization || '').startsWith('Bearer ')) req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ada = as('ada'), bob = as('bob'), cyd = as('cyd'), eve = as('eve'), bot = as('bot');
  try {
    // a project Ada owns, shared with Bob (editor), Cyd (viewer) and the agent (viewer)
    const proj = (await ada('POST', '/chat/projects', { name: 'Launch', area: 'dev' })).j.project;
    const email = async (id) => (await pool.query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
    for (const [id, relation] of [[ids.bob, 'editor'], [ids.cyd, 'viewer'], [ids.bot, 'viewer']]) await ada('PUT', `/chat/projects/${proj.id}/access/user/by-email`, { email: await email(id), relation });

    // raise
    const r1 = await cyd('POST', '/tasks', { title: 'Login button <b>misaligned</b>', body: 'On mobile.', kind: 'bug', projectId: proj.id });
    const t1 = r1.j.task;
    check(r1.s === 201 && /^T-\d+$/.test(t1.key) && t1.status === 'raised' && t1.kind === 'bug' && t1.area === 'dev' && t1.reporter.id === ids.cyd, `a viewer raises a task: it gets a key, lands in triage, and takes the project's area (${t1.key})`);
    check(t1.events[0].kind === 'created' && t1.can.moves.length === 0, 'its history starts with "created", and the person who raised it cannot triage it');
    check((await eve('GET', `/tasks/${t1.key}`)).s === 404 && (await eve('POST', '/tasks', { title: 'x', projectId: proj.id })).s === 404, 'someone outside the project is told the task and the project do not exist');
    check((await ada('POST', '/tasks', { title: '' })).s === 400 && (await ada('POST', '/tasks', { title: 'x', kind: 'epic' })).j.code === 'invalid_kind', 'an empty title or an unknown kind is refused');

    // triage and the moves
    check((await cyd('POST', `/tasks/${t1.key}/transition`, { to: 'todo' })).s === 403, 'a viewer cannot triage');
    const tri = await bob('POST', `/tasks/${t1.key}/transition`, { to: 'todo', note: 'Accepted for this week' });
    check(tri.s === 200 && tri.j.task.status === 'todo' && tri.j.task.events.at(-1).from === 'raised' && tri.j.task.events.at(-1).note === 'Accepted for this week', 'an editor triages it; the move and its note are in the history');
    check((await bob('POST', `/tasks/${t1.key}/transition`, { to: 'in_review' })).j.code === 'invalid_transition', 'a move the state machine does not allow is refused');

    // claim (atomic), work, review
    const c1 = await bot('POST', `/tasks/${t1.key}/claim`);
    check(c1.s === 200 && c1.j.task.delegate && c1.j.task.delegate.id === String(ids.bot) && c1.j.task.delegate.kind === 'agent' && !c1.j.task.assignee, 'an agent that takes a task becomes its delegate (an agent is never the assignee)');
    const c2 = await cyd('POST', `/tasks/${t1.key}/claim`);
    check(c2.j.task.assignee && c2.j.task.assignee.id === String(ids.cyd) && c2.j.task.delegate.id === String(ids.bot), 'a person can still take it as the accountable assignee, alongside the agent doing the work');
    check((await cyd('POST', `/tasks/${t1.key}/claim`)).j.code === 'already_claimed', 'a second claim of the same role is refused: two cannot hold one task');
    await cyd('PATCH', `/tasks/${t1.key}`, { assigneeId: null });   // the viewer lets go again (the checks below need them uninvolved)
    await ada('PATCH', `/tasks/${t1.key}`, { reviewerId: ids.ada, reviewRequired: true });
    check((await bot('POST', `/tasks/${t1.key}/transition`, { to: 'in_progress' })).j.task.status === 'in_progress', 'the assignee starts it');
    check((await bot('POST', `/tasks/${t1.key}/transition`, { to: 'done' })).s === 403, 'with review required, the assignee cannot close it directly');
    await bot('POST', `/tasks/${t1.key}/comments`, { body: 'Fixed the flex rule; screenshot attached.' });
    check((await bot('POST', `/tasks/${t1.key}/transition`, { to: 'in_review' })).j.task.status === 'in_review', 'the assignee sends it to review');
    const own = await bot('POST', `/tasks/${t1.key}/transition`, { to: 'done' });
    check(own.s === 403 && /cannot accept your own work/.test(own.j.error), 'the assignee cannot accept their own work');
    const acc = await ada('POST', `/tasks/${t1.key}/transition`, { to: 'done' });
    check(acc.j.task.status === 'done' && !!acc.j.task.closedAt, 'the reviewer accepts it: done, with the time it closed');
    const hist = acc.j.task.events.map((e) => e.kind + (e.to ? ':' + e.to : '')).join(' ');
    check(/created:raised .*status:todo .*claimed.* status:in_progress .*comment .*status:in_review status:done/.test(hist) && acc.j.task.events.find((e) => e.kind === 'comment').actor.kind === 'agent', `the full history is kept, and says which steps an agent took (${hist.slice(0, 120)})`);
    check((await cyd('POST', `/tasks/${t1.key}/transition`, { to: 'todo' })).j.task.status === 'todo', 'the reporter can reopen a done task');

    // stale moves
    const t2 = (await bob('POST', '/tasks', { title: 'Write the changelog', projectId: proj.id })).j.task;
    await bob('POST', `/tasks/${t2.key}/transition`, { to: 'todo' });
    // two moves sent at once from the same state: only one may win, the other is told someone moved it first
    let raced = 0, won = 0;
    for (let i = 0; i < 5; i++) {
      const tk = (await bob('POST', '/tasks', { title: 'Race ' + i, projectId: proj.id })).j.task; await bob('POST', `/tasks/${tk.key}/transition`, { to: 'todo' });
      actor = ids.bob; const send = (to) => fetch(base + `/tasks/${tk.key}/transition`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, from: 'todo' }) }).then((r) => r.status);
      const [a, b] = await Promise.all([send('in_progress'), send('wont_do')]); if (a === 200 && b === 200) raced++; if (a === 200 || b === 200) won++;
      const evs = (await bob('GET', `/tasks/${tk.key}`)).j.task.events.filter((e) => e.kind === 'status').length; if (evs !== 2) raced++;
    }
    check(raced === 0 && won === 5, `two moves at once from one state: exactly one wins each time (${raced} double wins)`);

    // personal tasks and areas
    const p1 = (await eve('POST', '/tasks', { title: 'Buy a domain', area: 'office' })).j.task;
    check(p1.project === null && p1.area === 'office' && p1.can.moves.includes('todo'), 'a personal task belongs to its owner, who triages it');
    check((await ada('GET', `/tasks/${p1.key}`)).s === 404, 'nobody else sees a personal task');
    check((await eve('POST', '/tasks', { title: 'x', area: 'Bad One' })).j.code === 'invalid_area', 'a malformed area is refused');
    const elsewhere = (await ada('POST', '/tasks', { title: 'Plan the offsite', area: 'office' })).j.task;
    const keys = async (who, q) => (await who('GET', '/tasks' + q)).j.tasks.map((t) => t.key).sort().join();
    check((await keys(ada, '?area=dev')).includes(t1.key) && !(await keys(ada, '?area=dev')).includes(elsewhere.key) && (await keys(ada, '?area=office')).includes(elsewhere.key) && (await keys(ada, '')).includes(elsewhere.key), 'an area lists its own tasks, and no filter lists them all');
    check((await keys(eve, '?area=office')) === p1.key && !(await keys(eve, '')).includes(t1.key), 'each person sees only what they may see');
    check((await keys(bot, '?assignee=me')) === t1.key, '"assigned to me" lists the caller’s tasks');
    check((await keys(ada, '?status=todo&q=changelog')) === t2.key && (await keys(ada, '?status=done&q=changelog')) === '' && (await keys(ada, '?q=Login')) === t1.key, 'status and text filters work');
    check((await ada('GET', '/tasks?status=nope')).s === 400, 'an unknown status filter is refused');
    check((await ada('PATCH', `/tasks/${t1.key}`, { assigneeId: ids.eve })).j.code === 'assignee_without_access', 'a task cannot be assigned to someone who cannot see the project');
    check((await cyd('PATCH', `/tasks/${t1.key}`, { priority: 'urgent' })).s === 403, 'a viewer who is not the assignee cannot edit it');

    // images
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
    const up = async (who, key, buf, name = 'shot.png') => { actor = ids[who]; const r = await fetch(base + `/tasks/${key}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const it = (await bob('POST', '/tasks', { title: 'Hero image', projectId: proj.id })).j.task;
    const u1 = await up('bob', it.key, PNG, 'hero <1>.png');
    check(u1.s === 201 && u1.j.task.attachments.length === 1 && u1.j.task.attachments[0].mime === 'image/png' && u1.j.task.attachments[0].filename === 'hero 1 .png'.replace(' 1 ', ' 1 ') && u1.j.task.events.some((e) => e.kind === 'attached'), 'a PNG is added to the task, its name cleaned, and the history records it');
    const aid = u1.j.task.attachments[0].id;
    actor = ids.cyd; const got = await fetch(base + `/tasks/${it.key}/attachments/${aid}`);
    const gotBuf = Buffer.from(await got.arrayBuffer());
    check(got.status === 200 && got.headers.get('content-type') === 'image/png' && got.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(got.headers.get('content-security-policy') || '') && gotBuf.equals(PNG), 'anyone on the project gets the exact image back, served as an image that cannot run');
    actor = ids.eve; check((await fetch(base + `/tasks/${it.key}/attachments/${aid}`)).status === 404, 'someone outside the project cannot fetch the image');
    check((await up('bob', it.key, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png')).s === 415, 'an SVG named .png is refused: the type comes from the bytes, not the name');
    check((await up('cyd', it.key, PNG)).s === 403, 'a viewer who is not working on the task cannot add images');
    check((await up('bob', it.key, Buffer.alloc(9 * 1024 * 1024, 1))).s === 413, 'an image over 8 MB is refused');
    check((await cyd('DELETE', `/tasks/${it.key}/attachments/${aid}`)).s === 403 && (await bob('DELETE', `/tasks/${it.key}/attachments/${aid}`)).j.task.attachments.length === 0, 'only whoever added an image (or a manager) removes it');

    // assignees: people and agents on the project; the caller's own agents are offered too
    const as1 = (await ada('GET', `/tasks/assignees?projectId=${proj.id}`)).j.assignees;
    check(as1.some((p) => p.id === String(ids.bob) && p.kind === 'human') && as1.some((p) => p.id === String(ids.bot) && p.kind === 'agent' && !p.needsShare) && !as1.some((p) => p.id === String(ids.eve)), 'assignees are the people and agents the project is shared with, and nobody else');
    check((await eve('GET', `/tasks/assignees?projectId=${proj.id}`)).s === 404, 'someone outside the project cannot list who is on it');

    // delete
    const d1 = (await cyd('POST', '/tasks', { title: 'Raised by mistake', projectId: proj.id })).j.task;
    check((await cyd('DELETE', `/tasks/${d1.key}`)).s === 200 && (await ada('GET', `/tasks/${d1.key}`)).s === 404 && !(await ada('GET', `/tasks?projectId=${proj.id}`)).j.tasks.some((x) => x.key === d1.key), 'the reporter withdraws a task still in triage; it is gone from the task and the board');
    const d2 = (await cyd('POST', '/tasks', { title: 'Accepted work', projectId: proj.id })).j.task; await bob('POST', `/tasks/${d2.key}/transition`, { to: 'todo' });
    check((await cyd('DELETE', `/tasks/${d2.key}`)).s === 403 && (await bob('DELETE', `/tasks/${d2.key}`)).s === 403 && (await ada('DELETE', `/tasks/${d2.key}`)).s === 200, 'once accepted, only a project admin deletes a task (not the reporter, not an editor)');
    check((await pool.query("SELECT deleted_at IS NOT NULL AS gone FROM tasks WHERE number = $1", [d2.number])).rows[0].gone && (await pool.query("SELECT count(*)::int AS n FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE t.number = $1 AND e.kind = 'deleted'", [d2.number])).rows[0].n === 1, 'a deleted task keeps its row and its history, so its key is never reused');

    // ── collaboration: notifications, watchers, mentions, history values, comments, sub-tasks, links, views, restore
    const { listNotifications, sweepDueReminders } = await import('../services/xenoTasks.js');
    const inbox = async (who) => (await listNotifications(pool, ids[who])).items;
    const bobName = (await pool.query('SELECT username FROM users WHERE id = $1', [ids.bob])).rows[0].username;
    const ct = (await ada('POST', '/tasks', { title: 'Collab task', projectId: proj.id, assigneeId: ids.bob })).j.task;
    check((await inbox('bob')).some((n) => n.kind === 'assigned' && n.ref === ct.key && /assigned it to you/.test(n.detail)) && !(await inbox('ada')).some((n) => n.ref === ct.key), 'the assignee is told; the person who acted is not');
    const pr1 = (await ada('PATCH', `/tasks/${ct.key}`, { priority: 'high' })).j.task;
    const pe = pr1.events.find((e) => e.kind === 'edited' && e.field === 'priority');
    check(pe && pe.from === 'none' && pe.to === 'high', 'the history records which field changed, from what, to what');
    const ra = (await ada('PATCH', `/tasks/${ct.key}`, { reviewerId: ids.ada, reviewRequired: true })).j.task;
    check(ra.events.some((e) => e.field === 'reviewer' && e.toName), 'a reviewer change names the person');
    const cm = (await cyd('POST', `/tasks/${ct.key}/comments`, { body: `please check @${bobName} thanks` })).j.task;
    check((await inbox('bob')).some((n) => n.kind === 'mentioned' && n.ref === ct.key) && !(await inbox('bob')).some((n) => n.kind === 'commented' && n.ref === ct.key), 'an @mention tells that person once (as a mention, not also as a comment)');
    check((await inbox('ada')).some((n) => n.kind === 'commented' && n.ref === ct.key), 'other watchers hear about the comment');
    check((await eve('POST', `/tasks/${ct.key}/comments`, { body: 'x' })).s === 404 && !(await inbox('eve')).length, 'someone outside the project is never notified');
    const cid = cm.events.filter((e) => e.kind === 'comment').at(-1).id;
    check((await bob('PATCH', `/tasks/${ct.key}/comments/${cid}`, { body: 'hijack' })).s === 403, 'only the author edits a comment');
    const ed = (await cyd('PATCH', `/tasks/${ct.key}/comments/${cid}`, { body: 'please check, updated' })).j.task;
    check(ed.events.find((e) => e.id === cid).note === 'please check, updated' && ed.events.find((e) => e.id === cid).editedAt, 'the author edits it and it shows as edited');
    const rm = (await cyd('DELETE', `/tasks/${ct.key}/comments/${cid}`)).j.task;
    check(rm.events.find((e) => e.id === cid).removed && rm.events.find((e) => e.id === cid).note === null, 'a removed comment keeps its place but loses its words');
    // watching
    check((await cyd('GET', `/tasks/${ct.key}`)).j.task.watching === true && (await cyd('DELETE', `/tasks/${ct.key}/watch`)).j.task.watching === false, 'commenting makes you a watcher; you can stop watching');
    const before = (await inbox('cyd')).length; await bob('POST', `/tasks/${ct.key}/comments`, { body: 'more' });
    check((await inbox('cyd')).length === before, 'someone who stopped watching hears nothing more');
    // transitions: review requested, changes requested
    await ada('POST', `/tasks/${ct.key}/transition`, { to: 'todo' }); await bob('POST', `/tasks/${ct.key}/transition`, { to: 'in_progress' }); await bob('POST', `/tasks/${ct.key}/transition`, { to: 'in_review' });
    check((await inbox('ada')).some((n) => n.kind === 'review_requested' && n.ref === ct.key), 'sending to review tells the reviewer');
    await ada('POST', `/tasks/${ct.key}/transition`, { to: 'in_progress', note: 'tighten the copy' });
    check((await inbox('bob')).some((n) => n.kind === 'changes_requested' && /tighten the copy/.test(n.detail)), 'asking for changes tells the assignee, with the note');
    // marking read
    // sub-tasks
    const sub = (await bob('POST', '/tasks', { title: 'Sub one', parentKey: ct.key })).j.task;
    await bob('POST', '/tasks', { title: 'Sub two', parentKey: ct.key });
    check(sub.parent && sub.parent.key === ct.key && sub.project && sub.project.id === proj.id, 'a sub-task lives under its parent, in the same project');
    const par = (await ada('GET', `/tasks/${ct.key}`)).j.task;
    check(par.children.length === 2 && par.subtasks.total === 2 && par.subtasks.done === 0, 'the parent lists its sub-tasks and their progress');
    check((await ada('PATCH', `/tasks/${ct.key}`, { parentKey: sub.key })).j.code === 'parent_cycle', 'a task cannot become its own ancestor');
    const personal = (await eve('POST', '/tasks', { title: 'Mine', area: 'office' })).j.task;
    check((await bob('POST', '/tasks', { title: 'x', parentKey: personal.key })).s === 404, 'you cannot hang a sub-task under a task you cannot see');
    // links
    const t2b = (await bob('POST', '/tasks', { title: 'Blocker', projectId: proj.id })).j.task;
    const lk = (await ada('POST', `/tasks/${ct.key}/links`, { kind: 'blocked_by', to: t2b.key })).j.task;
    check(lk.links.some((l) => l.label === 'blocked by' && l.task.key === t2b.key) && (await ada('GET', `/tasks/${t2b.key}`)).j.task.links.some((l) => l.label === 'blocks' && l.task.key === ct.key), 'a link reads correctly from both ends (blocked by / blocks)');
    check((await ada('POST', `/tasks/${ct.key}/links`, { kind: 'relates', to: personal.key })).s === 404, 'a link cannot point at a task you cannot see');
    check((await cyd('POST', `/tasks/${ct.key}/links`, { kind: 'relates', to: t2b.key })).s === 403, 'a viewer cannot link');
    const ul = (await ada('DELETE', `/tasks/${ct.key}/links/${lk.links.find((l) => l.task.key === t2b.key).id}`)).j.task;
    check(!ul.links.some((l) => l.task.key === t2b.key), 'a link can be removed');
    // restore after delete
    const del = (await ada('POST', '/tasks', { title: 'Oops', projectId: proj.id })).j.task; await ada('DELETE', `/tasks/${del.key}`);
    check((await cyd('POST', `/tasks/${del.key}/restore`)).s === 403 && (await ada('POST', `/tasks/${del.key}/restore`)).j.task.key === del.key && (await ada('GET', `/tasks/${del.key}`)).s === 200, 'a delete can be undone by whoever could delete it');
    // saved views
    const v1 = (await ada('POST', '/tasks/views', { name: 'My bugs', area: 'dev', filters: { assignee: 'me', kind: 'bug', evil: 'x' } })).j.views;
    check(v1.length === 1 && v1[0].filters.kind === 'bug' && !('evil' in v1[0].filters) && (await bob('GET', '/tasks/views')).j.views.length === 0, 'a saved view keeps only known filters and belongs to its owner');
    check((await bob('DELETE', `/tasks/views/${v1[0].id}`)).s === 404 && (await ada('DELETE', `/tasks/views/${v1[0].id}`)).j.views.length === 0, 'only its owner deletes a view');
    // due reminders, once per due date
    const due = (await ada('POST', '/tasks', { title: 'Due soon', projectId: proj.id, assigneeId: ids.bob, dueAt: new Date(Date.now() + 3600e3).toISOString() })).j.task;
    await sweepDueReminders(pool); await sweepDueReminders(pool);
    check((await inbox('bob')).filter((n) => n.kind === 'due_soon' && n.ref === due.key).length === 1, 'a due-soon reminder is sent once, not on every sweep');
    await ada('PATCH', `/tasks/${due.key}`, { dueAt: new Date(Date.now() - 60e3).toISOString() }); await sweepDueReminders(pool);
    check((await inbox('bob')).some((n) => n.kind === 'overdue' && n.ref === due.key) && (await inbox('ada')).some((n) => n.kind === 'overdue' && n.ref === due.key), 'an overdue task tells the assignee and the reporter');

    // the inbox API and the email sweep
    const napp = express(); napp.use(express.json()); napp.use((req, _r, next) => { req.db = pool; req.user = { id: actor }; next(); });
    napp.use('/api/notifications', (await import('../routes/userNotificationsRoutes.js')).default);
    const nsrv = http.createServer(napp); await new Promise((r) => nsrv.listen(0, '127.0.0.1', r)); const nbase = `http://127.0.0.1:${nsrv.address().port}/api/notifications`;
    try {
      actor = ids.bob; const nl = await (await fetch(nbase)).json();
      check(nl.success && nl.unread > 0 && nl.items.every((n) => n.source === 'tasks'), 'GET /api/notifications lists the inbox with its unread count');
      const one = nl.items.find((n) => !n.read);
      const after1 = await (await fetch(nbase + '/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [one.id] }) })).json();
      check(after1.unread === nl.unread - 1, 'marking one read lowers the count by one');
      actor = ids.cyd; await fetch(nbase + '/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [nl.items[1].id] }) });
      actor = ids.bob; check((await (await fetch(nbase)).json()).unread === nl.unread - 1, 'nobody can mark someone else’s notifications read');
    } finally { await new Promise((r) => nsrv.close(r)); }
    const { sendPendingTaskEmails } = await import('../services/taskNotifyEmail.js');
    const sentTo = [];
    const send = async (_db, tpl, to, data) => { sentTo.push([tpl, to, data.heading]); };
    const m1 = await sendPendingTaskEmails(pool, { delayMinutes: 0, send, env: {} });
    const m2 = await sendPendingTaskEmails(pool, { delayMinutes: 0, send, env: {} });
    check(m1.sent > 0 && m2.claimed === 0 && sentTo.every(([tpl]) => tpl === 'task_notification'), `the email sweep sends each notification at most once (${m1.sent} sent, then ${m2.claimed})`);
    check((await pool.query(`SELECT count(*)::int AS n FROM user_notifications WHERE kind IN ('commented', 'status') AND emailed_at IS NOT NULL`)).rows[0].n === 0, 'comments and status changes stay in the inbox and are never mailed');
    check((await sendPendingTaskEmails(pool, { delayMinutes: 0, send, env: { TASK_NOTIFICATION_EMAILS: 'false' } })).enabled === false, 'TASK_NOTIFICATION_EMAILS=false turns the mail off');

    // ── agents: delegation, credentials, sessions, events, MCP, hand-off
    {
    const tok = (raw) => async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + raw }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const ag = (await ada('POST', '/tasks', { title: 'Agent work', projectId: proj.id, body: 'Do the thing' })).j.task;
    await ada('POST', `/tasks/${ag.key}/transition`, { to: 'todo' });
    const dg = (await ada('PATCH', `/tasks/${ag.key}`, { assigneeId: ids.bot })).j.task;
    check(dg.delegate && dg.delegate.id === String(ids.bot) && dg.delegate.kind === 'agent' && dg.assignee && dg.assignee.id === String(ids.ada) && dg.session && dg.session.state === 'pending' && dg.events.some((e) => e.kind === 'delegated'), 'choosing an agent as assignee makes it the DELEGATE; a person stays the accountable assignee; a session starts');
    check(dg.events.find((e) => e.kind === 'delegated').toName === 'bot' || !!dg.events.find((e) => e.kind === 'delegated').toName, 'the hand-off event names the agent it went to');
    check((await ada('POST', `/tasks/${ag.key}/delegate`, { agentId: ids.bob })).j.code === 'delegate_not_agent', 'only an agent can be a delegate');
    { const refused = await ada('POST', '/tasks/agents', { name: 'Release bot' });
      check(refused.s === 403 && refused.j.error === 'plan_upgrade_required', 'creating an agent from Tasks keeps the same paywall as the platform’s agents (free plan refused)');
      const { createTaskAgent } = await import('../services/xenoTasks.js');
      const made = await createTaskAgent(pool, { id: ids.ada, kind: 'human', name: 'Ada' }, { name: 'Release bot' });
      const key = (await pool.query('SELECT bool_or(is_active) AS on FROM api_keys WHERE user_id = $1', [made.agent.id])).rows[0].on;
      const owner = (await pool.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [made.agent.id])).rows[0];
      check(made.agent.name === 'Release bot' && key !== true && String(owner.owner_user_id) === String(ids.ada), 'an entitled person creates an agent: owned by them, its general API key off');
      let named = null; try { await createTaskAgent(pool, { id: ids.ada, kind: 'human' }, { name: '  ' }); } catch (e) { named = e.code; }
      let agentMade = null; try { await createTaskAgent(pool, { id: ids.bot, kind: 'agent' }, { name: 'x' }); } catch (e) { agentMade = e.code; }
      check(named === 'name_required' && agentMade === 'not_allowed', 'an agent needs a name, and an agent cannot create agents'); }
    check((await pool.query("SELECT count(*)::int AS n FROM task_agent_events WHERE agent_user_id = $1 AND kind = 'delegated'", [ids.bot])).rows[0].n >= 1, 'the agent is told it was delegated a task');
    // credentials
    check((await bob('POST', '/tasks/agents/tokens', { agentId: ids.bot })).s === 404, 'only an agent’s owner can issue it a credential');
    const ro = (await ada('POST', '/tasks/agents/tokens', { agentId: ids.bot, scopes: ['tasks:read'], label: 'reader' })).j;
    const rw = (await ada('POST', '/tasks/agents/tokens', { agentId: ids.bot, label: 'worker' })).j;
    check(/^xtk_[a-z0-9]{12}_/.test(ro.token) && rw.scopes.includes('tasks:write'), 'the owner issues scoped credentials to their agent');
    const listed = (await ada('GET', '/tasks/agents')).j.agents.find((a) => a.id === String(ids.bot));
    check(listed && listed.tokens.length >= 2 && listed.tokens.every((k) => k.hint.endsWith('_…') && !('token' in k)), 'listing agents never shows a credential’s secret');
    check((await pool.query('SELECT token_hash FROM task_agent_tokens WHERE id = $1', [ro.id])).rows[0].token_hash !== ro.token, 'only a hash of the secret is stored');
    const R = tok(ro.token), W = tok(rw.token);
    const meR = await R('GET', '/tasks/agent/me');
    check(meR.s === 200 && meR.j.agent.kind === 'agent' && meR.j.tasks.some((x) => x.key === ag.key), 'an agent with its own credential sees the work delegated to it');
    check((await R('POST', `/tasks/${ag.key}/comments`, { body: 'x' })).j.code === 'scope_missing', 'a read-only credential cannot write');
    check((await tok('xtk_aaaaaaaaaaaa_' + 'b'.repeat(43))('GET', '/tasks/agent/me')).s === 401, 'an unknown credential is refused, not treated as someone else');
    check((await W('GET', '/tasks/agents')).s === 403, 'an agent can’t manage agents');
    // session and activity
    await W('POST', `/tasks/${ag.key}/claim`);
    const asked = (await W('POST', `/tasks/${ag.key}/activity`, { type: 'ask', body: 'Which colour should the button be?' })).j.task;
    check(asked.session.state === 'awaiting_input' && asked.events.some((e) => e.kind === 'activity' && e.from === 'ask'), 'the agent’s question shows on the task and its session waits for a reply');
    check((await inbox('ada')).some((n) => n.kind === 'agent_question' && n.ref === ag.key), 'the assignee is told the agent asked something');
    check((await bob('POST', `/tasks/${ag.key}/activity`, { type: 'thought', body: 'x' })).j.code === 'not_delegate', 'only the delegate reports activity');
    await ada('POST', `/tasks/${ag.key}/comments`, { body: 'Use black.' });
    await W('POST', `/tasks/${ag.key}/activity`, { type: 'action', body: 'Changing the button colour' });
    await W('POST', `/tasks/${ag.key}/transition`, { to: 'in_progress', from: 'todo' });
    await ada('PATCH', `/tasks/${ag.key}`, { reviewerId: ids.ada, reviewRequired: true });
    const sent = (await W('POST', `/tasks/${ag.key}/transition`, { to: 'in_review', from: 'in_progress' })).j.task;
    check(sent.status === 'in_review' && sent.session.state === 'done', 'the agent hands its work in for review and its session ends');
    check((await W('POST', `/tasks/${ag.key}/transition`, { to: 'done', from: 'in_review' })).s === 403, 'an agent can never accept its own work');
    await ada('POST', `/tasks/${ag.key}/transition`, { to: 'in_progress', from: 'in_review', note: 'Make it bigger' });
    const ev = (await W('GET', '/tasks/agent/events?after=0')).j;
    const kinds = ev.events.filter((e) => e.task.key === ag.key).map((e) => e.kind);
    check(['delegated', 'reply', 'changes_requested'].every((k) => kinds.includes(k)) && ev.events.find((e) => e.kind === 'changes_requested').task.note === 'Make it bigger', `the agent’s feed has delegated, the reply and the change request with its note (${kinds})`);
    check((await W('GET', `/tasks/agent/events?after=${ev.cursor}`)).j.events.length === 0, 'the feed pages by cursor');
    // push: signed webhooks, unsafe addresses refused, failures retried
    check((await ada('PUT', '/tasks/agents/webhook', { agentId: ids.bot, url: 'http://127.0.0.1:9/hook' })).j.code === 'unsafe_url', 'a webhook can’t point at an internal address');
    const wh = (await ada('PUT', '/tasks/agents/webhook', { agentId: ids.bot, url: 'https://hooks.example.com/xeno' })).j;
    const { deliverAgentEvents } = await import('../services/xenoTasks.js'); const crypto = await import('node:crypto');
    const pushed = []; await deliverAgentEvents(pool, { send: async (url, o) => { pushed.push({ url, o }); return { status: 200 }; } });
    const one = pushed[0]; const [ts, v1] = one ? one.o.headers['x-xeno-signature'].split(',').map((p) => p.split('=')[1]) : [];
    check(pushed.length >= 3 && one.url === 'https://hooks.example.com/xeno' && v1 === crypto.createHmac('sha256', wh.secret).update(`${ts}.${one.o.body}`).digest('hex'), `queued events are pushed to the webhook, each signed with the agent’s secret (${pushed.length})`);
    check((await pool.query('SELECT count(*)::int AS n FROM task_agent_events WHERE agent_user_id = $1 AND delivered_at IS NULL', [ids.bot])).rows[0].n === 0, 'a delivered event is not sent again');
    await ada('POST', `/tasks/${ag.key}/comments`, { body: 'One more thing' });
    await deliverAgentEvents(pool, { send: async () => ({ status: 503 }) });
    const retry = (await pool.query("SELECT attempts, next_attempt_at > now() AS later, last_error FROM task_agent_events WHERE agent_user_id = $1 AND kind = 'reply' ORDER BY id DESC LIMIT 1", [ids.bot])).rows[0];
    check(retry.attempts === 1 && retry.later && /503/.test(retry.last_error), 'a failed delivery is retried later, with the reason kept');
    // MCP
    const rpc = (f) => async (method, params) => (await f('POST', '/tasks/mcp', { jsonrpc: '2.0', id: 1, method, params })).j;
    const mW = rpc(W), mR = rpc(R);
    check((await mW('initialize')).result.serverInfo.name === 'xeno-tasks' && (await mW('tools/list')).result.tools.some((x) => x.name === 'report_activity'), 'MCP answers initialize and lists the task tools');
    const mg = (await mW('tools/call', { name: 'get_task', arguments: { key: ag.key } })).result;
    check(!mg.isError && mg.structuredContent.task.key === ag.key && /\/tasks\/T-\d+$/.test(mg.structuredContent.task.url), 'an MCP tool returns the task with its link');
    check((await mR('tools/call', { name: 'comment', arguments: { key: ag.key, body: 'x' } })).result.isError, 'MCP enforces the credential’s scopes like the API does');
    const ml = (await mW('tools/call', { name: 'list_my_tasks', arguments: {} })).result.structuredContent.tasks;
    check(ml.some((x) => x.key === ag.key), 'list_my_tasks gives the agent its delegated work');
    // revoke
    await ada('DELETE', `/tasks/agents/tokens/${ro.id}`);
    check((await R('GET', '/tasks/agent/me')).s === 401, 'a revoked credential stops working at once');
    // the hand-off link: a task-only credential for the owner's hand-off agent
    const hk = (await bob('POST', '/tasks', { title: 'Hand me off', projectId: proj.id })).j.task;
    const other = (await bob('POST', '/tasks', { title: 'Not yours', projectId: proj.id })).j.task;
    check((await cyd('POST', `/tasks/${hk.key}/handoff`)).s === 403, 'a viewer can’t hand a task to an agent');
    const ho = (await bob('POST', `/tasks/${hk.key}/handoff`)).j;
    check(/^xtk_/.test(ho.token) && ho.task.delegate && ho.task.delegate.id === ho.agent.id && ho.task.session.state === 'pending', 'handing off makes the hand-off agent the delegate and returns a credential');
    const H = tok(ho.token);
    check((await H('GET', `/tasks/${hk.key}`)).s === 200 && (await H('POST', `/tasks/${hk.key}/activity`, { type: 'thought', body: 'Reading the task' })).s === 200, 'the pasted agent reads its task and reports back');
    check((await H('GET', `/tasks/${other.key}`)).j.code === 'single_task' && (await H('POST', '/tasks', { title: 'x' })).j.code === 'single_task' && (await H('PATCH', `/tasks/${other.key}`, { title: 'x' })).j.code === 'single_task', 'a hand-off credential reaches only its own task');
    check((await H('GET', '/tasks')).j.tasks.length === 1, 'listing with a hand-off credential shows only its task');
    check((await rpc(H)('tools/call', { name: 'create_task', arguments: { title: 'x' } })).result.isError, 'MCP keeps the hand-off credential to its one task');
    check((await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND is_active', [ho.agent.id])).rows[0].n === 0, 'the hand-off agent has no general API key — only its task credential');
    check((await pool.query('SELECT 1 FROM relationship_tuples WHERE object_id = $1 AND subject_id = $2', [String(proj.id), ho.agent.id])).rowCount === 0, 'handing off does not share the whole project with the agent');
    const ho2 = (await bob('POST', `/tasks/${other.key}/handoff`)).j;
    check(ho2.agent.id === ho.agent.id, 'the same hand-off agent is reused, not a new one each time');

    }
    console.log(`xeno-tasks: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM tasks WHERE reporter_id = ANY($1) OR owner_user_id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await new Promise((r) => server.close(r)); await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

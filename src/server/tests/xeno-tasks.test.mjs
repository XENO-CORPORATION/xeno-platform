/**
 * XENO Tasks (codename Telos) — /api/tasks against a real Postgres and the REAL router.
 *
 *   node src/server/tests/xeno-tasks.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes from '../routes/xenoTasksRoutes.js';
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
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', xenoTasksRoutes);
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
    check(c1.s === 200 && c1.j.task.assignee.id === ids.bot && c1.j.task.assignee.kind === 'agent', 'an agent claims the unassigned task');
    check((await cyd('POST', `/tasks/${t1.key}/claim`)).j.code === 'already_claimed', 'a second claim is refused: two cannot hold one task');
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

    console.log(`xeno-tasks: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM tasks WHERE reporter_id = ANY($1) OR owner_user_id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await new Promise((r) => server.close(r)); await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

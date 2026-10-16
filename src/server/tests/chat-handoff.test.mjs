/**
 * `@agent` from a chat — POST /api/chat/conversations/:id/handoff against a real Postgres and the REAL chat router.
 *
 *   node src/server/tests/chat-handoff.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as agents from '../services/platformAgents.js';
import { normalizeTurnRecord } from '../utils/chatTurnRecord.js';
import { titleOf } from '../services/chatHandoff.js';
import { activate } from '../services/accountActivation.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
delete process.env.AGENTS_API_BASE_URL;   // no cloud runner: the run note path
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  const mk = async (name) => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`])).rows[0].id; };
  const ids = { ada: await mk('ho-ada'), eve: await mk('ho-eve') };
  for (const id of Object.values(ids)) await activate(pool, id);
  let actor = ids.ada;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ada = as('ada'), eve = as('eve');
  try {
    check(titleOf('  \nFix the login bug\nand more') === 'Fix the login bug' && titleOf('x'.repeat(200)).length === 118, 'the task title is the first line, kept short');
    const proj = (await ada('POST', '/chat/projects', { name: 'Launch', area: 'dev' })).j.project;
    const atlas = await agents.create(pool, { id: ids.ada, kind: 'human' }, { name: 'Atlas' });
    // the agent works on the project
    await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('project', $1, 'viewer', 'user', $2) ON CONFLICT DO NOTHING`, [String(proj.id), String(atlas.userId)]);
    const convo = (await ada('POST', '/chat/conversations', { title: 'Release planning', project_id: proj.id })).j.conversation.id;

    const r = await ada('POST', `/chat/conversations/${convo}/handoff`, { agentId: atlas.id, prompt: 'Write the release notes for 1.2\nKeep them short.' });
    const h = r.j.handoff;
    check(r.s === 201 && h.delegated === true && /^T-\d+$/.test(h.task.key) && h.task.title === 'Write the release notes for 1.2', `the prompt becomes a task delegated to the agent (${r.s} ${r.j.error || ''})`);
    check(h.run === null && /run|cloud|runner|available/i.test(h.runNote || ''), 'with no cloud runner it says so, and the task still stands');
    const t = (await ada('GET', `/tasks/${h.task.key}`)).j.task;
    check(t.delegate && String(t.delegate.id) === String(atlas.userId) && t.project && String(t.project.id) === String(proj.id), 'the task is filed in the chat’s project, delegated to the agent');
    check(/Keep them short\./.test(t.body) && t.body.includes(String(convo)), 'the task carries the whole prompt and a link back to the chat');

    const loose = (await ada('POST', '/chat/conversations', { title: 'Ideas' })).j.conversation.id;
    const r2 = (await ada('POST', `/chat/conversations/${loose}/handoff`, { agentId: atlas.id, prompt: 'Sketch three names' })).j.handoff;
    check(r2 && r2.delegated === true && !(await ada('GET', `/tasks/${r2.task.key}`)).j.task.project, 'from a loose chat it becomes one of your own tasks');

    // `#folder`: the folder rides with the handoff, so the agent can open it as soon as it has the task
    const { createFolder } = await import('../services/storageFolders.js');
    const fold = (await createFolder(pool, ids.ada, { name: 'Release inputs' })).folder;
    const r3 = (await ada('POST', `/chat/conversations/${convo}/handoff`, { agentId: atlas.id, prompt: 'Read #Release inputs and summarise', folders: [{ id: fold.id }] })).j.handoff;
    const t3 = (await ada('GET', `/tasks/${r3.task.key}`)).j.task;
    check(r3.folders && r3.folders[0] === fold.id && t3.folders && t3.folders[0].name === 'Release inputs', 'a #folder in the handoff is linked to the task');
    const sawFolder = (await pool.query(`SELECT 1 FROM storage_access WHERE kind = 'folder' AND target_id = $1 AND user_id = $2`, [fold.id, atlas.userId])).rows.length === 1;
    check(sawFolder, 'and the agent it was handed to can open that folder');

    check((await eve('POST', `/chat/conversations/${convo}/handoff`, { agentId: atlas.id, prompt: 'Do it' })).s === 404, 'someone outside the chat cannot hand off from it');
    const eves = await agents.create(pool, { id: ids.eve, kind: 'human' }, { name: 'Mole' });
    check((await ada('POST', `/chat/conversations/${convo}/handoff`, { agentId: eves.id, prompt: 'Do it' })).s === 404, 'you cannot hand work to someone else’s agent');
    check((await ada('POST', `/chat/conversations/${convo}/handoff`, { agentId: atlas.id, prompt: '   ' })).j.code === 'prompt_required', 'an empty prompt is refused');

    const turn = { schema: 'xeno.chat.turn.v1', startedAt: Date.now(), steps: [{ id: 'handoff-1', kind: 'handoff', taskKey: h.task.key, agentId: atlas.id, agentName: 'Atlas', startedAt: Date.now() }] };
    check(normalizeTurnRecord(turn).ok, 'the chat can store the handoff in its turn');
    check(!normalizeTurnRecord({ ...turn, steps: [{ ...turn.steps[0], taskKey: 'DROP' }] }).ok, 'a handoff step must name a task key');
    console.log(`\n${passed} passed`);
  } finally { server.close(); await pool.end(); }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

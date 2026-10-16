/**
 * Task folders — a task names Storage folders, and whoever works the task can open them, against a real Postgres
 * and the REAL routes.
 *
 *   node src/server/tests/task-folders.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { activate } from '../services/accountActivation.js';
import { createFolder } from '../services/storageFolders.js';
import * as agents from '../services/platformAgents.js';
import { check as rel, writeTuples } from '../utils/authzReBAC.js';
import { guidanceFor } from '../services/agentGuidance.js';
import { listFiles } from '../services/agentMedia.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  const mk = async (name) => { const m = `${name}-${Date.now()}`; const id = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`])).rows[0].id; await activate(pool, id); return id; };
  const ids = { ada: await mk('tf-ada'), bob: await mk('tf-bob'), eve: await mk('tf-eve') };
  let actor = ids.ada;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ada = as('ada'), bob = as('bob'), eve = as('eve');
  const sees = async (userId, fileId) => (await rel(pool, { object: `library_asset:${fileId}`, relation: 'viewer', subject: `user:${userId}` })).allowed;
  try {
    const proj = (await ada('POST', '/chat/projects', { name: 'Bunkerverse', area: 'dev' })).j.project;
    const email = async (id) => (await pool.query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
    await ada('PUT', `/chat/projects/${proj.id}/access/user/by-email`, { email: await email(ids.bob), relation: 'editor' });
    // Ada's folder with a file in it, and one of Eve's she must not be able to hand out
    const fid = (await createFolder(pool, ids.ada, { name: 'Weapon renders' })).folder.id;
    const file = (await pool.query(`INSERT INTO user_files (user_id, owner_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type) VALUES ($1, $1, 'gun.png', 'gun.png', 'image', 'image/png', 10, '/tmp/x', 'platform-upload') RETURNING id`, [ids.ada])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `library_asset:${file}`, relation: 'owner', subject: `user:${ids.ada}` }] });
    await pool.query(`INSERT INTO storage_item_folders (source, source_id, folder_id) VALUES ('file', $1, $2)`, [file, fid]);
    const efid = (await createFolder(pool, ids.eve, { name: 'Eve private' })).folder.id;
    check(!!fid && !!efid, 'folders to work with');

    const t = (await ada('POST', '/tasks', { title: 'Animate the weapon inspect', projectId: proj.id })).j.task;
    check(!(await sees(ids.bob, file)), 'before the link, Bob cannot open Ada’s file');

    // the picker lists your own folders, never someone else's
    const pick = (await ada('GET', '/tasks/folders/linkable?q=weap')).j.folders;
    check(pick.some((f) => f.id === fid) && !pick.some((f) => f.id === efid), 'the #folder picker lists your folders, and only yours');
    check((await ada('POST', `/tasks/${t.key}/folders`, { folderId: efid })).s === 404, 'you cannot hand out someone else’s folder');

    const add = await ada('POST', `/tasks/${t.key}/folders`, { folderId: fid, role: 'editor' });
    check(add.s === 201 && add.j.folders[0].name === 'Weapon renders' && add.j.folders[0].path === 'Weapon renders' && add.j.folders[0].role === 'editor', 'a folder is linked to the task, with its path');
    check(!(await sees(ids.bob, file)), 'linking alone gives nobody access: only those who work the task');

    // Bob takes the task: he can open the folder's files now
    await ada('PATCH', `/tasks/${t.key}`, { assigneeId: ids.bob });
    check(await sees(ids.bob, file), 'assigning Bob gives him the folder’s files');
    const bobView = (await bob('GET', `/tasks/${t.key}`)).j.task;
    check(bobView.folders && bobView.folders[0].id === fid, 'and the task tells him where to look');

    // an agent delegated the task gets the same access, sees the folder over its library tools and in its guidance
    const atlas = await agents.create(pool, { id: ids.ada, kind: 'human' }, { name: 'Atlas' });
    await writeTuples(pool, { writes: [{ object: `project:${proj.id}`, relation: 'viewer', subject: `user:${atlas.userId}` }] });
    await ada('POST', `/tasks/${t.key}/delegate`, { agentId: atlas.userId });
    check(await sees(atlas.userId, file), 'delegating to an agent gives it the folder too');
    const listed = await listFiles(pool, { id: atlas.userId, kind: 'agent' }, { folderId: fid });
    check(listed.files.some((f) => f.asset_id === String(file)), 'the agent lists the folder’s files with its library tool');
    const g = await guidanceFor(pool, (await ada('GET', `/tasks/${t.key}`)).j.task, atlas.userId);
    check(/Weapon renders/.test(g.text) && g.layers.includes('folders'), 'and its guidance names the folder and how to read it');
    let refused = false; try { await listFiles(pool, { id: atlas.userId, kind: 'agent' }, { folderId: efid }); } catch (e) { refused = e.code === 'folder_not_found'; }
    check(refused, 'an agent cannot list a folder no task gave it');

    // closing the task, or removing the link, takes access away
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [t.id]);
    await ada('POST', `/tasks/${t.key}/transition`, { to: 'wont_do' });
    const closed = (await ada('GET', `/tasks/${t.key}`)).j.task.status;
    if (closed === 'wont_do') check(!(await sees(ids.bob, file)) && !(await sees(atlas.userId, file)), 'closing the task takes the folder away from everyone who worked it');
    else { await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [t.id]); }
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [t.id]);
    const { reconcileTask } = await import('../services/taskFolders.js'); await reconcileTask(pool, t.id);
    check(await sees(ids.bob, file), 'reopened, the access comes back');
    const rm = await ada('DELETE', `/tasks/${t.key}/folders/${fid}`);
    check(rm.s === 200 && rm.j.folders.length === 0 && !(await sees(ids.bob, file)) && !(await sees(atlas.userId, file)), 'removing the link takes the access away');
    check(await sees(ids.ada, file), 'the owner keeps her file, of course');
    check((await eve('GET', `/tasks/${t.key}/folders`)).s === 404, 'someone outside the task cannot see its folders');
    console.log(`\n${passed} passed`);
  } finally { server.close(); await pool.end(); }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

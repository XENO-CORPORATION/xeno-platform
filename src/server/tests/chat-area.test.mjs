/**
 * AREA on conversations, against a real Postgres and the REAL chat router.
 *
 * Owner's rule (2026-10-03, 2026-10-09): each area of the workspace (Studio, Office, Social, Corpo,
 * Dev, Tools, or one the person made) has its own chats; only Overview shows everything. The defect
 * this closes: the workspace listed every conversation in every area, because a conversation had no
 * area at all.
 *
 *   - a new chat lives in the area it was started in; with none given it lives in no area
 *   - `?area=dev` lists that area only, `?area=none` the chats in no area, no filter lists everything
 *   - every row says which area it is in
 *   - a chat can be moved to another area, or to none
 *   - a chat inside a project takes the project's area and cannot be placed on its own
 *   - an area id is checked by shape; 'overview' is not an area
 *   - one person's areas never show another person's chats
 *
 *   node src/server/tests/chat-area.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await runAllMigrations(pool);
  const person = async (name) => { const marker = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [marker, `${marker}@example.test`])).rows[0].id; };
  const ada = await person('area-ada'), bob = await person('area-bob');
  let actor = ada;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/chat`;
  const call = async (method, path, body) => { const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  const titles = async (query = '') => (await call('GET', '/conversations?limit=200' + query)).json.conversations.map((c) => `${c.title}@${c.area ?? '-'}`).sort().join(' ');
  let passed = 0;
  const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

  try {
    const make = async (title, extra = {}) => (await call('POST', '/conversations', { title, model_id: 'm', ...extra })).json.conversation;
    const dev1 = await make('dev1', { area: 'dev' }), dev2 = await make('dev2', { area: 'dev' });
    const studio1 = await make('studio1', { area: 'studio' });
    const custom = await make('custom1', { area: 'c_my-area' });
    const plain = await make('plain');
    check(dev1.area === 'dev' && studio1.area === 'studio' && custom.area === 'c_my-area', 'a new chat lives in the area it was started in (an area the person made included)');
    check(plain.area === null, 'a chat started with no area lives in none');

    check(await titles('&area=dev') === 'dev1@dev dev2@dev', 'one area lists only its own chats');
    check(await titles('&area=studio') === 'studio1@studio', 'another area lists only its own');
    check(await titles('&area=none') === 'plain@-', '`none` lists the chats that are in no area');
    check(await titles() === 'custom1@c_my-area dev1@dev dev2@dev plain@- studio1@studio', 'no filter lists everything, each row naming its area (Overview)');
    check(await titles('&area=office') === '', 'an area with nothing in it is empty, not everything');

    // moving
    const moved = await call('PUT', `/conversations/${dev2.id}`, { area: 'office' });
    check(moved.status === 200 && moved.json.conversation.area === 'office', 'a chat can be moved to another area');
    check(await titles('&area=dev') === 'dev1@dev' && await titles('&area=office') === 'dev2@office', 'and it leaves the one for the other');
    const cleared = await call('PUT', `/conversations/${dev2.id}`, { area: null });
    check(cleared.status === 200 && cleared.json.conversation.area === null && await titles('&area=office') === '', 'or to no area');
    const renamed = await call('PUT', `/conversations/${dev1.id}`, { title: 'dev1 renamed' });
    check(renamed.status === 200 && renamed.json.conversation.area === 'dev', 'a rename does not move it');

    // shape
    for (const bad of ['overview', 'Dev', 'two words', '9lives', 'x'.repeat(41), 7, { a: 1 }]) {
      const r = await call('POST', '/conversations', { title: 'bad', area: bad });
      check(r.status === 400 && r.json.code === 'invalid_area', `an area id that is not one is refused (${JSON.stringify(bad).slice(0, 20)})`);
    }
    check((await call('GET', '/conversations?area=Overview')).status === 400, 'and a list cannot ask for one either');
    check((await call('PUT', `/conversations/${dev1.id}`, { area: 'Nope!' })).json.code === 'invalid_area', 'nor can a move');

    // inside a project: the project's area, read through the project
    const project = (await call('POST', '/projects', { name: 'area project', area: 'social' })).json.project;
    check(!!project?.id && project.area === 'social', 'a project is made in the area it was started in');
    const loose = (await call('POST', '/projects', { name: 'loose project' })).json.project;
    const names = async (q = '') => (await call('GET', '/projects?limit=100' + q)).json.projects.map((p) => `${p.name}@${p.area ?? '-'}`).sort().join(' | ');
    check(await names('&area=social') === 'area project@social' && await names('&area=none') === 'loose project@-' && await names() === 'area project@social | loose project@-' && await names('&area=dev') === '', 'projects list by area the same way: one area, none, or everything');
    check((await call('POST', '/projects', { name: 'bad', area: 'Overview' })).json.code === 'invalid_area' && (await call('GET', '/projects?area=Nope!')).status === 400, 'and refuse an area id that is not one');
    void loose;
    const inProject = await make('in-project', { project_id: project.id, area: 'dev' });
    check((await pool.query('SELECT area FROM chat_conversations WHERE id = $1', [inProject.id])).rows[0].area === null, 'a chat made inside a project stores no area of its own');
    check((await titles('&area=social')).includes('in-project@social') && !(await titles('&area=dev')).includes('in-project'), 'it shows in the PROJECT’s area, whatever area the request named');
    const refused = await call('PUT', `/conversations/${inProject.id}`, { area: 'studio' });
    check(refused.status === 409 && refused.json.code === 'area_follows_project', 'and cannot be placed on its own');
    const movedProject = await call('PUT', `/projects/${project.id}`, { area: 'corpo' });
    check(movedProject.status === 200 && movedProject.json.project.area === 'corpo' && movedProject.json.project.name === 'area project', 'a project can be moved to another area, and nothing else about it changes');
    check((await titles('&area=corpo')).includes('in-project@corpo') && !(await titles('&area=social')).includes('in-project'), 'moving the project moves its chats');

    // another person
    actor = bob;
    check(await titles('&area=dev') === '' && await titles() === '', 'another person sees none of them, in the area or on Overview');
    check((await call('PUT', `/conversations/${dev1.id}`, { area: 'studio' })).status >= 403, 'and cannot move one');
    actor = ada;

    // the database refuses a bad area even if a route forgot to check
    let dbRefused = false; try { await pool.query('UPDATE chat_conversations SET area = $2 WHERE id = $1', [dev1.id, 'Bad Area']); } catch { dbRefused = true; }
    check(dbRefused, 'the database itself refuses an area id that is not one');

    console.log(`chat-area: ${passed} checks passed`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
main().catch((error) => { console.error('chat-area: FAILED\n', error.message); process.exitCode = 1; });

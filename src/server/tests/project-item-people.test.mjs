/**
 * Who is on a project item (services/projectItemPeople.js), against a real Postgres and the REAL routers.
 * Decision: docs/decisions/2026-11-08-who-is-on-a-project-item.md.
 *
 *   off by default (fails closed) · an editor sets it, a viewer cannot · the person must see the project · the item must be
 *   in it · one live person, history kept · a picture's generation answers for its file · agents through XENO MCP · the
 *   canvas reads it live · the person is told · two at once leave one
 *
 *   node src/server/tests/project-item-people.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import canvasRoutes from '../routes/canvasRoutes.js';
import projectItemPeopleRoutes from '../routes/projectItemPeopleRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as people from '../services/projectItemPeople.js';
import * as mcp from '../services/projectItemPeopleMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  delete process.env.PROJECT_ITEM_PEOPLE;
  const mk = async (name) => { const m = `${name}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`; return String((await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$3,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`, name])).rows[0].id); };
  const ids = { ada: await mk('Ada'), bob: await mk('Bob'), cyd: await mk('Cyd'), dan: await mk('Dan'), eve: await mk('Eve') };
  let actor = ids.ada;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/canvases', canvasRoutes); app.use('/api/projects', projectItemPeopleRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ada = as('ada'), bob = as('bob'), cyd = as('cyd'), eve = as('eve');
  const me = (who) => ({ id: ids[who], kind: 'human' });
  const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };
  try {
    const proj = (await ada('POST', '/chat/projects', { name: 'Launch', area: 'dev' })).j.project;
    const email = async (id) => (await pool.query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
    for (const [id, relation] of [[ids.bob, 'editor'], [ids.cyd, 'viewer']]) await ada('PUT', `/chat/projects/${proj.id}/access/user/by-email`, { email: await email(id), relation });
    const chat = String((await pool.query(`INSERT INTO chat_conversations (user_id, created_by_user_id, title, project_id) VALUES ($1,$1,'Kickoff',$2) RETURNING id`, [ids.ada, proj.id])).rows[0].id);
    const loose = String((await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title) VALUES ($1,$1,$1,'Elsewhere') RETURNING id`, [ids.ada])).rows[0].id);
    const mkFile = async (fileId = null) => String((await pool.query(`INSERT INTO user_files (user_id, owner_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, replaces_asset_id) VALUES ($1,$1,'b.txt','brief.txt','text','text/plain',5,'/tmp/x','platform-upload',$2) RETURNING id`, [ids.ada, fileId])).rows[0].id);
    const file = await mkFile(), v2 = await mkFile(file);   // v2 is a second version of the same file (Storage's lineage names it by file_id)
    const fileId = String((await pool.query('SELECT file_id FROM user_files WHERE id = $1', [v2])).rows[0].file_id);
    await pool.query('INSERT INTO chat_project_assets (project_id, asset_id) VALUES ($1,$2)', [proj.id, file]);
    const gen = String((await pool.query(`INSERT INTO media_generations (owner_user_id, actor_user_id, request_key, request, request_hash, quote, state, project_id, hold_id, gateway_key, retail_cost_micro)
      VALUES ($1,$1,$2,'{}','h','{}','running',$3,'hold',$4,0) RETURNING id`, [ids.ada, `k-${Date.now()}`, proj.id, `g-${crypto.randomUUID()}`])).rows[0].id);
    const pic = await mkFile();

    // off by default
    check((await people.peopleOn(pool, me('ada'), proj.id, [{ kind: 'chat', id: chat }])).enabled === false, 'off unless PROJECT_ITEM_PEOPLE=true: reads say so');
    check(await refused(() => people.setPerson(pool, me('bob'), { projectId: proj.id, kind: 'chat', itemId: chat, principalId: ids.cyd })) === 'not_enabled', 'and writes are refused');
    process.env.PROJECT_ITEM_PEOPLE = 'yes';
    check(await refused(() => people.setPerson(pool, me('bob'), { projectId: proj.id, kind: 'chat', itemId: chat, principalId: ids.cyd })) === 'not_enabled', 'anything but exactly "true" is off (fails closed)');
    process.env.PROJECT_ITEM_PEOPLE = 'true';

    // an editor sets it; the person is told
    const put = (who, kind, item, principalId) => as(who)('PUT', `/projects/${proj.id}/items/${kind}/${item}/people`, { principalId });
    const s1 = await put('bob', 'chat', chat, ids.cyd);
    check(s1.s === 200 && s1.j.people.length === 1 && s1.j.people[0].id === ids.cyd && s1.j.people[0].name === 'Cyd', 'a project editor puts someone on a chat in the project');
    check((await pool.query(`SELECT 1 FROM user_notifications WHERE user_id = $1 AND source = 'projects' AND kind = 'item_assigned'`, [ids.cyd])).rowCount === 1, 'and they are told');
    check((await put('cyd', 'chat', chat, ids.cyd)).j.code === 'not_allowed', 'a viewer cannot set it');
    check((await put('bob', 'chat', chat, ids.dan)).j.code === 'person_without_access', 'the person must already see the project');
    check((await put('bob', 'chat', loose, ids.cyd)).j.code === 'item_not_in_project', 'the item must be in the project');
    check((await eve('GET', `/projects/${proj.id}/items/chat/${chat}/people`)).s === 404 && (await put('eve', 'chat', chat, ids.eve)).s === 404, 'an outsider learns nothing about it');
    check((await cyd('GET', `/projects/${proj.id}/items/chat/${chat}/people`)).j.people[0].id === ids.cyd, 'a viewer reads it');

    // one live person, history kept
    const s2 = await put('bob', 'chat', chat, ids.ada);
    const read = (await bob('GET', `/projects/${proj.id}/items/chat/${chat}/people`)).j;
    check(s2.j.people.map((p) => p.id).join() === ids.ada && read.before.some((p) => p.id === ids.cyd && p.endedAt), 'setting someone else replaces them; who was on it stays in its history');
    check((await put('bob', 'chat', chat, ids.ada)).j.people.length === 1 && (await pool.query('SELECT count(*)::int AS n FROM project_item_people WHERE item_id = $1', [chat])).rows[0].n === 2, 'setting the same person again changes nothing');
    check((await put('bob', 'chat', chat, null)).j.people.length === 0, 'null clears it');

    // a file by any version; a picture's generation answers for its file
    const f1 = await put('bob', 'file', v2, ids.cyd);
    check(f1.s === 200 && f1.j.item.id === fileId, `a file is named by its stable id, whichever version was given (${JSON.stringify(f1.j).slice(0, 120)})`);
    check((await put('bob', 'generation', gen, ids.cyd)).j.people[0].id === ids.cyd, 'a picture still being made takes a person');
    await pool.query('INSERT INTO media_generation_outputs (generation_id, ordinal, asset_id) VALUES ($1,0,$2)', [gen, pic]);
    const viaGen = await people.peopleOn(pool, me('bob'), proj.id, [{ kind: 'file', id: pic }]);
    check(viaGen.people[`file:${pic}`]?.[0]?.id === ids.cyd, 'when it finishes, its file answers with the same person, with nothing carried');
    await put('bob', 'file', pic, ids.ada);
    const after = await people.peopleOn(pool, me('bob'), proj.id, [{ kind: 'file', id: pic }, { kind: 'generation', id: gen }]);
    check(after.people[`file:${pic}`].map((p) => p.id).join() === ids.ada && after.people[`generation:${gen}`].length === 0, 'setting the file takes over from its generation');

    // agents: XENO MCP through the same service
    const viaMcp = JSON.parse((await mcp.callTool(pool, me('bob'), 'set_item_person', { project: proj.id, kind: 'chat', item: chat, person: ids.cyd })).content[0].text);
    check(viaMcp.people[0].id === ids.cyd && JSON.parse((await mcp.callTool(pool, me('cyd'), 'item_people', { project: proj.id, kind: 'chat', item: chat })).content[0].text).people[0].id === ids.cyd, 'an agent sets and reads it through XENO MCP, the same rules');
    check(await refused(() => mcp.callTool(pool, me('cyd'), 'set_item_person', { project: proj.id, kind: 'chat', item: chat, person: ids.ada })) === 'not_allowed', 'and a viewer’s agent cannot set it');

    // the canvas reads it live, as a task's assignee
    const cv = (await bob('POST', '/canvases', { name: 'Map', projectId: proj.id, content: { nodes: [{ id: 'c1', type: 'xeno-ref', ref: { kind: 'chat', id: chat }, x: 0, y: 0, width: 300, height: 300 }, { id: 'm1', type: 'media', x: 400, y: 0, width: 300, height: 300, media: { kind: 'image', prompt: 'a door', versions: [pic], cur: 0 } }], edges: [] } })).j.canvas;
    check(cv.peopleLive === true && cv.records.people[`chat:${chat}`][0].id === ids.cyd && cv.records.people[`file:${pic}`][0].id === ids.ada, 'a canvas in the project shows who is on each chat and picture, read live');
    process.env.PROJECT_ITEM_PEOPLE = '';
    check((await bob('GET', `/canvases/${cv.id}`)).j.canvas.peopleLive === false, 'and with it off the canvas keeps the person on its node');
    process.env.PROJECT_ITEM_PEOPLE = 'true';

    // two people setting it at once leave exactly one
    // from nobody on it, so no row exists for a row lock to wait on: only the item's own lock keeps it to one
    let worst = 0;
    for (let round = 0; round < 8; round++) {
      await people.setPerson(pool, me('bob'), { projectId: proj.id, kind: 'chat', itemId: chat, principalId: null });
      await Promise.allSettled([ids.ada, ids.bob, ids.cyd, ids.ada, ids.bob, ids.cyd].map((p, i) => people.setPerson(pool, me(i % 2 ? 'ada' : 'bob'), { projectId: proj.id, kind: 'chat', itemId: chat, principalId: p })));
      worst = Math.max(worst, (await pool.query('SELECT count(*)::int AS n FROM project_item_people WHERE item_id = $1 AND ended_at IS NULL', [chat])).rows[0].n);
    }
    check(worst === 1, `several at once, round after round, always leave exactly one person on it (most seen: ${worst})`);
    console.log(`\n${passed} passed`);
  } finally { server.close(); await pool.end(); }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

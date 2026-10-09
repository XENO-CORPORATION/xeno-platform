/**
 * AREA for scheduled chats, one search, and the "needs you" feed, against a real Postgres and the REAL routers.
 *
 * Owner's rule: each area of the workspace has its own work; only Overview shows everything.
 *
 *   - a scheduled chat lives in the area it was set up in (named, or the request's own); inside a project it
 *     follows the project; it can be moved; the list filters by area
 *   - the conversation a scheduled run writes to is made in the task's area
 *   - a new conversation with no area named takes the request's own area
 *   - search finds chats by title and by what was said, projects and Library files; an area narrows it; LIKE
 *     wildcards in the person's text are literal; one person never finds another's
 *   - needs-you lists scheduled chats whose last run failed, per area, and only the caller's
 *
 *   node src/server/tests/workspace-area.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import workspaceAreaRoutes from '../routes/workspaceAreaRoutes.js';
import { areaFromRequest } from '../utils/resourceArea.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { ENSURE_SCHEDULED_CONVERSATION_SQL } from '../workers/chatScheduledWorker.js';
import { likePattern, snippetAround } from '../services/workspaceArea.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await runAllMigrations(pool);
  const person = async (name) => { const marker = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [marker, `${marker}@example.test`])).rows[0].id; };
  const ada = await person('wsa-ada'), bob = await person('wsa-bob');
  let actor = ada;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api', areaFromRequest);
  app.use('/api/chat', chatRoutes);
  app.use('/api/workspace', workspaceAreaRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, headers = {}) => { const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, json: await res.json().catch(() => ({})) }; };
  let passed = 0;
  const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

  try {
    // ── scheduled chats
    const sched = async (title, extra = {}, headers = {}) => { const r = await call('POST', '/chat/scheduled', { title, prompt: 'p', cadence: 'daily', ...extra }, headers); if (!r.json.task) throw new Error('schedule not made: ' + JSON.stringify(r.json)); return r.json.task; };
    const names = async (q = '') => (await call('GET', '/chat/scheduled?limit=100&sort=name' + q)).json.tasks.map((t) => `${t.title}@${t.area ?? '-'}`).join(' ');
    const sDev = await sched('s-dev', { area: 'dev' });
    const sHdr = await sched('s-hdr', {}, { 'x-xeno-area': 'studio' });
    const sNone = await sched('s-none');
    check(sDev.area === 'dev' && sHdr.area === 'studio' && sNone.area === null, 'a scheduled chat lives in the area named, else the area the request came from, else none');
    const proj = (await call('POST', '/chat/projects', { name: 'Office project', area: 'office' })).json.project;
    const sProj = await sched('s-proj', { project_id: proj.id, area: 'dev' });
    check(await names('&area=dev') === 's-dev@dev', 'one area lists only its own scheduled chats');
    check(await names('&area=office') === 's-proj@office', 'a scheduled chat in a project is listed in the project’s area, whatever area was named');
    check(await names('&area=none') === 's-none@-', '`none` lists the scheduled chats in no area');
    check(await names() === 's-dev@dev s-hdr@studio s-none@- s-proj@office', 'no filter lists every scheduled chat, each naming its area');
    check((await call('GET', '/chat/scheduled?area=Not%20Valid')).status === 400, 'a malformed area is refused on the list');
    check((await call('POST', '/chat/scheduled', { title: 'x', prompt: 'p', area: 'overview' })).status === 400, '`overview` is not an area a scheduled chat can live in');
    const moved = await call('PUT', `/chat/scheduled/${sDev.id}`, { area: 'tools' });
    check(moved.status === 200 && moved.json.task.area === 'tools' && await names('&area=dev') === '' && await names('&area=tools') === 's-dev@tools', 'a scheduled chat can be moved to another area');
    const renamed = await call('PUT', `/chat/scheduled/${sDev.id}`, { title: 's-dev2' });
    check(renamed.json.task.area === 'tools', 'an edit that names no area leaves the area alone');
    check((await call('PUT', `/chat/scheduled/${sProj.id}`, { area: 'dev' })).status === 409, 'a scheduled chat in a project cannot be placed on its own');
    const cleared = await call('PUT', `/chat/scheduled/${sDev.id}`, { area: null });
    check(cleared.json.task.area === null, 'a scheduled chat can be moved to no area');
    await call('PUT', `/chat/scheduled/${sDev.id}`, { area: 'tools', title: 's-dev' });

    // the conversation a run writes to
    const run = async (task) => (await pool.query(ENSURE_SCHEDULED_CONVERSATION_SQL, [ada, 'auto', 'm', task.project_id || null, task.area ?? null])).rows[0].id;
    const areaOfConv = async (id) => (await pool.query('SELECT area FROM chat_conversations WHERE id = $1', [id])).rows[0].area;
    check(await areaOfConv(await run({ area: 'tools' })) === 'tools', 'the conversation a scheduled run writes to is made in the task’s area');
    check(await areaOfConv(await run({ project_id: proj.id, area: 'dev' })) === null, 'in a project that conversation stores no area of its own (it reads the project’s)');

    // ── a new conversation takes the request's own area
    const viaHeader = (await call('POST', '/chat/conversations', { title: 'from-studio', model_id: 'm' }, { 'x-xeno-area': 'studio' })).json.conversation;
    const named = (await call('POST', '/chat/conversations', { title: 'named-dev', model_id: 'm', area: 'dev' }, { 'x-xeno-area': 'studio' })).json.conversation;
    const explicitNone = (await call('POST', '/chat/conversations', { title: 'named-none', model_id: 'm', area: null }, { 'x-xeno-area': 'studio' })).json.conversation;
    check(viaHeader.area === 'studio' && named.area === 'dev' && explicitNone.area === null, 'a new conversation with no area named takes the request’s own; a named one (or null) wins');

    // ── search
    const conv = async (title, area, said) => { const c = (await call('POST', '/chat/conversations', { title, model_id: 'm', ...(area ? { area } : {}) })).json.conversation;
      if (said) await pool.query(`INSERT INTO chat_messages(conversation_id, user_id, role, content, message_index) VALUES($1,$2,'user',$3,0)`, [c.id, actor, said]); return c; };
    await conv('Quarterly zebra plan', 'dev');
    await conv('Lunch', 'studio', 'We should repaint the zebra crossing before the launch, said the long message that goes on and on.');
    await conv('Nothing here', 'dev', 'unrelated words');
    await call('POST', '/chat/projects', { name: 'Zebra habitat', description: 'all about stripes', area: 'office' });
    const search = async (q, extra = '') => (await call('GET', `/workspace/search?q=${encodeURIComponent(q)}${extra}`)).json;
    const all = await search('zebra');
    const shape = (r) => r.results.map((x) => `${x.kind}:${x.title}@${x.area ?? '-'}`).sort().join(' | ');
    check(shape(all) === 'chat:Lunch@studio | chat:Quarterly zebra plan@dev | project:Zebra habitat@office', `search finds a chat by title, a chat by what was said in it, and a project (${shape(all)})`);
    const lunch = all.results.find((r) => r.title === 'Lunch');
    check(lunch.matched === 'message' && /zebra crossing/.test(lunch.snippet) && lunch.snippet.length < 200, 'a chat found by its messages says so and shows the words around the match');
    check(all.results.find((r) => r.title === 'Quarterly zebra plan').matched === 'title', 'a chat found by its title says so');
    check(shape(await search('zebra', '&area=dev')) === 'chat:Quarterly zebra plan@dev', 'an area narrows the search to that area');
    check(shape(await search('zebra', '&area=office')) === 'project:Zebra habitat@office', 'another area finds only its own');
    check(shape(await search('zebra', '&area=tools')) === '', 'an area with no match finds nothing, not everything');
    check((await search('z')).too_short === true && (await search('z')).results.length === 0, 'one character is not a search');
    check((await call('GET', '/workspace/search?q=zebra&area=Bad%20One')).status === 400, 'a malformed area is refused, not ignored');
    await conv('100% done', 'dev'); await conv('1000 done', 'dev');
    check(shape(await search('100%')) === 'chat:100% done@dev', 'a percent sign in the search is a percent sign, not a wildcard');
    check(likePattern('a_b%c\\d') === '%a\\_b\\%c\\\\d%' && snippetAround('x '.repeat(300) + 'needle' + ' y'.repeat(300), 'needle').includes('needle'), 'the pattern escapes LIKE’s special characters and the snippet keeps the match in view');
    actor = bob;
    check(shape(await search('zebra')) === '', 'one person’s search never finds another person’s work');
    actor = ada;

    // ── needs you
    await pool.query(`UPDATE chat_scheduled_tasks SET last_run_status = 'failed', last_run_error = 'The model was not available', last_run_at = NOW() WHERE id = ANY($1)`, [[sDev.id, sProj.id]]);
    await pool.query(`UPDATE chat_scheduled_tasks SET last_run_status = 'succeeded', last_run_at = NOW() WHERE id = $1`, [sHdr.id]);
    const needs = async (extra = '') => (await call('GET', '/workspace/needs' + extra)).json.items.map((i) => `${i.kind}:${i.title}@${i.area ?? '-'}`).sort().join(' | ');
    check(await needs() === 'schedule_failed:s-dev@tools | schedule_failed:s-proj@office', 'needs-you lists the scheduled chats whose last run failed, and not the ones that ran');
    check(await needs('?area=tools') === 'schedule_failed:s-dev@tools' && await needs('?area=studio') === '', 'needs-you narrows to an area');
    const one = (await call('GET', '/workspace/needs?area=tools')).json.items[0];
    check(one.id === sDev.id && one.detail === 'The model was not available', 'a failed scheduled chat says why it failed and which one it is');
    actor = bob;
    check(await needs() === '', 'one person’s needs-you never shows another person’s');
    actor = ada;

    console.log(`workspace-area: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[ada, bob]]).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

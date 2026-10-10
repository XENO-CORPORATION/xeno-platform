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
import { likePattern, snippetAround, PLATFORM_DEFAULT_MODEL } from '../services/workspaceArea.js';

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

    // the model, when none is named
    check(sNone.model_id === PLATFORM_DEFAULT_MODEL && !/gemini-2\.5-flash-preview/.test(sNone.model_id), 'with no model named and none set, a scheduled chat uses the platform’s current default');
    await pool.query(`INSERT INTO user_settings(user_id, settings, updated_at) VALUES($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings`, [ada, JSON.stringify({ models: { defaultModel: 'my-default' }, areas: { dev: { model: 'dev-own' }, office: { model: 'office-own' } } })]);
    const mDev = await sched('m-dev', { area: 'dev' }), mStudio = await sched('m-studio', { area: 'studio' }), mNamed = await sched('m-named', { area: 'dev', model_id: 'named-one' }), mProj = await sched('m-proj', { project_id: proj.id });
    check(mDev.model_id === 'dev-own' && mStudio.model_id === 'my-default' && mNamed.model_id === 'named-one', 'it uses the area’s model, else the person’s default; a named model wins');
    check(mProj.model_id === 'office-own', 'in a project it uses the model of the project’s area');
    for (const t of [mDev, mStudio, mNamed, mProj]) await pool.query('DELETE FROM chat_scheduled_tasks WHERE id = $1', [t.id]);

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

    // ── the week, per area
    const week0 = (await call('GET', '/workspace/summary')).json;
    const sum = (a, m) => (week0.areas[a] ? week0.areas[a][m].reduce((x, y) => x + y, 0) : 0);
    const mine = async (where) => Number((await pool.query(`SELECT count(*)::int AS n FROM chat_conversations c WHERE c.user_id = $1 AND c.deleted_at IS NULL AND ${where}`, [ada])).rows[0].n);
    check(week0.days === 7 && week0.areas.dev.chats.length === 7 && sum('dev', 'chats') === await mine("c.area = 'dev' AND c.project_id IS NULL") && sum('studio', 'chats') === await mine("c.area = 'studio' AND c.project_id IS NULL"), `the week counts the chats I started, per area (dev ${sum('dev', 'chats')}, studio ${sum('studio', 'chats')})`);
    check(week0.areas.dev.chats[6] === sum('dev', 'chats') && week0.areas.dev.chats[0] === 0, 'what happened in the last 24 hours is the last point of the series');
    check(sum('studio', 'messages') === 1 && sum('dev', 'messages') === 1, 'it counts the messages I sent, in the area of their conversation');
    const anyDev = (await pool.query("SELECT id FROM chat_conversations WHERE user_id = $1 AND area = 'dev' AND deleted_at IS NULL LIMIT 1", [ada])).rows[0].id;
    await pool.query("UPDATE chat_conversations SET created_at = (now() AT TIME ZONE 'UTC') - interval '2 days 3 hours' WHERE id = $1", [anyDev]);
    await pool.query("INSERT INTO chat_messages(conversation_id, user_id, role, content, message_index) VALUES($1,$2,'assistant','an answer',1)", [anyDev, ada]);
    const old = (await call('POST', '/chat/conversations', { title: 'long ago', model_id: 'm', area: 'dev' })).json.conversation;
    await pool.query("UPDATE chat_conversations SET created_at = (now() AT TIME ZONE 'UTC') - interval '9 days' WHERE id = $1", [old.id]);
    const week1 = (await call('GET', '/workspace/summary')).json;
    check(week1.areas.dev.chats[4] === 1 && week1.areas.dev.chats.reduce((x, y) => x + y, 0) === sum('dev', 'chats'), 'a chat from two days ago sits two days back; one from nine days ago is not in the week');
    check(week1.areas.dev.messages.reduce((x, y) => x + y, 0) === 1, 'an assistant’s answer is not a message I sent');
    const runTask = await sched('run-me', { area: 'tools' });
    await pool.query("INSERT INTO chat_scheduled_runs(task_id, occurrence_key, scheduled_for, status, completed_at) VALUES($1,'k1',now(),'succeeded',now()), ($1,'k2',now(),'failed',now())", [runTask.id]);
    const week2 = (await call('GET', '/workspace/summary')).json;
    check(week2.areas.tools && week2.areas.tools.runs[6] === 1, 'it counts scheduled runs that finished, not the ones that failed');
    actor = bob; const weekBob = (await call('GET', '/workspace/summary')).json; actor = ada;
    check(Object.keys(weekBob.areas).length === 0, 'one person’s week holds nothing of another person’s');
    await pool.query('DELETE FROM chat_scheduled_tasks WHERE id = $1', [runTask.id]); await call('DELETE', `/chat/conversations/${old.id}`);
    await pool.query("UPDATE chat_conversations SET created_at = (now() AT TIME ZONE 'UTC') WHERE id = $1", [anyDev]);

    // ── pins
    const pins = async (extra = '') => (await call('GET', '/workspace/pins' + extra)).json.items.map((i) => `${i.kind}:${i.title}@${i.area ?? '-'}`).join(' | ');
    const zplan = (await search('Quarterly zebra')).results[0], lunchC = (await search('Lunch')).results.find((r) => r.title === 'Lunch');
    check(await pins() === '', 'nothing is pinned to begin with');
    const p1 = await call('PUT', `/chat/conversations/${lunchC.id}/pin`), p2 = await call('PUT', `/chat/conversations/${zplan.id}/pin`);
    check(p1.status === 200 && p1.json.pinned === true && p2.json.pin_position === 1, 'a conversation can be pinned; pins keep the order they were made in');
    check((await call('PUT', `/chat/conversations/${lunchC.id}/pin`)).json.pin_position === 0, 'pinning it again changes nothing');
    await call('PUT', `/chat/projects/${proj.id}/pin`);
    check(await pins() === 'chat:Lunch@studio | chat:Quarterly zebra plan@dev | project:Office project@office', 'the pinned list holds pinned chats then pinned projects, each naming its area');
    check(await pins('?area=dev') === 'chat:Quarterly zebra plan@dev' && await pins('?area=tools') === '', 'an area lists only its own pins');
    check((await call('GET', '/workspace/pins?area=Bad%20One')).status === 400, 'a malformed area is refused on pins');
    actor = bob;
    check(await pins() === '' && (await call('PUT', `/chat/conversations/${lunchC.id}/pin`)).status >= 400, 'one person cannot pin, and never sees, another person’s conversation');
    check((await call('DELETE', `/chat/conversations/${lunchC.id}/pin`)).status === 200, 'clearing a pin that is not there is not an error');
    actor = ada;
    check(await pins('?area=studio') === 'chat:Lunch@studio', 'another person’s unpin leaves mine alone');
    const un = await call('DELETE', `/chat/conversations/${lunchC.id}/pin`);
    check(un.json.pinned === false && await pins('?area=studio') === '', 'unpinning removes it from the list');
    check((await call('PUT', '/chat/conversations/not-a-uuid/pin')).status >= 400 && (await call('PUT', '/chat/conversations/not-a-uuid/pin')).status < 500, 'a malformed id is refused, not a server error');
    await call('DELETE', `/chat/conversations/${zplan.id}`);
    check(await pins('?area=dev') === '', 'a deleted conversation leaves the pinned list');

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

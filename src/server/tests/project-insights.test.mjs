/**
 * A project at a glance — people, summary and activity (services/projectInsights.js), against a real Postgres.
 *
 * Asserts: members of any role see who is on the project (people and agents, roles), only admins see emails, and an
 * outsider is told the project does not exist; the summary counts tasks by status, overdue, unassigned, with agents,
 * and progress; the activity feed merges task changes, people joining and conversations, newest first, pages by a
 * time cursor without repeats, and never shows a conversation the caller cannot open.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/project-insights.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ids = { ada: await mk('pi-ada'), bob: await mk('pi-bob'), cyd: await mk('pi-cyd'), eve: await mk('pi-eve'), bot: await mk('pi-bot') };
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin) VALUES ($1, $2, 'other', 'xeno') ON CONFLICT DO NOTHING", [ids.bot, ids.ada]);
  let actor = ids.ada;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null) }; };
  const ada = as('ada'), bob = as('bob'), cyd = as('cyd'), eve = as('eve');
  try {
    const proj = (await ada('POST', '/chat/projects', { name: 'Launch', area: 'dev' })).j.project;
    for (const [who, rel] of [['bob', 'editor'], ['cyd', 'viewer'], ['bot', 'editor']]) await writeTuples(pool, { writes: [{ object: `project:${proj.id}`, relation: rel, subject: `user:${ids[who]}` }] });

    // people
    const pv = (await cyd('GET', `/chat/projects/${proj.id}/people`)).j;
    const byName = (n) => pv.people.find((p) => p.username === n);
    check(pv.people.length === 4 && byName('pi-ada').relation === 'owner' && byName('pi-bob').relation === 'editor' && byName('pi-cyd').relation === 'viewer' && byName('pi-cyd').me, 'a viewer sees everyone on the project with their role, and which one is them');
    check(byName('pi-bot').kind === 'agent' && byName('pi-bot').owner.name === 'pi-ada', 'agents are marked as agents, with their owner');
    check(pv.people.every((p) => !p.email) && pv.you.canManage === false && pv.you.relation === 'viewer', 'a viewer sees no emails and cannot manage');
    const pa = (await ada('GET', `/chat/projects/${proj.id}/people`)).j;
    check(pa.you.canManage === true && pa.people.find((p) => p.username === 'pi-bob').email === 'pi-bob@example.test' && !pa.people.find((p) => p.username === 'pi-bot').email, 'the owner sees people’s emails (never an agent’s) and can manage');
    check(pa.people.map((p) => p.username).join(',') === 'pi-ada,pi-bob,pi-cyd,pi-bot', 'people come first, by role (owner, editor, viewer), then agents');
    check((await eve('GET', `/chat/projects/${proj.id}/people`)).s === 404 && (await eve('GET', `/chat/projects/${proj.id}/summary`)).s === 404 && (await eve('GET', `/chat/projects/${proj.id}/activity`)).s === 404, 'an outsider is told the project does not exist, on all three');
    check((await ada('GET', '/chat/projects/not-a-uuid/summary')).s === 404, 'a malformed id is a 404, not a crash');

    // summary
    const mkTask = async (title, extra = {}) => (await ada('POST', '/tasks', { title, projectId: proj.id, ...extra })).j.task;
    const t1 = await mkTask('Write copy'), t2 = await mkTask('Ship it'), t3 = await mkTask('Late one', { dueAt: new Date(Date.now() - 86400000).toISOString() }), t4 = await mkTask('Bot job');
    for (const t of [t1, t2, t3, t4]) await ada('POST', `/tasks/${t.key}/transition`, { to: 'todo' });
    await ada('POST', `/tasks/${t1.key}/transition`, { to: 'in_progress' }); await ada('POST', `/tasks/${t1.key}/transition`, { to: 'done' });
    await ada('POST', `/tasks/${t2.key}/transition`, { to: 'in_progress' }); await ada('POST', `/tasks/${t2.key}/transition`, { to: 'in_review' });
    await ada('POST', `/tasks/${t4.key}/delegate`, { agentId: ids.bot });
    await ada('POST', `/tasks/${t3.key}/comments`, { body: 'Is this still needed?' });
    const s = (await bob('GET', `/chat/projects/${proj.id}/summary`)).j;
    check(s.tasks.total === 4 && s.tasks.done === 1 && s.tasks.in_review === 1 && s.tasks.open === 3 && s.tasks.progress === 25, `the summary counts tasks by status and progress (${JSON.stringify(s.tasks)})`);
    check(s.tasks.overdue === 1 && s.tasks.with_agents === 1 && s.tasks.done_week === 1, 'it counts overdue, with-agents and done this week');
    check(s.people === 3 && s.agents === 1 && s.lastActivityAt, 'it counts people and agents and knows the last activity');

    // activity
    const a = (await cyd('GET', `/chat/projects/${proj.id}/activity?limit=100`)).j;
    const kinds = a.items.map((i) => `${i.type}:${i.kind}`);
    check(kinds.includes('task:created') && kinds.includes('task:status') && kinds.includes('task:delegated') && kinds.includes('task:comment') && kinds.includes('member:joined'), 'the feed merges task changes, comments, hand-offs and people joining');
    check(a.items.every((x, i) => i === 0 || Date.parse(a.items[i - 1].at) >= Date.parse(x.at)), 'newest first');
    const cmt = a.items.find((i) => i.kind === 'comment');
    check(cmt.note === 'Is this still needed?' && cmt.task.key === t3.key && cmt.actor.name === 'pi-ada', 'an item names the task, the person and an excerpt');
    const joined = a.items.find((i) => i.type === 'member' && i.actor && i.actor.name === 'pi-bot');
    check(joined && joined.actor.kind === 'agent' && joined.relation === 'editor', 'joining shows who joined, as what');
    const p1 = (await cyd('GET', `/chat/projects/${proj.id}/activity?limit=5`)).j;
    const p2 = (await cyd('GET', `/chat/projects/${proj.id}/activity?limit=5&before=${encodeURIComponent(p1.next)}`)).j;
    check(p1.items.length === 5 && p1.next && p2.items.length > 0 && !p2.items.some((x) => p1.items.some((y) => y.id === x.id)), 'pages by a time cursor, without repeats');

    // conversations: shown only to those who can open them
    const conv = (await ada('POST', '/chat/conversations', { title: 'Kickoff notes' })).j;
    const convId = conv && (conv.conversation ? conv.conversation.id : conv.id);
    if (convId) {
      // file it under the project the way the app does: preview the move, then move with its consent revision
      const pre = (await ada('POST', `/chat/conversations/${convId}/move/preview`, { project_id: proj.id })).j;
      const mv = await ada('POST', `/chat/conversations/${convId}/move`, { project_id: proj.id, consent_revision: pre && pre.move ? (pre.move.consentRevision ?? pre.move.consent_revision) : undefined });
      check(mv.s === 200, `the conversation moves into the project through the app’s own route (${mv.s} ${mv.j && mv.j.code || ''})`);
      const ownFeed = (await ada('GET', `/chat/projects/${proj.id}/activity?limit=100`)).j.items;
      check(ownFeed.some((i) => i.type === 'conversation' && i.conversation.title === 'Kickoff notes'), 'a conversation in the project appears for someone who can open it');
      const canCyd = (await pool.query(`SELECT 1`)).rowCount && (await import('../utils/authzReBAC.js')).check;
      const cydSees = (await canCyd(pool, { object: `conversation:${convId}`, relation: 'viewer', subject: `user:${ids.cyd}` })).allowed;
      const cydFeed = (await cyd('GET', `/chat/projects/${proj.id}/activity?limit=100`)).j.items;
      check(cydFeed.some((i) => i.type === 'conversation') === cydSees, `and only for those who can (Cyd ${cydSees ? 'can' : 'cannot'} open it, and the feed agrees)`);
      await pool.query('UPDATE chat_conversations SET deleted_at = now() WHERE id = $1', [convId]);
      const afterDelete = (await ada('GET', `/chat/projects/${proj.id}/activity?limit=100`)).j.items;
      const s2 = (await ada('GET', `/chat/projects/${proj.id}/summary`)).j;
      check(!afterDelete.some((i) => i.type === 'conversation') && s2.conversations === 0, 'a deleted conversation leaves the feed and the count');
    } else check(false, 'could not create a conversation to test visibility');
  } finally { server.close(); }
  console.log(failed ? `project-insights: ${failed} failed, ${passed} passed` : `project-insights: ${passed} checks passed`);
  await pool.end(); process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });

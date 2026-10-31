/**
 * The inbox (services/inbox.js + inboxMcp.js + routes/userNotificationsRoutes.js) on real Postgres.
 *
 *   - one door: never yourself, never a suspended person or a service account; a dedupe key writes one row
 *   - read, archived and snoozed are the person's: another person's ids change nothing
 *   - a snoozed row is out of the inbox and the count, and comes back unread when its time passes, with no sweep
 *   - a time in the past or far future is refused
 *   - an agent's tools reach its own inbox and never its owner's
 *   - per-area levels and the digest are stored; the digest is off without its switch, goes once per period, skips areas
 *     turned off, and sends nothing when nothing is unread
 *   - the Forum's event reaches the inbox, and reading it in the Forum reads it here
 *   - a share with a person tells them; changing its role does not tell them again
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/inbox.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as I from '../services/inbox.js';
import * as Mcp from '../services/inboxMcp.js';
import * as forum from '../services/forumNotify.js';
import { shareWithPerson } from '../services/storageShares.js';
import routes from '../routes/userNotificationsRoutes.js';
import { mutateWorkspaceMembership } from '../services/workspaceMembershipOperations.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ibx${process.pid}`; let seq = 0, passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s, extra = {}) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, role) VALUES ($1,$2,$3,true,$4,'x',$5) RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s, extra.active !== false, extra.role || 'user'])).rows[0].id;
const row = (userId, over = {}) => I.notify(pool, { userId, source: 'tasks', kind: 'assigned', ref: `T-${seq += 1}`, title: `Row ${seq}`, ...over });
const ids = (r) => r.items.map((x) => x.id);

async function main() {
  await runAllMigrations(pool);
  const me = await user('me'), other = await user('other'), gone = await user('gone', { active: false }), svc = await user('svc', { role: 'service' }), bot = await user('bot');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [bot, me]);

  // one door
  ok(await I.notify(pool, { userId: me, source: 'tasks', kind: 'status', ref: 'T-1', title: 'x', actorId: me }) === null, 'you are never told what you did yourself');
  ok(await row(gone) === null, 'a suspended person gets no row');
  ok(await row(svc) === null, 'a service account gets no row');
  const d1 = await row(me, { dedupeKey: 'k1' }), d2 = await row(me, { dedupeKey: 'k1' });
  ok(d1 && d2 === null, 'one dedupe key writes one row');
  ok((await pool.query('SELECT count(*)::int AS n FROM user_notifications WHERE user_id = $1', [me])).rows[0].n === 1, 'and the table agrees');
  const long = await row(me, { title: 'x'.repeat(900), detail: 'y'.repeat(2000) });
  ok(long, 'an over-long title and detail are cut, not refused: a notification must never fail the work it reports');

  // state belongs to the person
  const a = await row(me), b = await row(me), c = await row(me), theirs = await row(other);
  let l = await I.listNotifications(pool, me);
  ok(l.unread === 5 && ids(l).includes(a), 'the inbox lists rows with the unread count');
  await I.markNotificationsRead(pool, other, [a]); await I.archiveNotifications(pool, other, [a]); await I.snoozeNotifications(pool, other, [a], new Date(Date.now() + 3600000).toISOString());
  l = await I.listNotifications(pool, me);
  ok(l.unread === 5 && l.items.find((x) => x.id === a).read === false && ids(l).includes(a), 'another person’s calls change nothing of mine');

  await I.markNotificationsRead(pool, me, [a]);
  ok((await I.listNotifications(pool, me)).items.find((x) => x.id === a).read === true, 'read');
  await I.markNotificationsRead(pool, me, [a], { read: false });
  ok((await I.listNotifications(pool, me)).items.find((x) => x.id === a).read === false, 'and unread again');

  await I.archiveNotifications(pool, me, [a]);
  l = await I.listNotifications(pool, me);
  ok(!ids(l).includes(a) && l.unread === 4, 'archiving leaves the inbox and the count');
  const arch = await I.listNotifications(pool, me, { view: 'archive' });
  ok(ids(arch).includes(a) && arch.items[0].archived === true && arch.items[0].read === true, 'the archive holds it, read');
  await I.archiveNotifications(pool, me, [a], { archived: false });
  ok(ids(await I.listNotifications(pool, me)).includes(a), 'and it can come back');

  // snooze: waking is derived from the time
  await I.markNotificationsRead(pool, me, [b]);
  await I.snoozeNotifications(pool, me, [b], new Date(Date.now() + 3600000).toISOString());
  l = await I.listNotifications(pool, me);
  ok(!ids(l).includes(b), 'a snoozed row leaves the inbox');
  ok(ids(await I.listNotifications(pool, me, { view: 'snoozed' })).includes(b), 'and is in Snoozed');
  ok((await I.listNotifications(pool, me, { view: 'all' })).items.find((x) => x.id === b).snoozedUntil, 'and the full list says until when');
  const unreadAsleep = l.unread;
  await I.markNotificationsRead(pool, me, 'all');
  await pool.query(`UPDATE user_notifications SET snoozed_until = now() - interval '1 minute' WHERE id = $1`, [b]);
  l = await I.listNotifications(pool, me);
  ok(ids(l).includes(b) && l.items.find((x) => x.id === b).read === false && l.unread === 1, `its time passed: it is back, unread, though it was read before and "all" was marked read while it slept (${unreadAsleep})`);
  ok(l.items.find((x) => x.id === b).snoozedUntil === null, 'and no longer says it is asleep');
  await assert.rejects(I.snoozeNotifications(pool, me, [c], new Date(Date.now() - 1000).toISOString()), (e) => e.code === 'invalid_until'); passed += 1;
  await assert.rejects(I.snoozeNotifications(pool, me, [c], new Date(Date.now() + 400 * 86400000).toISOString()), (e) => e.code === 'invalid_until'); passed += 1;
  await assert.rejects(I.snoozeNotifications(pool, me, [c], 'tomorrow'), (e) => e.code === 'invalid_until'); passed += 1;
  await assert.rejects(I.listNotifications(pool, me, { view: 'nope' }), (e) => e.code === 'invalid_view'); passed += 1;
  console.log('  ok  a past, far or unreadable time and an unknown view are refused');
  await I.snoozeNotifications(pool, me, [c], new Date(Date.now() + 3600000).toISOString()); await I.snoozeNotifications(pool, me, [c], null);
  ok(ids(await I.listNotifications(pool, me)).includes(c), 'until: null wakes it now');

  // an agent reaches its own inbox, never its owner's
  const forBot = await row(bot, { kind: 'mentioned', title: 'For the agent' });
  const seen = (await Mcp.callTool(pool, { id: bot, kind: 'agent' }, 'list_notifications', {})).structuredContent;
  ok(ids(seen).length === 1 && ids(seen)[0] === forBot && seen.items[0].asks === true, 'an agent lists its own inbox');
  await Mcp.callTool(pool, { id: bot, kind: 'agent' }, 'archive', { ids: [c] });
  ok(ids(await I.listNotifications(pool, me)).includes(c), 'its tools change nothing of its owner’s, given the owner’s ids');
  await Mcp.callTool(pool, { id: bot, kind: 'agent' }, 'mark_read', { ids: [forBot] });
  ok((await I.listNotifications(pool, bot)).unread === 0, 'it can tidy its own');
  await assert.rejects(Mcp.callTool(pool, { id: bot, kind: 'agent' }, 'snooze', { ids: [forBot], until: 'never' }), (e) => e instanceof Mcp.InboxMcpError && e.code === 'invalid_until'); passed += 1;
  console.log('  ok  a refusal reaches the agent as a tool error');

  // preferences
  let p = await I.getPrefs(pool, me);
  ok(p.digest === 'off' && Object.keys(p.levels).length === 0, 'the digest is off until someone chooses it');
  await pool.query(`INSERT INTO user_settings (user_id, settings) VALUES ($1, '{"theme":"dark"}') ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings`, [me]);
  await I.setPrefs(pool, me, { digest: 'daily', levels: { dev: 'off', corpo: 'needs' } });
  p = await I.getPrefs(pool, me);
  ok(p.digest === 'daily' && p.levels.dev === 'off', 'levels and the digest are stored');
  ok((await pool.query(`SELECT settings->>'theme' AS t FROM user_settings WHERE user_id = $1`, [me])).rows[0].t === 'dark', 'and the person’s other settings are left alone');
  await assert.rejects(I.setPrefs(pool, me, { digest: 'hourly' }), (e) => e.code === 'invalid_digest'); passed += 1;
  await assert.rejects(I.setPrefs(pool, me, { levels: { dev: 'loud' } }), (e) => e.code === 'invalid_levels'); passed += 1;
  console.log('  ok  an unknown digest or level is refused');

  // the digest
  const mails = [], send = async (db, tpl, to, data) => { mails.push({ tpl, to, data }); };
  const on = { INBOX_DIGEST_EMAILS: 'true' }, now = Date.now();
  await I.markNotificationsRead(pool, me, 'all');
  await row(me, { title: 'Digest me', area: 'corpo' }); await row(me, { title: 'Muted area', area: 'dev' });
  ok((await I.sendDigests(pool, { env: {}, send, now })).enabled === false && mails.length === 0, 'no digest without its switch');
  ok((await I.sendDigests(pool, { env: { INBOX_DIGEST_EMAILS: '1' }, send, now })).enabled === false, 'the switch means exactly "true"');
  await I.sendDigests(pool, { env: on, send, now });
  const mine = mails.filter((m) => m.to === `${tag}me@example.test`);
  ok(mine.length === 1 && mine[0].tpl === 'inbox_digest' && mine[0].data.items.includes('Digest me'), 'one digest goes to who chose it');
  ok(!mine[0].data.items.includes('Muted area'), 'without the areas they turned off');
  await I.sendDigests(pool, { env: on, send, now: now + 3600000 });
  ok(mails.filter((m) => m.to === `${tag}me@example.test`).length === 1, 'not again within the period');
  await I.markNotificationsRead(pool, me, 'all');
  await I.sendDigests(pool, { env: on, send, now: now + 2 * 86400000 });
  ok(mails.filter((m) => m.to === `${tag}me@example.test`).length === 1, 'and not when nothing is unread');
  // two workers at once send one
  const racer = await user('racer'); await I.setPrefs(pool, racer, { digest: 'daily' }); await row(racer, { title: 'Race' });
  await Promise.all([I.sendDigests(pool, { env: on, send, now: now + 3 * 86400000 }), I.sendDigests(pool, { env: on, send, now: now + 3 * 86400000 })]);
  ok(mails.filter((m) => m.to === `${tag}racer@example.test`).length === 1, 'two workers at once send one digest');
  await I.setPrefs(pool, me, { digest: 'off' });
  ok((await pool.query(`SELECT settings->'inbox'->>'digestSentAt' AS s FROM user_settings WHERE user_id = $1`, [me])).rows[0].s, 'changing preferences keeps when the last one went');

  // the Forum's event
  const space = (await pool.query(`INSERT INTO forum_spaces (slug, name, kind) VALUES ($1,'S','qa') RETURNING id`, [`${tag}s`])).rows[0].id;
  const t = (await pool.query(`INSERT INTO forum_threads (space_id, author_id, title, slug, short_id) VALUES ($1,$2,'Forum thread','forum-thread',$3) RETURNING id, short_id`, [space, me, `ib${String(process.pid).slice(-6)}`])).rows[0];
  const fid = await forum.notify(pool, { userId: me, kind: 'reply', threadId: t.id, actor: { id: other, kind: 'human' } });
  const n = (await I.listNotifications(pool, me)).items.find((x) => x.source === 'forum');
  ok(fid && n && n.ref === `/workspace/community/${t.short_id}` && n.title === 'Forum thread' && n.actor.name === 'other', 'a Forum reply reaches the inbox, with its address');
  await forum.markRead(pool, me, [fid]);
  ok((await I.listNotifications(pool, me)).items.find((x) => x.id === n.id).read === true, 'reading it in the Forum reads it here');

  // a share
  const folder = (await pool.query(`INSERT INTO storage_folders (owner_user_id, name) VALUES ($1,'Designs') RETURNING id`, [other])).rows[0].id;
  const shared = await shareWithPerson(pool, other, { folderId: folder }, `${tag}me`, 'viewer');
  ok(shared.ok, 'a folder is shared with a person');
  const told = (await I.listNotifications(pool, me)).items.filter((x) => x.source === 'storage');
  ok(told.length === 1 && /other shared Designs with you/.test(told[0].title), 'they are told who shared what');
  await shareWithPerson(pool, other, { folderId: folder }, `${tag}me`, 'editor');
  ok((await I.listNotifications(pool, me)).items.filter((x) => x.source === 'storage').length === 1, 'changing its role does not tell them again');

  // an invitation
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug, metadata) VALUES ($1,'team','Invite Co',$2,'{"billing":{"plan":"team","status":"active","seat_limit":5}}') RETURNING id`, [other, `${tag}-inv`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${other}`, relation: 'owner' }] });
  const inv = await mutateWorkspaceMembership(pool, ws, other, null, null, 'invite.create', { email: `${tag}me@example.test`, role: 'member' }, { legacy: true });
  const invited = () => pool.query(`SELECT title, ref FROM user_notifications WHERE user_id = $1 AND source = 'workspace'`, [me]).then((r) => r.rows);
  const seenInv = await invited();
  ok(seenInv.length === 1 && /Invite Co/.test(seenInv[0].title) && seenInv[0].ref.startsWith('/invite/'), 'someone with an account is told they were invited, with the link to answer');
  await mutateWorkspaceMembership(pool, ws, other, null, null, 'invite.revoke', { inviteId: inv.result.invite.id }, { legacy: true });
  ok((await invited()).length === 0, 'and a revoked invitation leaves their inbox');

  // the routes
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: me }; next(); }); app.use('/api/notifications', routes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/notifications`;
  const call = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
  try {
    const fresh = await row(me);
    let r = await call('GET', '?view=all&limit=200');
    ok(r.status === 200 && r.j.items.some((x) => x.id === fresh && x.label === 'Assigned' && x.asks === true), 'GET lists a row with its label and what it asks');
    r = await call('POST', '/archive', { ids: [fresh] });
    ok(r.status === 200 && (await call('GET', '?view=archive')).j.items.some((x) => x.id === fresh), 'POST /archive');
    r = await call('POST', '/snooze', { ids: [fresh], until: 'nope' });
    ok(r.status === 400 && r.j.code === 'invalid_until', 'POST /snooze refuses a bad time with 400');
    r = await call('GET', '?view=nope');
    ok(r.status === 400, 'GET refuses an unknown view');
    r = await call('PUT', '/prefs', { digest: 'weekly' });
    ok(r.status === 200 && r.j.prefs.digest === 'weekly' && (await call('GET', '/prefs')).j.prefs.digest === 'weekly', 'PUT and GET /prefs');
  } finally { server.close(); }
  console.log(`\n${passed} checks passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

/**
 * XENO Places — sessions, invites, explore, receipts, needs (the Xenopolis handoff port, phase 1), on real Postgres:
 *   - sessions.resolve: a code (bare, PLC-prefixed or inside a link) shows the session BEFORE joining — only the floors the
 *     host opened, by name, and never the code to anyone but the host; unknown and ended codes are not_found;
 *   - sessions.list: the host, an invitee and a joined guest see it; an outsider does not see a code session;
 *   - places.explore: public buildings with visitor access (watch only); a private one is absent;
 *   - invites.list / invites.respond go THROUGH the one invite-decision service: accept writes the workspace tuple and
 *     answers the building, a retry replays the receipt, a second answer is a conflict, a pinned invite is invisible to others;
 *   - receipts.list returns the actor's own receipts; needs.list is the needs-you feed; every refusal is in the vocabulary.
 *
 * Run: DATABASE_URL=postgresql://… node tests/places-sessions.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as places from '../services/places.js';
import * as placesMcp from '../services/placesMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ps${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, name, kind = 'human') => ({ id, name, kind });
const workspace = async (owner, name, type = 'team') => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [owner, type, name, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const placeOf = async (w) => (await pool.query(`SELECT * FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows[0];
const CODES = new Set(places.CODES);
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected a refusal (${reason}), got ${JSON.stringify(r.result)}`); assert.ok(CODES.has(r.error.code)); assert.equal(r.error.code, code); assert.equal(r.error.reason, reason); };
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.error)); return r.result; };

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), invitee = await user('invitee'), guest = await user('guest'), outsider = await user('outsider'), other = await user('other');
  const co = await workspace(owner, 'Co');
  const div = async (key) => (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, [co, key, key.toUpperCase(), owner])).rows[0].id;
  const dDev = await div('dev'), dSecret = await div('secret');
  await pool.query(`UPDATE workspaces SET metadata = jsonb_build_object('billing', jsonb_build_object('plan','team','status','active','seat_limit',10)) WHERE id=$1`, [co]);
  const pCo = await placeOf(co);
  const O = me(owner, 'Owner');

  // ── host with one floor open; resolve before joining ──
  const hosted = ok(await places.call(pool, O, 'sessions.host', { placeId: pCo.id, floors: [dDev], permissions: ['watch', 'talk'], audience: 'code', title: 'Standup', requestId: rid() }));
  assert.deepEqual(hosted.session.floors, ['DEV'], 'the host’s own view names the opened floor');
  assert.equal(hosted.session.code, hosted.code, 'the host sees the code');
  const forGuest = ok(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: hosted.code })).session;
  assert.deepEqual([forGuest.placeId, forGuest.host, forGuest.title, forGuest.floors, forGuest.permissions, forGuest.code, forGuest.joined],
    [pCo.id, 'owner', 'Standup', ['DEV'], ['watch', 'talk'], null, false], 'resolve shows only the opened floor, and never the code to a non-host');
  assert.ok(!JSON.stringify(forGuest).includes('SECRET'), 'a floor the host did not open is not even named');
  assert.equal(ok(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: `PLC-${hosted.code.toLowerCase()}` })).session.id, forGuest.id, 'a PLC- prefix and lower case resolve');
  assert.equal(ok(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: `https://places.xenosystem.ai/?session=${hosted.code}` })).session.id, forGuest.id, 'a link resolves');
  refused(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: 'ZZZZ-ZZZZ' }), 'not_found', 'code_unknown');
  refused(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: 'nope' }), 'bad_input', 'code_invalid');

  // ── list: host + joined guest see it; an outsider does not ──
  assert.ok(!ok(await places.call(pool, me(guest, 'Guest'), 'sessions.list', {})).items.some((s) => s.id === forGuest.id), 'a code session is not listed before joining');
  ok(await places.call(pool, me(guest, 'Guest'), 'sessions.join', { code: `PLC-${hosted.code}`, requestId: rid() }));
  const gl = ok(await places.call(pool, me(guest, 'Guest'), 'sessions.list', {})).items.find((s) => s.id === forGuest.id);
  assert.ok(gl && gl.joined && gl.guests === 1 && gl.code === null, 'the joined guest sees it, without the code');
  assert.ok(ok(await places.call(pool, O, 'sessions.list', {})).items.find((s) => s.id === forGuest.id).code, 'the host’s list carries the code');
  assert.ok(!ok(await places.call(pool, me(outsider, 'O'), 'sessions.list', {})).items.some((s) => s.id === forGuest.id));
  const gv = ok(await places.call(pool, me(guest, 'Guest'), 'places.get', { placeId: pCo.id }));
  assert.deepEqual([gv.access.role, gv.spec.snap.closedDivisionIds], ['guest', [dSecret]], 'the pass narrows: the other floor stays closed');

  // ── explore: public only, visitor = watch ──
  assert.ok(!ok(await places.call(pool, me(outsider, 'O'), 'places.explore', {})).items.some((p) => p.id === pCo.id), 'a private building is not on explore');
  await pool.query(`UPDATE places SET visibility='public' WHERE id=$1`, [pCo.id]);
  const ex = ok(await places.call(pool, me(outsider, 'O'), 'places.explore', {})).items.find((p) => p.id === pCo.id);
  assert.deepEqual([ex.access.role, ex.access.permissions], ['visitor', ['watch']], 'a visitor may only watch');
  await pool.query(`UPDATE places SET visibility='private' WHERE id=$1`, [pCo.id]);

  // ── receipts: my own, newest first ──
  const rc = ok(await places.call(pool, O, 'receipts.list', {})).items;
  assert.equal(rc[0].op, 'sessions.host', 'the host’s receipt is listed');
  assert.ok(!ok(await places.call(pool, me(outsider, 'O'), 'receipts.list', {})).items.length, 'nobody else’s receipts');

  // ── invites through the one decision service ──
  const invite = async (email, pinned = null) => (await pool.query(`INSERT INTO workspace_invites (workspace_id, invited_by_user_id, invited_user_id, invited_email, role, token, expires_at)
    VALUES ($1,$2,$3,$4,'editor',$5, now() + interval '7 days') RETURNING id`, [co, owner, pinned, email, `${tag}-tok-${seq += 1}`])).rows[0].id;
  const inv = await invite(`${tag}_invitee@xeno.test`);
  const pinnedToOther = await invite(`${tag}_invitee+x@xeno.test`, other);
  const mine = ok(await places.call(pool, me(invitee, 'Invitee'), 'invites.list', {})).items;
  assert.deepEqual(mine.map((x) => [x.id, x.workspaceName, x.from, x.role]), [[inv, 'Co', 'owner', 'member']], 'my pending invite, and not one pinned to someone else');
  assert.ok(!ok(await places.call(pool, me(outsider, 'O'), 'invites.list', {})).items.length);
  refused(await places.call(pool, me(outsider, 'O'), 'invites.respond', { inviteId: inv, accept: true, requestId: rid() }), 'not_found', 'invite_not_found');
  refused(await places.call(pool, me(invitee, 'I'), 'invites.respond', { inviteId: inv, requestId: rid() }), 'bad_input', 'accept_required');
  refused(await places.call(pool, me(invitee, 'I', 'agent'), 'invites.respond', { inviteId: inv, accept: true, requestId: rid() }), 'denied', 'agents_do_not_join');
  const key = rid();
  const acc = await places.call(pool, me(invitee, 'Invitee'), 'invites.respond', { inviteId: inv, accept: true, requestId: key });
  assert.deepEqual([ok(acc).state, acc.result.placeId], ['accepted', pCo.id], 'accepting answers the building to walk into');
  assert.equal((await pool.query(`SELECT relation FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2`, [co, invitee])).rows[0]?.relation, 'editor', 'the membership is the workspace tuple — Places adds no record');
  const again = await places.call(pool, me(invitee, 'Invitee'), 'invites.respond', { inviteId: inv, accept: true, requestId: key });
  assert.ok(again.ok && again.receipt.replayed && again.receipt.operationId === acc.receipt.operationId, 'a retry answers the original receipt');
  refused(await places.call(pool, me(invitee, 'Invitee'), 'invites.respond', { inviteId: inv, accept: false, requestId: rid() }), 'conflict', 'invite_not_pending');
  assert.ok(ok(await places.call(pool, me(invitee, 'Invitee'), 'places.list', {})).items.some((p) => p.id === pCo.id), 'the building is now in Your places');
  const declined = ok(await places.call(pool, me(other, 'Other'), 'invites.respond', { inviteId: pinnedToOther, accept: false, requestId: rid() }));
  assert.deepEqual([declined.state, declined.placeId], ['declined', null]);

  // ── owner rule 2026-10-21: the building is the workspace — an EMPTY division is a named floor, and it appears live ──
  const live = await import('../services/placesLive.js');
  const f0 = await live.frame(pool, O, pCo.id); assert.ok(f0.ok, JSON.stringify(f0.error));
  const dEmpty = await div('ops');
  const view = ok(await places.call(pool, O, 'places.get', { placeId: pCo.id }));
  assert.ok(view.spec.snap.divisions.some((d) => d.id === dEmpty && d.name === 'OPS'), 'a new empty division is a named floor');
  assert.ok(view.place.floors.some((fl) => fl.name === 'OPS' && fl.desks === 0), 'shown as an empty floor');
  const f1 = await live.frame(pool, O, pCo.id);
  assert.ok(live.diffFrames(f0.result, f1.result).length > 0 && JSON.stringify(f1.result).includes(dEmpty), 'the live stream carries the new floor without a reload');

  // ── needs + MCP parity ──
  assert.ok(Array.isArray(ok(await places.call(pool, O, 'needs.list', {})).items));
  const m = await placesMcp.callTool(pool, { id: guest, kind: 'human', name: 'Guest' }, 'resolve_session', { code: hosted.code });
  assert.equal(m.structuredContent.session.code, null, 'the MCP tool is the same scoped code path');
  assert.ok((await placesMcp.callTool(pool, { id: owner, kind: 'human', name: 'Owner' }, 'sessions', {})).structuredContent.items.length);

  // ── ending: resolve says ended / unknown, the guest loses the pass ──
  ok(await places.call(pool, O, 'sessions.end', { sessionId: forGuest.id, requestId: rid() }));
  refused(await places.call(pool, me(guest, 'Guest'), 'sessions.resolve', { code: hosted.code }), 'not_found', 'code_unknown');
  refused(await places.call(pool, me(guest, 'Guest'), 'places.get', { placeId: pCo.id }), 'denied', 'no_access');
  console.log('places sessions/invites/explore/receipts: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });

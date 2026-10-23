/**
 * XENO Message = XENO Comms, server-to-server (services/xenoComms.js + messageMcp.js), on real Postgres against a FAKE
 * Comms that behaves like the real one where it matters: it verifies EVERY bearer by calling the platform's real
 * GET /api/comms/identity (routes/commsIdentityRoutes.js) over HTTP — exactly as Comms' platform auth mode does — and
 * it computes the scoped-member digest with its own copy of server/api/src/http.rs `scoped_member_digest`.
 * Nothing reaches a real network.
 *
 *   - fails closed without XENO_COMMS_API_URL; the identity endpoint spends each assertion once and refuses
 *     another audience;
 *   - identity: a person registers as human, an agent as kind=agent owned by its person (owner first);
 *   - SCOPING (§8.11): a stranger, a member outside a team, and a scope from another workspace are refused BEFORE
 *     Comms is called; a channel's Comms membership is exactly the scope's audience, and a person removed from a team
 *     is removed from its channel on the next open — even their own Comms client loses it;
 *   - threads (replyTo), direct messages only between co-members, @agent hand-off = the chat's own task hand-off;
 *   - MCP: an agent lists, reads and posts in channels it belongs to and nowhere else.
 *
 * Run: DATABASE_URL=postgresql://… node tests/message-xeno-comms.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { activate } from '../services/accountActivation.js';
import * as agents from '../services/platformAgents.js';
import commsIdentityRoutes from '../routes/commsIdentityRoutes.js';
import * as M from '../services/xenoComms.js';
import * as Mcp from '../services/messageMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
delete process.env.AGENTS_API_BASE_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ms${process.pid}`;
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed += 1; console.log(`  ok  ${label}`); };
const refuses = async (p, code, label) => { await assert.rejects(p, (e) => { assert.ok(e instanceof M.MessageError || e instanceof Mcp.MessageMcpError, String(e)); assert.equal(e.code, code, `${label}: ${e.message}`); return true; }); passed += 1; console.log(`  ok  ${label}`); };

// ── the platform's identity endpoint, served for real
const idApp = express();
idApp.use((req, _res, next) => { req.db = pool; next(); });
idApp.use('/api/comms', commsIdentityRoutes);
const idServer = http.createServer(idApp);
let identityUrl;

// ── the fake Comms
const C = { users: new Map(), bySubject: new Map(), devices: new Map(), convs: new Map(), msgs: [], seen: [] };
const uuid = () => crypto.randomUUID();
const digest = (members) => crypto.createHash('sha256').update(members.map((m) => `${m.subject}\t${m.kind}\t${m.ownerSubject || ''}\t${m.displayName}\t${m.handle || ''}`).sort().join('\n')).digest('hex');
async function verify(req) {
  const r = await fetch(identityUrl, { headers: { authorization: req.headers.authorization || '' } });
  return r.ok ? r.json() : null;
}
const ensureUser = (subject, kind, owner, name) => {
  let id = C.bySubject.get(subject);
  if (id) return id;
  if (kind === 'agent' && !C.bySubject.get(owner)) throw Object.assign(new Error("the agent's owner has not joined XENO Comms yet"), { status: 400 });
  id = uuid(); C.users.set(id, { id, subject, kind, owner: kind === 'agent' ? C.bySubject.get(owner) : null, name }); C.bySubject.set(subject, id); return id;
};
const fake = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  const body = raw ? JSON.parse(raw) : null;
  const ident = await verify(req);
  C.seen.push({ method: req.method, url: req.url, ident, body });
  if (!ident || !ident.success) return send(401, { error: 'unauthorized' });
  const u = ident.user;
  try {
    if (req.url === '/v1/devices/register' && req.method === 'POST') {
      const uid = ensureUser(u.id, u.kind, u.ownerId, u.displayName);
      const dev = uuid(); C.devices.set(dev, uid);
      return send(200, { user: { id: uid, kind: u.kind }, device: { id: dev, userId: uid } });
    }
    const me = C.bySubject.get(u.id);
    if (!me || C.devices.get(req.headers['x-xeno-device-id']) !== me) return send(401, { error: 'unauthorized' });
    const active = (cv) => cv.members.has(me);
    if (req.url === '/v1/conversations' && req.method === 'GET') return send(200, [...C.convs.values()].filter(active).map((cv) => ({ id: cv.id, kind: cv.kind, title: cv.title, lastMessageId: cv.last || null, lastMessageAt: cv.lastAt || null, lastReadMessageId: null })));
    if (req.url === '/v1/platform/scoped-conversations' && req.method === 'POST') {
      const s = ident.scope;
      if (!s) return send(403, { error: 'forbidden' });
      if (digest(body.members) !== s.membersSha256) return send(403, { error: 'forbidden' });
      if (!body.members.some((m) => m.subject === u.id)) return send(403, { error: 'forbidden' });
      const ordered = [...body.members].sort((a, b) => (a.kind === 'human' ? 0 : 1) - (b.kind === 'human' ? 0 : 1));
      const ids = ordered.map((m) => ensureUser(m.subject, m.kind, m.ownerSubject, m.displayName));
      const k = `${s.workspaceId}|${s.key}`;
      let cv = [...C.convs.values()].find((x) => x.scope === k);
      if (!cv) { cv = { id: uuid(), kind: 'channel', scope: k, title: s.title, members: new Set() }; C.convs.set(cv.id, cv); }
      cv.title = s.title; const before = cv.members.size; cv.members = new Set(ids);
      return send(200, { conversation: { id: cv.id, kind: 'channel', title: cv.title }, scopeKey: s.key, memberCount: ids.length, removedCount: Math.max(0, before - ids.length), members: ordered.map((m, i) => ({ subject: m.subject, userId: ids[i] })) });
    }
    if (req.url === '/v1/conversations/dm' && req.method === 'POST') {
      const other = body.participantUserIds[0];
      let cv = [...C.convs.values()].find((x) => x.kind === 'dm' && x.members.has(me) && x.members.has(other));
      if (!cv) { cv = { id: uuid(), kind: 'dm', title: null, members: new Set([me, other]) }; C.convs.set(cv.id, cv); }
      return send(200, { id: cv.id, kind: 'dm' });
    }
    const mm = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages(\?.*)?$/);
    if (mm) {
      const cv = C.convs.get(mm[1]);
      if (!cv || !active(cv)) return send(404, { error: 'conversation not found' });
      if (req.method === 'GET') return send(200, C.msgs.filter((m) => m.conversationId === cv.id));
      const dup = C.msgs.find((m) => m.clientMessageId === body.clientMessageId && m.senderUserId === me);
      if (dup) return send(200, dup);
      const m = { id: uuid(), conversationId: cv.id, senderUserId: me, kind: 'text', body: body.body, replyToMessageId: body.replyToMessageId || null, clientMessageId: body.clientMessageId, createdAt: new Date(Date.now() + C.msgs.length).toISOString() };
      C.msgs.push(m); cv.last = m.id; cv.lastAt = m.createdAt; return send(200, m);
    }
    return send(404, { error: 'unknown' });
  } catch (e) { return send(e.status || 500, { error: e.message }); }
});

const user = async (s) => { const id = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',now()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id; await activate(pool, id); return String(id); };
const H = (id) => ({ id, kind: 'human' });

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);
  await new Promise((r) => idServer.listen(0, '127.0.0.1', r)); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  identityUrl = `http://127.0.0.1:${idServer.address().port}/api/comms/identity`;

  const owner = await user('owner'), ada = await user('ada'), bo = await user('bo'), stranger = await user('stranger');
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-acme`])).rows[0].id;
  const other = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Other',$2) RETURNING id`, [stranger, `${tag}-other`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['editor', ada], ['viewer', bo]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  await writeTuples(pool, { writes: [{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }] });
  const atlas = await agents.create(pool, H(ada), { name: 'Atlas' });
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${atlas.userId}`, relation: 'viewer' }] });
  const team = String((await pool.query(`INSERT INTO workforce_resources (kind, name, owner_workspace_id, status) VALUES ('team','Design',$1,'active') RETURNING id`, [ws])).rows[0].id);
  const w = { workspace: ws };

  // ── fails closed
  delete process.env.XENO_COMMS_API_URL;
  await refuses(M.openChannel(pool, H(ada), { ...w, key: 'workspace' }), 'message_not_configured', 'without XENO_COMMS_API_URL nothing is called');
  ok(C.seen.length === 0, 'nothing reached Comms while unconfigured');
  process.env.XENO_COMMS_API_URL = `http://127.0.0.1:${fake.address().port}`;

  // ── the identity endpoint
  const tok = await M.mintAssertion(pool, { subject: ada, workspaceId: ws });
  const first = await fetch(identityUrl, { headers: { authorization: `Bearer ${tok}` } });
  const fj = await first.json();
  ok(first.status === 200 && fj.user.id === ada && fj.user.kind === 'human' && !fj.user.ownerId, 'a person’s assertion is answered as a human member');
  ok((await fetch(identityUrl, { headers: { authorization: `Bearer ${tok}` } })).status === 401, 'the same assertion is refused the second time (single use)');
  const jwt = (await import('jsonwebtoken')).default;
  const { getSigningKey } = await import('../utils/oidcProvider.js');
  const key = await getSigningKey(pool), now = Math.floor(Date.now() / 1000);
  const wrongAud = jwt.sign({ sub: ada, jti: crypto.randomUUID(), iat: now, exp: now + 60 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, audience: 'xeno-post', issuer: (await import('../config/hosts.js')).issuer(), header: { typ: M.ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
  ok((await fetch(identityUrl, { headers: { authorization: `Bearer ${wrongAud}` } })).status === 401, 'an assertion for another audience is refused');
  const longLived = jwt.sign({ sub: ada, jti: crypto.randomUUID(), iat: now, exp: now + 3600 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, audience: 'xeno-comms', issuer: (await import('../config/hosts.js')).issuer(), header: { typ: M.ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
  ok((await fetch(identityUrl, { headers: { authorization: `Bearer ${longLived}` } })).status === 401, 'an assertion living longer than 60 s is refused');
  const at = await M.mintAssertion(pool, { subject: atlas.userId });
  const aj = await (await fetch(identityUrl, { headers: { authorization: `Bearer ${at}` } })).json();
  ok(aj.user.kind === 'agent' && aj.user.ownerId === ada, 'an agent’s assertion names it an agent owned by its person');
  ok(M.isCommsAssertion(tok) && !M.isCommsAssertion('abc.def.ghi'), 'only our assertion type takes the assertion path');

  // ── scoping: refused BEFORE Comms is called
  const n0 = C.seen.length;
  await refuses(M.readMessages(pool, H(stranger), { ...w, key: 'workspace' }), 'not_a_member', 'a stranger cannot read the workspace channel');
  await refuses(M.postMessage(pool, H(stranger), { ...w, key: 'workspace', text: 'hi' }), 'not_a_member', 'nor post in it');
  await refuses(M.readMessages(pool, H(ada), { workspace: other, key: 'workspace' }), 'not_a_member', 'a member of Acme cannot read another workspace');
  await refuses(M.openChannel(pool, H(ada), { ...w, key: 'chat:00000000-0000-0000-0000-000000000000' }), 'channel_not_found', 'an unknown scope kind is refused');
  ok(C.seen.length === n0, 'none of those refusals reached Comms');

  // ── the workspace channel: membership = the workspace, agents included
  const open = await M.openChannel(pool, H(ada), { ...w, key: 'workspace' });
  const cv = C.convs.get(open.channel.conversationId);
  const subjects = new Set([...cv.members].map((id) => C.users.get(id).subject));
  ok(subjects.has(owner) && subjects.has(ada) && subjects.has(bo) && subjects.has(atlas.userId) && !subjects.has(stranger), 'the channel’s Comms members are exactly the workspace (and its agent)');
  ok(C.users.get(C.bySubject.get(atlas.userId)).kind === 'agent' && C.users.get(C.bySubject.get(atlas.userId)).owner === C.bySubject.get(ada), 'the agent is a Comms agent owned by its person');
  const sync = C.seen.filter((s) => s.url === '/v1/platform/scoped-conversations').at(-1);
  ok(sync.ident.scope.key === 'workspace' && sync.ident.scope.workspaceId === ws, 'the scope rode in the signed assertion, verified by the platform');

  // ── a forged member list is refused by Comms (the digest binds it)
  const forged = await M.audienceOf(pool, ws, 'workspace');
  const scope = { workspace: ws, key: 'workspace', title: 'Acme', members_sha256: M.memberDigest(forged.members) };
  const extra = [...forged.members, { subject: stranger, kind: 'human', displayName: 'stranger' }];
  const dev = (await pool.query('SELECT comms_device_id FROM comms_members WHERE platform_user_id = $1', [ada])).rows[0].comms_device_id;
  const forgedRes = await fetch(`${process.env.XENO_COMMS_API_URL}/v1/platform/scoped-conversations`, { method: 'POST', headers: { authorization: `Bearer ${await M.mintAssertion(pool, { subject: ada, workspaceId: ws, scope })}`, 'x-xeno-device-id': dev, 'content-type': 'application/json' }, body: JSON.stringify({ members: extra }) });
  ok(forgedRes.status === 403 && !subjects.has(stranger), 'a member list that does not match the signed digest is refused');

  // ── messages and threads
  const p1 = await M.postMessage(pool, H(ada), { ...w, key: 'workspace', text: 'Launch is Friday' });
  await M.postMessage(pool, H(bo), { ...w, key: 'workspace', text: 'Ready on my side', replyTo: p1.message.id });
  const top = await M.readMessages(pool, H(owner), { ...w, key: 'workspace' });
  ok(top.messages.length === 1 && top.messages[0].replies === 1 && top.messages[0].author.name === 'ada', 'the channel shows the top message with its reply count, named by the platform');
  const th = await M.readMessages(pool, H(owner), { ...w, key: 'workspace', thread: p1.message.id });
  ok(th.parent.id === p1.message.id && th.messages.length === 1 && th.messages[0].text === 'Ready on my side', 'the thread holds its reply');
  const again = await M.postMessage(pool, H(ada), { ...w, key: 'workspace', text: 'once', clientMessageId: '11111111-1111-4111-8111-111111111111' });
  const twice = await M.postMessage(pool, H(ada), { ...w, key: 'workspace', text: 'once', clientMessageId: '11111111-1111-4111-8111-111111111111' });
  ok(again.message.id === twice.message.id, 'a retried post with the same client id is one message');

  // ── a team channel: only its members (and admins); removal is real
  {
    await pool.query(`INSERT INTO workforce_team_memberships (team_id, member_principal_id, role) VALUES ($1,$2,'worker')`, [team, bo]);
    const tk = `team:${team}`;
    const list = await M.listConversations(pool, H(ada), w);
    ok(!list.channels.some((c) => c.key === tk), 'ada (not in the team, not an admin) does not see the team channel');
    const n1 = C.seen.length;
    await refuses(M.readMessages(pool, H(ada), { ...w, key: tk }), 'not_in_channel', 'and cannot read it');
    ok(C.seen.length === n1, 'that refusal never reached Comms');
    ok((await M.listConversations(pool, H(owner), w)).channels.some((c) => c.key === tk), 'the workspace admin sees it');
    await M.postMessage(pool, H(bo), { ...w, key: tk, text: 'team only' });
    const tcv = [...C.convs.values()].find((x) => x.scope === `${ws}|${tk}`);
    ok([...tcv.members].map((id) => C.users.get(id).subject).sort().join() === [bo, owner].sort().join(), 'its Comms members are the team member and the admin');
    await pool.query(`UPDATE workforce_team_memberships SET state = 'revoked', revoked_at = now(), revision = revision + 1, updated_at = now() WHERE team_id = $1 AND member_principal_id = $2`, [team, bo]);
    await refuses(M.readMessages(pool, H(bo), { ...w, key: tk }), 'not_in_channel', 'removed from the team, bo is refused at once');
    await M.readMessages(pool, H(owner), { ...w, key: tk });
    ok(![...tcv.members].includes(C.bySubject.get(bo)), 'and the next open removes bo from the channel in Comms');
    const boDev = (await pool.query('SELECT comms_device_id FROM comms_members WHERE platform_user_id = $1', [bo])).rows[0].comms_device_id;
    const direct = await fetch(`${process.env.XENO_COMMS_API_URL}/v1/conversations/${tcv.id}/messages`, { headers: { authorization: `Bearer ${await M.mintAssertion(pool, { subject: bo })}`, 'x-xeno-device-id': boDev } });
    ok(direct.status === 404, 'so even bo’s own Comms client can no longer read it');
  }

  // ── direct messages: co-members only
  await refuses(M.openDirect(pool, H(ada), { ...w, userId: stranger }), 'not_a_member', 'no direct message with someone outside the workspace');
  const dm = await M.openDirect(pool, H(ada), { ...w, userId: bo });
  await M.postMessage(pool, H(ada), { ...w, conversationId: dm.conversationId, text: 'quick question' });
  ok((await M.readMessages(pool, H(bo), { ...w, conversationId: dm.conversationId })).messages[0].text === 'quick question', 'a direct message reaches the other person');
  await refuses(M.readMessages(pool, H(owner), { ...w, conversationId: dm.conversationId }), 'conversation_not_found', 'a third person cannot read it');
  ok((await M.listConversations(pool, H(ada), w)).dms.some((d) => d.conversationId === dm.conversationId && d.with.id === bo), 'it is listed in the workspace');
  await writeTuples(pool, { deletes: [{ object: `workspace:${ws}`, subject: `user:${bo}`, relation: 'viewer' }] });
  ok(!(await M.listConversations(pool, H(ada), w)).dms.some((d) => d.conversationId === dm.conversationId), 'once bo leaves the workspace it is no longer listed here');
  await refuses(M.readMessages(pool, H(ada), { ...w, conversationId: dm.conversationId }), 'not_a_member', 'nor readable through this workspace');
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${bo}`, relation: 'viewer' }] });

  // ── @agent: the chat's hand-off
  const ho = await M.handOff(pool, H(ada), { ...w, key: 'workspace', messageId: p1.message.id, agentId: atlas.id, prompt: 'Draft the launch note' });
  ok(ho.handoff.delegated === true && /^T-\d+$/.test(ho.handoff.task.key), 'an @agent hand-off is a task delegated to the agent');
  const task = (await pool.query(`SELECT body, source_ref FROM tasks WHERE number = $1`, [Number(ho.handoff.task.key.slice(2))])).rows[0];
  ok(task.body.includes(`/workspace/social/spaces/message/workspace/t/${p1.message.id}`) && task.source_ref.startsWith('comms:'), 'the task links back to the message’s address');
  const th2 = await M.readMessages(pool, H(ada), { ...w, key: 'workspace', thread: p1.message.id });
  ok(th2.messages.some((m) => m.text.startsWith('Handed to Atlas as T-')), 'and the thread says where the work went');
  await refuses(M.handOff(pool, { id: atlas.userId }, { ...w, key: 'workspace', agentId: atlas.id, prompt: 'x' }), 'person_required', 'an agent does not hand work to an agent');

  // ── MCP for agents
  const A = { id: atlas.userId };
  const chans = (await Mcp.callTool(pool, A, 'list_channels', w)).structuredContent.channels;
  ok(chans.some((c) => c.key === 'workspace') && !chans.some((c) => c.key === `team:${team}`), 'the agent lists the channels it belongs to, not the team it is not in');
  const posted = (await Mcp.callTool(pool, A, 'post_message', { ...w, key: 'workspace', text: 'Draft is in T-1', request_key: crypto.randomUUID() })).structuredContent;
  ok(posted.message.author.kind === 'agent' && posted.message.author.name === 'Atlas', 'it posts as itself, marked as an agent');
  await refuses(Mcp.callTool(pool, A, 'post_message', { ...w, key: `team:${team}`, text: 'x', request_key: crypto.randomUUID() }), 'not_in_channel', 'and cannot post in a channel it is not in');
  await refuses(Mcp.callTool(pool, A, 'post_message', { ...w, key: 'workspace', text: 'x', request_key: 'nope' }), 'invalid_request_key', 'a post needs a request key');
  ok(!Mcp.TOOLS.some((t) => /direct|handoff|hand_off/.test(t.name)), 'there is no agent tool for direct messages or hand-offs');

  // ── nothing of the conversation is stored on the platform
  const cols = (await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'comms\\_%' AND column_name ~ '(body|text|content|message)'`)).rows;
  ok(cols.length === 0, 'the platform keeps no message text (links only)');

  console.log(`\nmessage-xeno-comms: ${passed} checks passed`);
}

main().then(() => { fake.close(); idServer.close(); return pool.end(); }).catch(async (e) => { console.error(e); fake.close(); idServer.close(); await pool.end(); process.exit(1); });

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
 *   - MCP: an agent lists, reads and posts in channels it belongs to and nowhere else;
 *   - ticks: sent, delivered, read, from each member's watermark and only on your own messages;
 *   - @mentions reach members of the conversation only, in their inbox, an agent's included, and run nothing,
 *     unless the person who pays turned that on: then a mention wakes the agent, within every limit (mentionWake.js).
 *
 * Run: DATABASE_URL=postgresql://… node tests/message-xeno-comms.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
import * as Wake from '../services/mentionWake.js';
import * as Cloud from '../services/agentCloudRuns.js';
import * as Tasks from '../services/xenoTasks.js';
import { addGrant } from '../utils/creditLedgerV2.js';

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
const C = { users: new Map(), bySubject: new Map(), devices: new Map(), convs: new Map(), msgs: [], seen: [], read: new Map(), delivered: new Map(), mentions: [], hidden: new Set() };
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
    const rc = req.url.match(/^\/v1\/conversations\/([^/]+)\/(receipts|mentions)(?:\/(read|delivered))?(\?.*)?$/);
    if (rc) {
      const cv = C.convs.get(rc[1]);
      if (!cv || !active(cv)) return send(404, { error: 'conversation not found' });
      if (rc[2] === 'mentions') {
        const by = new Map();
        for (const x of C.mentions.filter((y) => y.conversationId === cv.id)) by.set(x.messageId, [...(by.get(x.messageId) || []), x.userId]);
        return send(200, [...by].map(([messageId, userIds]) => ({ messageId, userIds })));
      }
      if (req.method === 'POST') { (rc[3] === 'read' ? C.read : C.delivered).set(`${me}:${cv.id}`, body.messageId); return send(200, { conversationId: cv.id, messageId: body.messageId, userId: me }); }
      // the watermark Comms hides: a member who doesn't share receipts, and everyone from a viewer who doesn't
      return send(200, { conversationId: cv.id, members: [...cv.members].map((id) => ({ userId: id, lastDeliveredMessageId: C.delivered.get(`${id}:${cv.id}`) || null,
        lastReadMessageId: id === me || (!C.hidden.has(id) && !C.hidden.has(me)) ? C.read.get(`${id}:${cv.id}`) || null : null, sharesReadReceipts: !C.hidden.has(id) })) });
    }
    const mm = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages(\?.*)?$/);
    if (mm) {
      const cv = C.convs.get(mm[1]);
      if (!cv || !active(cv)) return send(404, { error: 'conversation not found' });
      if (req.method === 'GET') return send(200, C.msgs.filter((m) => m.conversationId === cv.id));
      const dup = C.msgs.find((m) => m.clientMessageId === body.clientMessageId && m.senderUserId === me);
      if (dup) return send(200, dup);
      const m = { id: uuid(), conversationId: cv.id, senderUserId: me, kind: 'text', body: body.body, replyToMessageId: body.replyToMessageId || null, clientMessageId: body.clientMessageId, createdAt: new Date(Date.now() + C.msgs.length).toISOString() };
      for (const id of body.mentionedUserIds || []) { if (!cv.members.has(id)) return send(400, { error: 'only members of this conversation can be mentioned' }); C.mentions.push({ conversationId: cv.id, messageId: m.id, userId: id }); }
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

  // ── ticks
  const lets = crypto.randomUUID().slice(0, 8);
  const tickRoom = { ...w, key: 'workspace' };
  const sent = (await M.postMessage(pool, H(ada), { ...tickRoom, text: `Ticks ${lets}` })).message;
  const mineNow = async (who = H(ada)) => (await M.readMessages(pool, who, tickRoom)).messages.find((m) => m.id === sent.id);
  const members = (await M.listMembers(pool, H(ada), tickRoom)).members;
  const others = members.length - 1;
  ok(others >= 1, 'the channel has someone else to read it');
  let r = (await mineNow()).receipt;
  ok(r && r.status === 'sent' && r.of === others && r.read === 0, 'a new message is one tick: XENO has it');
  const everyone = [...C.convs.values()].find((c) => c.scope && c.scope.endsWith('|workspace')), adaC = C.bySubject.get(ada);
  const rest = [...everyone.members].filter((id) => id !== adaC);
  for (const id of rest) C.delivered.set(`${id}:${everyone.id}`, sent.id);
  r = (await mineNow()).receipt;
  ok(r.status === 'delivered' && r.delivered === others, 'two ticks once it reached every other member');
  C.read.set(`${rest[0]}:${everyone.id}`, sent.id);
  r = (await mineNow()).receipt;
  ok(rest.length > 1 ? r.status === 'delivered' && r.read === 1 : r.status === 'read', 'one reader of several is a count, not a read mark');
  for (const id of rest) C.read.set(`${id}:${everyone.id}`, sent.id);
  r = (await mineNow()).receipt;
  ok(r.status === 'read' && r.read === others && r.readBy.length === others, 'read once everyone has read it, and it names them');
  for (const id of rest) { C.read.delete(`${id}:${everyone.id}`); C.delivered.delete(`${id}:${everyone.id}`); }
  const earlier = C.msgs.find((m) => m.conversationId === everyone.id && m.id !== sent.id);
  C.read.set(`${rest[0]}:${everyone.id}`, sent.id); const newer = (await M.postMessage(pool, H(ada), { ...tickRoom, text: 'A later one' })).message;
  ok((await M.readMessages(pool, H(ada), tickRoom)).messages.find((m) => m.id === newer.id).receipt.read === 0, 'reading one message does not read a later one');
  ok(!!earlier && (await M.readMessages(pool, H(ada), tickRoom)).messages.find((m) => m.id === earlier.id).receipt.read >= 1, 'and it does read every earlier one');
  C.hidden.add(rest[0]);
  ok((await mineNow()).receipt.read === 0, 'someone who hides read receipts is not seen reading');
  C.hidden.delete(rest[0]);
  const agentActor = { id: atlas.userId };
  const seenBy = (await M.readMessages(pool, agentActor, tickRoom)).messages.find((m) => m.id === sent.id);
  ok(!seenBy.receipt, 'ticks are the sender’s: nobody else gets them');
  ok(C.read.get(`${C.bySubject.get(atlas.userId)}:${everyone.id}`) !== newer.id, 'looking without seeing marks nothing read');
  await Mcp.callTool(pool, agentActor, 'read_channel', { ...tickRoom });
  ok(C.read.get(`${C.bySubject.get(atlas.userId)}:${everyone.id}`) === newer.id, 'an agent that reads a channel has read it');
  C.convs.get(everyone.id).last = newer.id; const posts = C.seen.length;
  await M.listConversations(pool, H(bo), w); await M.listConversations(pool, H(bo), w);
  ok(C.seen.slice(posts).filter((x) => x.method === 'POST' && x.url === `/v1/conversations/${everyone.id}/receipts/delivered`).length === 1, 'listing marks it delivered once, however often a page lists');

  // ── @mentions
  const atlasHandle = members.find((m) => m.id === String(atlas.userId)).handle;
  ok(!!atlasHandle && members.find((m) => m.id === String(atlas.userId)).kind === 'agent', 'an agent can be named');
  ok(JSON.stringify(M.mentionedHandles(`hi @${atlasHandle}. and (@Bob-1) a@b.co @@x`)) === JSON.stringify([atlasHandle.toLowerCase(), 'bob-1']), 'a handle ends where the sentence does, and an email is not one');
  const inbox = async (id) => (await pool.query(`SELECT title, detail, ref, actor_kind FROM user_notifications WHERE user_id = $1 AND source = 'message' AND kind = 'mentioned' ORDER BY created_at DESC`, [id])).rows;
  const named = (await M.postMessage(pool, H(ada), { ...tickRoom, text: `Can you take this, @${atlasHandle}?` })).message;
  ok(named.mentions.length === 1 && named.mentions[0].id === String(atlas.userId), 'naming someone in the conversation reaches them');
  ok(C.mentions.some((x) => x.messageId === named.id && x.userId === C.bySubject.get(atlas.userId)), 'and Comms keeps it with the message');
  const row = (await inbox(atlas.userId))[0];
  ok(row && row.title.includes('mentioned you') && row.ref.includes(`/t/${named.id}`) && row.ref.includes('?ws='), 'the agent’s own inbox says so and opens the message');
  ok((await M.readMessages(pool, H(bo), tickRoom)).messages.find((m) => m.id === named.id).mentions[0].handle === atlasHandle, 'readers see who was named');
  const back = (await Mcp.callTool(pool, agentActor, 'post_message', { ...tickRoom, text: `@${members.find((m) => m.id === String(bo)).handle} done`, request_key: crypto.randomUUID() })).structuredContent.message;
  ok(back.mentions.length === 1 && (await inbox(bo))[0].actor_kind === 'agent', 'an agent can name a member the same way');
  const before = C.mentions.length;
  await M.postMessage(pool, H(ada), { ...tickRoom, text: `hello @${atlasHandle.toUpperCase()} and @nobody_here_${lets}` });
  ok(C.mentions.length === before + 1, 'a handle matches however it is typed, and a stranger’s name reaches nobody');
  const self = (await M.postMessage(pool, H(ada), { ...tickRoom, text: `note to @${members.find((m) => m.id === String(ada)).handle}` })).message;
  ok(self.mentions.length === 0, 'naming yourself tells nobody');
  ok(!C.seen.some((x) => /agent-runs|\/runs/.test(x.url)) && (await pool.query(`SELECT count(*)::int AS n FROM agent_cloud_runs`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n === 0, 'naming an agent starts nothing running');
  ok((await Mcp.callTool(pool, agentActor, 'list_members', tickRoom)).structuredContent.members.length === members.length, 'an agent can see who it can name');

  // ── a mention wakes an agent, only as its person allows
  const runs = []; let hosted = 'running';
  const opts = { env: { AGENTS_API_BASE_URL: 'http://runner.test' }, fetchImpl: async (url, init = {}) => {
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({ capabilities: ['runs.platformAgent'] }), { status: 200 });
    if (String(url).endsWith('/runs') && init.method === 'POST') { runs.push(JSON.parse(init.body)); return new Response(JSON.stringify({ run: { runId: `hosted-${runs.length}`, status: 'running' } }), { status: 201 }); }
    if (/\/runs\/hosted-\d+$/.test(String(url))) return new Response(JSON.stringify({ run: { status: hosted } }), { status: 200 });
    return new Response('{}', { status: 404 });
  } };
  await addGrant(pool, ada, { amountMicro: 500_000_000, kind: 'paid', sourceRef: `seed:${tag}` });
  await agents.update(pool, H(ada), atlas.id, { instructions: 'Answer briefly.' });
  const vega = await agents.create(pool, H(ada), { name: 'Vega', instructions: 'Answer briefly.' });
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${vega.userId}`, relation: 'viewer' }] });
  await M.openChannel(pool, H(ada), tickRoom);
  const roster = await M.listMembers(pool, H(ada), tickRoom);
  const handle = (id) => roster.members.find((m) => m.id === String(id)).handle;
  const vegaActor = { id: vega.userId };
  const wakesOf = async (id) => (await pool.query(`SELECT * FROM agent_mention_wakes WHERE agent_user_id = $1 ORDER BY created_at, id`, [id])).rows;
  const finishRuns = () => pool.query(`UPDATE agent_cloud_runs SET state = 'completed', ended_at = now() WHERE state = ANY($1)`, [['starting', 'queued', 'running']]);
  const paid = async (text) => (await pool.query(`SELECT title FROM user_notifications WHERE user_id = $1 AND kind = 'mention_wake' AND title LIKE $2`, [ada, `%${text}%`])).rows.length;

  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} are you there?` });
  ok((await wakesOf(atlas.userId)).length === 0 && await Wake.drain(pool, opts) === 0, 'an agent wakes for nobody until its person turns that on');
  await assert.rejects(Wake.setSettings(pool, H(bo), atlas.id, { mode: 'everyone' }), /Only its owner|not found/i);
  await assert.rejects(Wake.setSettings(pool, agentActor, atlas.id, { mode: 'everyone' }));
  await assert.rejects(pool.query(`INSERT INTO agent_mention_settings (agent_user_id, mode, updated_by) VALUES ($1, 'everyone', $2)`, [vega.userId, atlas.userId]), /only a person/);
  ok(true, 'only the person who answers for it can turn it on, and an agent can’t, even in the database');
  await assert.rejects(Wake.setSettings(pool, H(ada), atlas.id, { budgetCredits: 500 }), /between 1 and 200/);
  const on = await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'people', budgetCredits: 7 });
  ok(on.mode === 'people' && on.budgetCredits === 7 && on.perDay === 10, 'a person turns it on with a budget for one wake');

  const asked = (await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} check the header please` })).message;
  ok((await wakesOf(atlas.userId))[0].state === 'queued' && runs.length === 0, 'sending only queues: nobody’s message waits on a run');
  ok(await Wake.drain(pool, opts) === 1 && runs.length === 1, 'the worker starts it');
  const [woke] = await wakesOf(atlas.userId);
  const run = (await pool.query(`SELECT * FROM agent_cloud_runs WHERE id = $1`, [woke.run_row_id])).rows[0];
  ok(woke.state === 'started' && String(run.owner_user_id) === ada && String(run.agent_user_id) === String(atlas.userId) && Number(run.budget_credits) === 7, 'the person who answers for it pays, up to the wake’s budget, whoever spoke');
  ok(runs[0].budget.maxCredits === 7 && runs[0].prompt.includes('check the header please') && runs[0].prompt.includes(`reply_to ${asked.id}`) && runs[0].prompt.includes(`key ${tickRoom.key}`), 'it is told what was said and where to answer');
  ok(/written by a member of the channel, not by the person who answers for you/.test(runs[0].prompt), 'and that a member’s words are not its owner’s');
  ok(woke.message_text === null && /^T-\d+$/.test(woke.task_key), 'it works a task, and the wake keeps no words');
  ok(!/XenoTask(Take|Report|Comment|Move)|for review|How to work a XENO task/.test(runs[0].prompt) && /Answer them there, then stop/.test(runs[0].prompt) && runs[0].prompt.includes('Answer briefly.'), 'a wake is told to answer and stop, with its own instructions and no task steps');
  ok(['XenoTaskTake', 'XenoTaskMove', 'XenoTaskComment', 'XenoTaskReport', 'XenoTaskProgress'].every((x) => runs[0].platformAgent.tools.deny.includes(x)) && !runs[0].platformAgent.tools.deny.includes('XenoTaskCreate'), 'and it has no task steps to spend turns on, though it can still raise a task');

  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} also this` });
  await M.postMessage(pool, H(ada), { ...tickRoom, text: `@${atlasHandle} and this` });
  ok(await Wake.drain(pool, opts) === 0 && runs.length === 1, 'mentions during a run wait for it');
  hosted = 'completed'; await Cloud.refresh(pool, H(ada), run, opts);
  ok((await Tasks.getTask(pool, H(ada), woke.task_key)).status === 'done', 'a wake that finished closes its task: nobody has a reply to review');
  ok(await Wake.drain(pool, opts) === 1 && runs.length === 2 && (await wakesOf(atlas.userId)).filter((x) => x.state === 'merged').length === 1 && runs[1].prompt.includes('1 more message'), 'then fold into one wake');
  const second = (await wakesOf(atlas.userId)).find((x) => x.state === 'started' && x.task_key !== woke.task_key);
  hosted = 'failed'; await Cloud.refresh(pool, H(ada), (await pool.query('SELECT * FROM agent_cloud_runs WHERE id = $1', [second.run_row_id])).rows[0], opts); hosted = 'running';
  ok((await Tasks.getTask(pool, H(ada), second.task_key)).status === 'todo', 'one that failed stays open for its person to see');

  await Mcp.callTool(pool, vegaActor, 'post_message', { ...tickRoom, text: `@${atlasHandle} over to you`, request_key: crypto.randomUUID() });
  ok(await Wake.drain(pool, opts) === 0 && (await wakesOf(atlas.userId)).length === 3, '`people` means another agent can’t wake it');

  await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'everyone', perDay: 100 });
  await Wake.setSettings(pool, H(ada), vega.id, { mode: 'everyone', perDay: 100, budgetCredits: 7 });
  const say = (who, to) => Mcp.callTool(pool, who, 'post_message', { ...tickRoom, text: `@${to} your turn`, request_key: crypto.randomUUID() });
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${handle(vega.userId)} start` });          // 0
  await Wake.drain(pool, opts); await finishRuns();
  await say(vegaActor, atlasHandle); await Wake.drain(pool, opts); await finishRuns();              // 1
  await say(agentActor, handle(vega.userId)); await Wake.drain(pool, opts); await finishRuns();     // 2
  await say(vegaActor, atlasHandle); await Wake.drain(pool, opts); await finishRuns();              // 3
  const before4 = runs.length;
  await say(agentActor, handle(vega.userId)); await Wake.drain(pool, opts);                         // 4: stopped
  const last = (await wakesOf(vega.userId)).at(-1);
  ok(last.state === 'refused' && last.reason === 'chain_limit' && last.depth === Wake.MAX_CHAIN + 1 && runs.length === before4, 'agents waking agents stop after three in a row');
  ok(await paid('woken each other') === 1, 'and the person who pays is told');
  await finishRuns();

  await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'people', perDay: 1 });
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} one more` });
  const left = runs.length;
  ok(await Wake.drain(pool, opts) === 0 && runs.length === left && (await wakesOf(atlas.userId)).at(-1).reason === 'daily_limit', 'an agent stops at its wakes for the day');
  ok(await paid('wakes for today') === 1, 'and its person hears it once');

  await Wake.setSettings(pool, H(ada), atlas.id, { perDay: 100 });
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} about to be off` });
  await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'off' });
  ok(await Wake.drain(pool, opts) === 0 && (await wakesOf(atlas.userId)).at(-1).state === 'cancelled', 'turning it off stops what was waiting');

  await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'people' });
  await pool.query(`INSERT INTO agent_mention_wakes (agent_user_id, owner_user_id, sender_user_id, sender_kind, sender_name, workspace_id, channel_key, channel_title, conversation_id, message_id, ref, state)
    SELECT $1::uuid, $2::uuid, $2::uuid, 'human', 'x', $3::uuid, 'workspace', 'x', $4::uuid, gen_random_uuid(), 'x', 'started' FROM generate_series(1, $5::int)`, [vega.userId, ada, ws, everyone.id, Wake.CHANNEL_PER_HOUR]);
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} busy room` });
  ok((await wakesOf(atlas.userId)).at(-1).reason === 'channel_limit', 'a channel takes so many wakes an hour');

  const noRunner = { ...opts, fetchImpl: async () => new Response(JSON.stringify({ capabilities: [] }), { status: 200 }) };
  await pool.query(`DELETE FROM agent_mention_wakes WHERE sender_name = 'x'`);
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} nobody home` });
  ok(await Wake.drain(pool, noRunner) === 0 && (await wakesOf(atlas.userId)).at(-1).state === 'failed' && await paid('couldn’t be woken') === 1, 'a wake that can’t start reaches the person who pays');

  // a wake that couldn't answer is never started: its person would pay for silence
  await Wake.setSettings(pool, H(ada), atlas.id, { mode: 'people', perDay: 100, budgetCredits: 1 });
  await pool.query(`UPDATE agent_mention_wakes SET state = 'cancelled' WHERE state = 'queued'`); await finishRuns();
  const beforeOff = runs.length;
  const client = `agent:${atlas.id}`;
  await pool.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name, categories) VALUES ($1, $2, $3, 'Atlas', $4)`, [ada, atlas.userId, client, ['tasks']]);
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} Message is off` });
  ok(await Wake.drain(pool, opts) === 0 && runs.length === beforeOff && (await wakesOf(atlas.userId)).at(-1).reason === 'cannot_answer', 'an agent that can’t reach Message isn’t woken');
  ok(await paid('couldn’t answer') === 1, 'and its person hears why');
  await pool.query(`UPDATE mcp_connections SET categories = $2, paused_at = now() WHERE client_id = $1`, [client, ['tasks', 'message']]);
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} paused` });
  ok(await Wake.drain(pool, opts) === 0 && runs.length === beforeOff, 'nor is one whose connection is paused');
  await pool.query('UPDATE mcp_connections SET paused_at = NULL WHERE client_id = $1', [client]);
  await M.postMessage(pool, H(bo), { ...tickRoom, text: `@${atlasHandle} back on` });
  ok(await Wake.drain(pool, opts) === 1 && runs.length === beforeOff + 1, 'with Message on it wakes');

  // the migration adds Message to connections older than it, and leaves a later choice alone
  const migration = fs.readFileSync(new URL('../database/migrations/20261119090000-agent-connections-message.sql', import.meta.url), 'utf8');
  await pool.query(`UPDATE mcp_connections SET categories = $2, created_at = '2026-10-16' WHERE client_id = $1`, [client, ['tasks']]);
  await pool.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name, categories) VALUES ($1, $2, $3, 'Vega', $4)`, [ada, vega.userId, `agent:${vega.id}`, ['tasks']]);
  await pool.query(migration); await pool.query(migration);
  const cats = async (id) => (await pool.query('SELECT categories FROM mcp_connections WHERE client_id = $1', [id])).rows[0].categories;
  ok((await cats(client)).filter((c) => c === 'message').length === 1, 'an agent older than Message gets it, once');
  ok(!(await cats(`agent:${vega.id}`)).includes('message'), 'a connection that turned it off keeps that');

  // a workspace's project can be given to an agent, and that puts the agent in its channel
  const newProject = (await pool.query(`INSERT INTO chat_projects (workspace_id, name) VALUES ($1, 'Launch') RETURNING id`, [ws])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `project:${newProject}`, relation: 'parent', subject: `workspace:${ws}` }] });
  const hermes = await agents.create(pool, H(owner), { name: 'Hermes', instructions: 'Answer briefly.' });
  const choice = (await agents.projectChoices(pool, H(owner), hermes.id)).find((p) => p.id === String(newProject));
  ok(choice && choice.canGive, 'a project made in a workspace is offered for its agents');
  const outsider = await agents.create(pool, H(stranger), { name: 'Outsider', instructions: 'Answer briefly.' });
  ok(!(await agents.projectChoices(pool, H(stranger), outsider.id)).some((p) => p.id === String(newProject)), 'and not to someone outside it');
  await agents.addProject(pool, H(owner), hermes.id, newProject);
  ok((await M.listMembers(pool, H(owner), { ...w, key: `project:${newProject}` })).members.some((m) => m.id === String(hermes.userId)), 'the agent is then in the project’s channel');
  const hermesActor = { id: hermes.userId }, hermesRoom = { ...w, key: `project:${newProject}` };
  await M.postMessage(pool, H(owner), { ...hermesRoom, text: 'Anyone there?' });
  ok((await M.readMessages(pool, hermesActor, hermesRoom)).messages.some((m) => m.text === 'Anyone there?'), 'an agent that is only in the project reads its channel');
  ok((await M.postMessage(pool, hermesActor, { ...hermesRoom, text: 'Here' })).message.author.kind === 'agent', 'and answers there');
  await refuses(M.readMessages(pool, hermesActor, { ...w, key: 'workspace' }), 'not_a_member', 'but it cannot read the workspace’s channel');
  await refuses(M.listConversations(pool, hermesActor, w), 'not_a_member', 'nor list the workspace’s channels');
  const otherProject = (await pool.query(`INSERT INTO chat_projects (workspace_id, name) VALUES ($1, 'Other') RETURNING id`, [ws])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `project:${otherProject}`, relation: 'parent', subject: `workspace:${ws}` }] });
  await refuses(M.readMessages(pool, hermesActor, { ...w, key: `project:${otherProject}` }), 'not_a_member', 'nor another project’s');

  // ── nothing of the conversation is stored on the platform
  const cols = (await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'comms\\_%' AND column_name ~ '(body|text|content|message)'`)).rows;
  ok((await pool.query(`SELECT count(*)::int AS n FROM agent_mention_wakes WHERE message_text IS NOT NULL AND state NOT IN ('queued', 'starting')`)).rows[0].n === 0, 'a wake keeps a message’s words only while it waits to start');
  ok(cols.length === 0, 'the platform keeps no message text (links only)');

  console.log(`\nmessage-xeno-comms: ${passed} checks passed`);
}

main().then(() => { fake.close(); idServer.close(); return pool.end(); }).catch(async (e) => { console.error(e); fake.close(); idServer.close(); await pool.end(); process.exit(1); });

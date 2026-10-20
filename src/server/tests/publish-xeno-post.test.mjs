/**
 * XENO Publish = XENO Post, server-to-server (services/xenoPost.js + publishMcp.js), on real Postgres against a FAKE
 * xeno-post that verifies every assertion with the platform's own public key. Nothing reaches a real network.
 *
 *   - fails closed: no XENO_POST_API_URL → publish_not_configured; no link → publish_not_linked;
 *   - the assertion: aud xeno-post, typ xeno-post-assertion+jwt, 60 s, sub = the person, act = the agent;
 *   - §8.11: only an admin links the workspace (and the link is proven against xeno-post first); a viewer reads,
 *     an editor drafts; a non-member is refused;
 *   - a draft is never published (no time); a person's schedule PATCHes scheduledFor; an agent's is a PROPOSAL that
 *     sends nothing until a person confirms it, and only with confirm:true;
 *   - publish-now and retract: an agent is refused, a person without confirm gets 428, and publish-now carries no
 *     JSON content type on its empty body (xeno-post answers 500 to that);
 *   - MCP: there is no publish, retract or approve tool, and propose_schedule never schedules, even for a person.
 *
 * Run: DATABASE_URL=postgresql://… node tests/publish-xeno-post.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { jwks } from '../utils/oidcProvider.js';
import * as Post from '../services/xenoPost.js';
import * as Mcp from '../services/publishMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `pb${process.pid}`; let seq = 0;

// ── the fake xeno-post
const seen = [];
const posts = new Map([['p1', { id: 'p1', state: 'draft', content: [{ type: 'text', text: 'hello' }], targets: [] }]]);
let pub;   // the platform's public key, as xeno-post would read it from /api/oauth2/jwks
const fake = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let claims;
  try {
    const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const hdr = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());
    if (hdr.typ !== Post.ASSERTION_TYP) throw new Error('typ');
    claims = jwt.verify(tok, pub, { algorithms: ['ES256'], audience: 'xeno-post' });
  } catch { return send(401, { message: 'bad assertion' }); }
  seen.push({ method: req.method, url: req.url, ctype: req.headers['content-type'] || null, body: raw ? JSON.parse(raw) : null, claims });
  const m = req.url.match(/^\/api\/v1\/workspaces\/([^/]+)\/(.*)$/);
  if (!m || m[1] !== claims.post_workspace) return send(404, { message: 'no' });
  if (m[1] === 'not-mine') return send(403, { message: 'not a member of this workspace' });
  const rest = m[2];
  if (rest === 'channels') return send(200, [{ id: 'ch1', platform: 'x', displayName: 'XENO', handle: '@xeno', status: 'active' }]);
  if (rest.startsWith('posts?')) return send(200, { items: [...posts.values()] });
  if (rest === 'posts' && req.method === 'POST') { const b = JSON.parse(raw); const p = { id: 'p' + (posts.size + 1), state: b.scheduledFor ? 'queued' : 'draft', content: b.content, targets: [] }; posts.set(p.id, p); return send(201, p); }
  let pm = rest.match(/^posts\/([^/]+)$/);
  if (pm && req.method === 'GET') return posts.has(pm[1]) ? send(200, posts.get(pm[1])) : send(404, { message: 'post not found' });
  if (pm && req.method === 'PATCH') { const p = posts.get(pm[1]); Object.assign(p, { scheduledFor: JSON.parse(raw).scheduledFor, state: 'queued' }); return send(200, p); }
  pm = rest.match(/^posts\/([^/]+)\/(publish-now|retract)$/);
  if (pm) { const p = posts.get(pm[1]); p.state = pm[2] === 'retract' ? 'retracted' : 'publishing'; return send(200, p); }
  if (rest.startsWith('approvals?')) return send(200, [{ id: 'ar1', postId: 'p1', createdAt: new Date().toISOString() }]);
  if (/^approvals\/ar1\/(approve|reject)$/.test(rest)) return send(200, { ok: true });
  if (rest.startsWith('conversations')) return send(200, { items: [{ id: 'cv1', channelId: 'ch1', contact: { displayName: 'Ada' }, lastMessagePreview: 'hi there', unread: true }] });
  return send(404, { message: 'unknown' });
});

const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const refuses = async (p, code) => { await assert.rejects(p, (e) => { assert.ok(e instanceof Post.PublishError || e instanceof Mcp.PublishMcpError, String(e)); assert.equal(e.code, code); return true; }); };

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);   // oidc_signing_keys
  const keys = await jwks(pool); pub = crypto.createPublicKey({ key: keys.keys.at(-1), format: 'jwk' });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));

  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agentU, editor]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Pub',$2) RETURNING id`, [owner, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, A = { id: agentU, kind: 'agent' };
  const w = { workspace: ws };

  // fails closed
  delete process.env.XENO_POST_API_URL;
  await refuses(Post.listChannels(pool, O, w), 'publish_not_configured');
  process.env.XENO_POST_API_URL = `http://127.0.0.1:${fake.address().port}/api/v1`;
  await refuses(Post.listChannels(pool, O, w), 'publish_not_linked');
  assert.deepEqual(seen, [], 'nothing was sent while unconfigured or unlinked');

  // §8.11: only an admin links, and only to a xeno-post workspace they are a member of
  await refuses(Post.linkWorkspace(pool, E, { ...w, postWorkspaceId: 'pw1' }), 'admin_required');
  await refuses(Post.linkWorkspace(pool, O, { ...w, postWorkspaceId: 'not-mine' }), 'post_forbidden');
  assert.equal((await Post.status(pool, O, w)).linked, false, 'a refused link is not saved');
  assert.equal((await Post.linkWorkspace(pool, O, { ...w, postWorkspaceId: 'pw1' })).postWorkspaceId, 'pw1');
  await refuses(Post.listChannels(pool, { id: stranger, kind: 'human' }, w), 'not_a_member');

  // the assertion
  const c = seen.at(-1).claims;
  assert.equal(c.sub, String(owner)); assert.equal(c.aud, 'xeno-post'); assert.equal(c.xeno_workspace, ws); assert.equal(c.post_workspace, 'pw1');
  assert.equal(c.exp - c.iat, 60, 'the assertion lives 60 seconds');

  // reads
  assert.deepEqual((await Post.listChannels(pool, V, w)).channels, [{ id: 'ch1', platform: 'x', name: 'XENO', handle: '@xeno', status: 'active' }]);
  assert.equal((await Post.listInbox(pool, V, w)).conversations[0].from, 'Ada');

  // drafts: a viewer may not; an editor makes a draft that has no time
  await refuses(Post.createDraft(pool, V, { ...w, text: 'x', channelIds: ['ch1'] }), 'editor_required');
  const d = await Post.createDraft(pool, E, { ...w, text: 'Launch day', channelIds: ['ch1'], requestKey: 'k-12345678' });
  assert.equal(d.post.state, 'draft');
  assert.equal(seen.at(-1).body.scheduledFor, undefined, 'a draft carries no time');
  assert.match(seen.at(-1).body.clientReference, /^xeno:.+:k-12345678$/);

  // an agent's schedule is a proposal: nothing is sent to xeno-post but a read
  const at = new Date(Date.now() + 3600_000).toISOString();
  const before = seen.length;
  const prop = await Post.schedulePost(pool, A, { ...w, postId: d.post.id, at });
  assert.equal(prop.needsConfirmation, true); assert.equal(prop.scheduled, false);
  assert.deepEqual(seen.slice(before).map((s) => s.method), ['GET'], 'the agent only read the post');
  assert.equal(seen.at(-1).claims.act.sub, String(agentU), 'the agent is named as the actor');
  assert.equal(seen.at(-1).claims.sub, String(editor), 'and acts for its owner');
  const q = (await Post.listApprovals(pool, V, w)).items;
  assert.deepEqual(q.map((i) => i.kind).sort(), ['approval', 'proposal']);
  const pid = q.find((i) => i.kind === 'proposal').id;
  await refuses(Post.decideApproval(pool, A, { ...w, kind: 'proposal', id: pid, approve: true, confirm: true }), 'person_required');
  await refuses(Post.decideApproval(pool, E, { ...w, kind: 'proposal', id: pid, approve: true }), 'confirmation_required');
  assert.equal(seen.filter((s) => s.method === 'PATCH').length, 0, 'still nothing scheduled');
  assert.equal((await Post.decideApproval(pool, E, { ...w, kind: 'proposal', id: pid, approve: true, confirm: true })).decided, 'confirmed');
  assert.equal(seen.at(-1).method, 'PATCH'); assert.equal(seen.at(-1).body.scheduledFor, new Date(at).toISOString());
  assert.equal((await Post.listApprovals(pool, V, w)).items.filter((i) => i.kind === 'proposal').length, 0);

  // a person's own schedule goes straight to xeno-post (its approval policies still apply there)
  assert.equal((await Post.schedulePost(pool, E, { ...w, postId: 'p1', at })).scheduled, true);
  await refuses(Post.schedulePost(pool, E, { ...w, postId: 'p1', at: new Date().toISOString() }), 'time_in_past');

  // publish-now and retract need a person and confirm:true
  for (const fn of [Post.publishNow, Post.retractPost]) {
    await refuses(fn(pool, A, { ...w, postId: 'p1', confirm: true }), 'person_required');
    await refuses(fn(pool, E, { ...w, postId: 'p1' }), 'confirmation_required');
    await refuses(fn(pool, V, { ...w, postId: 'p1', confirm: true }), 'editor_required');
  }
  const n = seen.length;
  await Post.publishNow(pool, E, { ...w, postId: 'p1', confirm: true });
  assert.equal(seen.length, n + 1); assert.match(seen.at(-1).url, /p1\/publish-now$/); assert.equal(seen.at(-1).ctype, null, 'no JSON content type on an empty body');
  assert.equal((await Post.retractPost(pool, E, { ...w, postId: 'p1', confirm: true })).post.state, 'retracted');

  // MCP: no tool can publish, retract or approve; propose_schedule never schedules, even for a person
  assert.deepEqual(Mcp.TOOLS.map((t) => t.name).filter((x) => /publish_now|retract|approve|decide/.test(x)), []);
  const m0 = seen.length;
  const r = await Mcp.callTool(pool, E, 'propose_schedule', { workspace: ws, post_id: 'p2', at });
  assert.equal(r.structuredContent.needsConfirmation, true);
  assert.equal(seen.slice(m0).filter((s) => s.method !== 'GET').length, 0, 'the MCP path sent no write to xeno-post');
  await refuses(Mcp.callTool(pool, A, 'draft_post', { workspace: ws, text: 'x', channel_ids: ['ch1'], request_key: 'short' }), 'invalid_request_key');

  console.log('publish-xeno-post: all checks passed');
}

main().then(() => { fake.close(); return pool.end(); }).catch(async (e) => { console.error(e); fake.close(); await pool.end(); process.exit(1); });

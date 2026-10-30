/**
 * XENO Multiplayer join tickets and revocation (services/liveTickets.js; xeno-multiplayer SPEC §2, §6) against a real
 * Postgres and the real route.
 *
 *   - a workspace admin / editor / viewer gets owner / editor / viewer on a spawn.canvas; a stranger gets nothing
 *   - the ticket verifies against the published JWKS: ES256, typ, aud xeno-multiplayer, the discovered issuer,
 *     xeno_resource = the path, ≤120 s, a jti; an agent is kind agent with sub = its person and act.sub = itself
 *   - an unregistered type and a malformed resource are refused; the route answers the same as the service
 *   - revoke() POSTs a platform-signed xeno-live-revoke+jwt to /v1/<type>/<id>/revoke
 *
 *   node src/server/tests/live-tickets.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import express from 'express';

process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const { runAllMigrations } = await import('../services/migrationRunner.js');
const { migrateAccountV2 } = await import('../database/migrate-account-v2.js');
const { writeTuples } = await import('../utils/authzReBAC.js');
const compute = await import('../services/compute.js');
const canvases = await import('../services/spawnCanvases.js');
const { setComputeBackend } = await import('../services/computeBackend.js');
const { jwks } = await import('../utils/oidcProvider.js');
const { issuer } = await import('../config/hosts.js');
const live = await import('../services/liveTickets.js');
const liveRoutes = (await import('../routes/liveRoutes.js')).default;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `lvt${Date.now().toString(36)}`;

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  setComputeBackend({ name: 'fake', create: async () => ({ ref: 'f' }) });
  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['admin', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const m = await compute.createMachine(pool, { id: editor, kind: 'human' }, { workspace: ws, name: 'Canvas', size: 'small' });
  const keys = (await jwks(pool)).keys;
  const verify = (t, typ) => {
    const { header } = jwt.decode(t, { complete: true });
    const jwk = keys.find((k) => k.kid === header.kid);
    const claims = jwt.verify(t, crypto.createPublicKey({ key: jwk, format: 'jwk' }), { algorithms: ['ES256'], audience: 'xeno-multiplayer', issuer: issuer() });
    return { header, claims, typOk: header.typ === typ };
  };
  const canvasId = crypto.randomUUID();
  await canvases.createCanvas(pool, { id: editor, kind: 'human' }, { id: canvasId, name: 'Canvas', machineId: m.id });
  const res = `spawn.canvas/${canvasId}`;
  check(await code(() => live.createTicket(pool, { id: editor, kind: 'human' }, `spawn.canvas/${m.id}`)) !== null, 'a machine id no longer gets a ticket, even for an editor of its workspace');
  const A = (id, kind = 'human', name) => ({ id, kind, display_name: name });

  for (const [who, id, want] of [['owner', owner, 'owner'], ['editor', editor, 'editor'], ['viewer', viewer, 'viewer']]) {
    const t = await live.createTicket(pool, A(id, 'human', who), res);
    const { claims, typOk } = verify(t.ticket, 'xeno-live-ticket+jwt');
    check(typOk && claims.xeno_role === want && claims.sub === String(id) && claims.kind === 'human' && claims.name === who && claims.xeno_resource === res
      && claims.jti && claims.exp - claims.iat <= 120 && !claims.act, `a workspace ${who} gets a verifiable ticket with role ${want}`);
  }
  const et = await live.createTicket(pool, A(editor), res);
  check(et.url === `wss://live.xenosystem.ai/v1/${res}` && et.protocols[0] === 'xeno-live.v1' && et.protocols[1] === `ticket.${et.ticket}`, 'the answer carries the socket URL and the two subprotocols to offer');
  check(await code(() => live.createTicket(pool, A(stranger), res)) === 'not_a_member', 'a stranger gets no ticket');
  check(await code(() => live.createTicket(pool, A(editor), 'docs.doc/abc')) === 'unknown_type', 'a type no app registered is refused');
  for (const bad of ['spawn.canvas', 'spawn/xyz', 'spawn.canvas/has space', 'Spawn.canvas/x', `spawn.canvas/${'a'.repeat(129)}`]) {
    check(await code(() => live.createTicket(pool, A(editor), bad)) === 'invalid_resource', `a malformed resource is refused (${bad.slice(0, 24)})`);
  }
  const at = verify((await live.createTicket(pool, A(agentU, 'agent', 'agent'), res)).ticket, 'xeno-live-ticket+jwt').claims;
  check(at.kind === 'agent' && at.sub === String(owner) && at.act?.sub === String(agentU) && at.xeno_role === 'editor', 'an agent: kind agent, sub = its person, act.sub = itself, never above editor');

  // the route
  const app = express();
  app.use(express.json());
  app.use('/api/live', (req, _r, next) => { req.db = pool; next(); }, liveRoutes);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const post = (who, body) => fetch(`http://127.0.0.1:${srv.address().port}/api/live/tickets`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${jwt.sign({ userId: who }, process.env.JWT_SECRET, { expiresIn: '5m' })}` } : {}) }, body: JSON.stringify(body) });
  const ok = await post(viewer, { resource: res });
  const okBody = await ok.json();
  check(ok.status === 200 && verify(okBody.ticket, 'xeno-live-ticket+jwt').claims.xeno_role === 'viewer', 'POST /api/live/tickets issues the ticket for a signed-in member');
  check((await post(null, { resource: res })).status === 401, 'without sign-in the route refuses');
  const s403 = await post(stranger, { resource: res });
  check(s403.status === 403 && (await s403.json()).code === 'not_a_member', 'the route refuses a stranger with the service’s reason');
  check((await post(editor, { resource: 'docs.doc/x' })).status === 404, 'the route refuses an unregistered type');
  srv.close();

  // revocation
  let got = null;
  const stub = http.createServer((q, r) => { got = { url: q.url, method: q.method, auth: q.headers.authorization }; r.writeHead(200); r.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.XENO_LIVE_URL = `http://127.0.0.1:${stub.address().port}`;
  const rv = await live.revoke(pool, res, viewer);
  const rc = verify(got.auth.replace(/^Bearer /, ''), 'xeno-live-revoke+jwt');
  check(rv.ok && got.method === 'POST' && got.url === `/v1/${res}/revoke`, 'revoke() POSTs to /v1/<type>/<id>/revoke');
  check(rc.typOk && rc.claims.sub === String(viewer) && rc.claims.xeno_resource === res && rc.claims.exp - rc.claims.iat <= 120, 'with a platform-signed xeno-live-revoke+jwt naming the person and the thing');
  stub.close();
  process.env.XENO_LIVE_URL = 'http://127.0.0.1:1';
  check((await live.revoke(pool, res, viewer)).ok === false, 'a service that is down is reported, never thrown into the caller');

  console.log(`\nlive-tickets: ${passed} checks passed`);
}

main().then(() => pool.end(), (e) => { console.error(e); process.exit(1); });

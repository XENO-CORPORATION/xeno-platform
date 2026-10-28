/**
 * XENO Compute named ports (services/computePorts.js), against a real Postgres, the platform's real WebSocket setup
 * (the same handleProtocols + connection branch as index.js) and a stand-in for the machine's server.
 *
 *   - an editor gets a one-use ticket; the socket reaches the machine's server, both ways, text and binary
 *   - the server receives a valid ES256 assertion (aud xeno-spawn, typ, sub, canvas = the machine, role, kind) that
 *     verifies against the platform's published JWKS — and never the caller's token or cookie
 *   - the answered subprotocol is ours, never the ticket; a used, expired or other-port ticket is refused
 *   - a viewer, a stranger, a stopped machine and an unknown port are refused; an admin is the canvas owner; an
 *     agent is `kind: agent` with `act.sub`; a program may sign in with Bearer instead of a ticket
 *   - the platform closes the socket when access ends (editor removed); an open socket counts as use for idle stop
 *
 *   node src/server/tests/compute-ports.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { jwks } from '../utils/oidcProvider.js';
import { createTicket, handlePortConnection, isPortRequest, selectProtocol } from '../services/computePorts.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `cpt${Date.now().toString(36)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The machine's server: records what each connection arrived with, echoes messages.
const seen = [];
const machine = new WebSocketServer({ port: 0 });
machine.on('connection', (sock, req) => {
  seen.push({ url: req.url, headers: req.headers });
  sock.on('message', (d, isBinary) => sock.send(d, { binary: isBinary }));
});
await new Promise((r) => machine.on('listening', r));
const machineUrl = `ws://127.0.0.1:${machine.address().port}`;

const fake = { name: 'fake', create: async () => ({ ref: 'f' }), start: async () => ({ state: 'running' }), stop: async () => ({ state: 'stopped', saved: null, saveError: null }),
  remove: async () => {}, save: async () => ({ saved: { bytes: 1 } }),
  portSocket: (m, name, path) => ({ url: `${machineUrl}/v1/machines/${m.id}/ports/${name}${path}`, headers: { authorization: 'Bearer worker-token' } }) };

// The platform's socket server, configured exactly as index.js does.
let bearerUser = null;
const server = http.createServer((q, s) => { s.writeHead(404); s.end(); });
const wss = new WebSocketServer({ server, handleProtocols: (p, req) => (isPortRequest(req) ? selectProtocol(p) : (p.values().next().value ?? false)) });
wss.on('connection', (ws, req) => {
  if (isPortRequest(req)) handlePortConnection(ws, req, pool, { recheckMs: 300, authenticate: async (r) => (r.headers.authorization === 'Bearer program-token' ? bearerUser : null) });
});
await new Promise((r) => server.listen(0, r));
const site = `ws://127.0.0.1:${server.address().port}`;

/**
 * Open a socket; resolve { ws, protocol } once it has stayed open (the platform accepts the handshake first and then
 * signs the caller in, so a refusal is a close code), or { closed: code, reason } if it is closed.
 */
function open(path, { protocols, headers } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${site}${path}`, protocols, { headers });
    ws.on('open', () => setTimeout(() => resolve({ ws, protocol: ws.protocol }), 400));
    ws.on('close', (c, r) => resolve({ closed: c, reason: String(r) }));
    ws.on('error', () => {});
  });
}
const closeOf = (ws) => new Promise((r) => ws.on('close', (c, why) => r({ code: c, reason: String(why) })));
const roundTrip = (ws, data, binary) => new Promise((r) => { ws.once('message', (d, isBin) => r({ d: Buffer.from(d), isBin })); ws.send(data, { binary }); });

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  setComputeBackend(fake);
  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at, role) VALUES ($1,$2,$3,true,true,'x',NOW(),$4) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s, role])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), staff = await user('staff', 'admin');
  const agentU = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['admin', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, A = { id: agentU, kind: 'agent' };
  const w = { workspace: ws };
  await compute.setRate(pool, { id: staff, kind: 'human', role: 'admin' }, { size: 'small', creditsPerHour: 18 });
  await addGrant(pool, editor, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${tag}-topup` });
  const m = await compute.createMachine(pool, E, { ...w, name: 'Canvas', size: 'small' });
  const keys = (await jwks(pool)).keys;
  const verify = (token) => {
    const { header } = jwt.decode(token, { complete: true });
    const jwk = keys.find((k) => k.kid === header.kid);
    return { header, claims: jwt.verify(token, crypto.createPublicKey({ key: jwk, format: 'jwk' }), { algorithms: ['ES256'], audience: 'xeno-spawn' }) };
  };

  // refused before the machine runs
  check(await code(() => createTicket(pool, E, m.id, 'spawn', w)) === 'machine_not_running', 'no ticket for a machine that is not running');
  await compute.startMachine(pool, E, m.id);
  check(await code(() => createTicket(pool, V, m.id, 'spawn', w)) === 'editor_required', 'a viewer gets no ticket');
  check(await code(() => createTicket(pool, S, m.id, 'spawn', w)) === 'not_a_member', 'a stranger gets no ticket');
  check(await code(() => createTicket(pool, E, m.id, 'shell', w)) === 'unknown_port', 'an undeclared port gets no ticket');

  // an editor connects with a ticket
  await pool.query("UPDATE compute_machines SET last_active_at = now() - interval '2 hours' WHERE id = $1", [m.id]);
  const t = await createTicket(pool, E, m.id, 'spawn', w);
  check(t.path === `/api/compute/machines/${m.id}/ports/spawn/` && t.protocols[0] === 'xeno-port.v1' && /^xeno-ticket\.[A-Za-z0-9_-]{43}$/.test(t.protocols[1]), 'a ticket names the port path and the two subprotocols to offer');
  check((await pool.query('SELECT ticket_hash FROM compute_port_tickets WHERE machine_id = $1', [m.id])).rows.every((r) => !r.ticket_hash.includes(t.protocols[1].slice(12))), 'only the ticket’s hash is stored');
  const c1 = await open(`${t.path}session?x=1`, { protocols: t.protocols, headers: { cookie: 'xeno_session=secret' } });
  check(c1.ws && c1.protocol === 'xeno-port.v1', 'the socket opens, and the answered subprotocol is ours, never the ticket');
  const echoT = await roundTrip(c1.ws, 'hello', false);
  const echoB = await roundTrip(c1.ws, Buffer.from([0, 255, 7]), true);
  check(echoT.d.toString() === 'hello' && !echoT.isBin && echoB.isBin && echoB.d.equals(Buffer.from([0, 255, 7])), 'messages reach the machine’s server and come back, text and binary kept apart');
  const got = seen.at(-1);
  check(got.url === `/v1/machines/${m.id}/ports/spawn/session?x=1`, 'the server gets the path and query after the port prefix');
  check(!got.headers.cookie && !String(got.headers['sec-websocket-protocol'] || '').includes('xeno-ticket'), 'the caller’s cookie and ticket never reach the machine');
  check(got.headers['x-xeno-forwarded-prefix'] === `/api/compute/machines/${m.id}/ports/spawn`, 'the server is told the prefix it is reached under');
  const { header, claims } = verify(got.headers['x-xeno-assertion']);
  check(header.typ === 'xeno-spawn-assertion+jwt' && header.alg === 'ES256', 'the assertion is typed xeno-spawn-assertion+jwt and signed ES256');
  check(claims.sub === String(editor) && claims.xeno_canvas === m.id && claims.xeno_role === 'editor' && claims.kind === 'human' && claims.name === 'editor'
    && claims.xeno_workspace === String(ws) && claims.jti && !claims.act && claims.exp - claims.iat === 60, 'it verifies against the published JWKS and names the person, the canvas (the machine), role editor, kind human, 60 s');
  check(new Date((await pool.query('SELECT last_active_at FROM compute_machines WHERE id = $1', [m.id])).rows[0].last_active_at) > new Date(Date.now() - 60_000), 'connecting counts as use for idle stop');
  check((await compute.getMachine(pool, E, m.id)).events.some((e) => e.kind === 'port_opened' && e.detail.port === 'spawn'), 'the timeline records that the port was opened (not what was said)');

  const reuse = await open(t.path, { protocols: t.protocols });
  check(reuse.closed === 4401, 'a used ticket is refused');
  const t2 = await createTicket(pool, E, m.id, 'spawn', w);
  const other = await open(`/api/compute/machines/${m.id}/ports/notebook/`, { protocols: t2.protocols });
  check(other.closed === 4404, 'an undeclared port is refused');
  await pool.query("UPDATE compute_port_tickets SET created_at = now() - interval '1 minute', expires_at = now() - interval '1 second' WHERE ticket_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [t2.protocols[1].slice(12)]);
  check((await open(t2.path, { protocols: t2.protocols })).closed === 4401, 'an expired ticket is refused');
  check((await open(t2.path)).closed === 4401, 'no ticket and no sign-in is refused');

  // owner, agent, program
  const to = await createTicket(pool, O, m.id, 'spawn', w);
  const c2 = await open(to.path, { protocols: to.protocols });
  await wait(100);
  check(c2.ws && verify(seen.at(-1).headers['x-xeno-assertion']).claims.xeno_role === 'owner', 'a workspace admin is the canvas owner');
  c2.ws.close();
  await pool.query('UPDATE compute_machines SET agent_user_id = $2 WHERE id = $1', [m.id, agentU]);
  const ta = await createTicket(pool, A, m.id, 'spawn', w);
  const c3 = await open(ta.path, { protocols: ta.protocols });
  await wait(100);
  const ac = verify(seen.at(-1).headers['x-xeno-assertion']).claims;
  check(c3.ws && ac.kind === 'agent' && ac.sub === String(owner) && ac.act?.sub === String(agentU) && ac.xeno_role === 'editor', 'an agent connects as kind agent, for its owner, with act.sub, never as owner');
  c3.ws.close();
  await pool.query('UPDATE compute_machines SET agent_user_id = NULL WHERE id = $1', [m.id]);
  bearerUser = String(editor);
  const c4 = await open(`/api/compute/machines/${m.id}/ports/spawn/`, { headers: { authorization: 'Bearer program-token' } });
  await wait(100);
  check(c4.ws && verify(seen.at(-1).headers['x-xeno-assertion']).claims.sub === String(editor), 'a program may sign in with Bearer instead of a ticket');
  check(seen.at(-1).headers.authorization === 'Bearer worker-token', 'the machine side gets only the Worker’s token (the Worker strips it before the machine)');
  c4.ws.close();

  // the platform closes the socket when access ends
  const closing = closeOf(c1.ws);
  await writeTuples(pool, { deletes: [{ object: `workspace:${ws}`, subject: `user:${editor}`, relation: 'editor' }] });
  const closed = await Promise.race([closing, wait(3000).then(() => null)]);
  check(closed && closed.code === 4403, 'removing the editor closes their open socket within the recheck');

  // a stopped machine refuses
  const tE = await createTicket(pool, O, m.id, 'spawn', w);
  await compute.stopMachine(pool, O, m.id);
  check((await open(tE.path, { protocols: tE.protocols })).closed === 4409, 'a ticket for a machine that has since stopped is refused');

  console.log(`\ncompute-ports: ${passed} checks passed`);
}

main().then(() => { wss.close(); server.close(); machine.close(); return pool.end(); }, (e) => { console.error(e); process.exit(1); });

/**
 * XENO Cloud Shell (services/cloudShell.js + the `shell` named port) against a real Postgres, the platform's real
 * WebSocket setup and a stand-in for the machine's terminal server.
 *
 *   - closed unless SHELL_ENABLED names the person (email or @domain); an agent never opens it
 *   - opening finds or creates the person's one Cloud Shell machine and starts it; a second open reuses it
 *   - each connection carries a live xwk_ key for the person's Cloud Shell AGENT (never the person), with read-only
 *     grants in the machine's workspace and nothing that changes data; the key is revoked when the socket closes
 *   - the assertion is for aud xeno-shell
 *
 *   node src/server/tests/cloud-shell.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import * as creds from '../services/workspaceCredentials.js';
import { CATALOGUE } from '../capabilities/catalogue.js';
import { createTicket, handlePortConnection, isPortRequest, selectProtocol } from '../services/computePorts.js';
import { openCloudShell, shellAgent, SHELL_CLIENT } from '../services/cloudShell.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `csh${Date.now().toString(36)}`;

const seen = [];
const machine = new WebSocketServer({ port: 0 });
machine.on('connection', (sock, req) => { seen.push(req.headers); sock.send('$ '); });
await new Promise((r) => machine.on('listening', r));
const machineUrl = `ws://127.0.0.1:${machine.address().port}`;
const starts = [];
setComputeBackend({ name: 'fake', create: async () => ({ ref: 'f' }), start: async (m) => { starts.push(m.id); return { state: 'running' }; },
  stop: async () => ({ state: 'stopped', saved: null, saveError: null }), remove: async () => {}, save: async () => ({ saved: { bytes: 1 } }),
  portSocket: (m, name, path) => ({ url: `${machineUrl}/v1/machines/${m.id}/ports/${name}${path}`, headers: { authorization: 'Bearer worker-token' } }) });

const server = http.createServer((q, s) => { s.writeHead(404); s.end(); });
const wss = new WebSocketServer({ server, handleProtocols: (p, req) => (isPortRequest(req) ? selectProtocol(p) : (p.values().next().value ?? false)) });
wss.on('connection', (ws, req) => { if (isPortRequest(req)) handlePortConnection(ws, req, pool, { recheckMs: 60_000 }); });
await new Promise((r) => server.listen(0, r));
const site = `ws://127.0.0.1:${server.address().port}`;
const open = (path, protocols) => new Promise((resolve) => {
  const ws = new WebSocket(`${site}${path}`, protocols);
  ws.on('message', () => resolve({ ws }));
  ws.on('close', (c, r) => resolve({ closed: c, reason: String(r) }));
  ws.on('error', () => {});
});

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at, role) VALUES ($1,$2,$3,true,true,'x',NOW(),$4) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s, role])).rows[0].id;
  const me = await user('me'), other = await user('other'), staff = await user('staff', 'admin');
  const ME = { id: me, kind: 'human', display_name: 'me' };
  await compute.setRate(pool, { id: staff, kind: 'human', role: 'admin' }, { size: 'small', creditsPerHour: 18 });
  await addGrant(pool, me, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${tag}-topup` });

  // the switch
  delete process.env.SHELL_ENABLED;
  check(await code(() => openCloudShell(pool, ME, { createTicket })) === 'shell_not_enabled', 'with SHELL_ENABLED unset nobody can open Cloud Shell');
  process.env.SHELL_ENABLED = `${tag}_other@xeno.test`;
  check(await code(() => openCloudShell(pool, ME, { createTicket })) === 'shell_not_enabled', 'a person not on the list cannot open it');
  process.env.SHELL_ENABLED = '@xeno.test';
  check(await code(() => openCloudShell(pool, { id: me, kind: 'agent' }, { createTicket })) === 'human_only', 'an agent never opens Cloud Shell');

  // open
  const s1 = await openCloudShell(pool, ME, { createTicket });
  check(/^mch_[0-9a-f]{32}$/.test(s1.machineId) && s1.url === `/workspace/shell/${s1.machineId}` && starts.includes(s1.machineId), 'opening creates the person’s Cloud Shell machine and starts it; the shell has its own id address');
  const s2 = await openCloudShell(pool, ME, { createTicket });
  check(s2.machineId === s1.machineId && (await pool.query("SELECT count(*)::int AS n FROM compute_machines WHERE created_by_user_id = $1 AND purpose = 'cloud-shell'", [me])).rows[0].n === 1, 'a second open reuses the same machine');

  // connect
  const c = await open(`${s2.connect.path}ws`, s2.connect.protocols);
  check(!!c.ws, 'the terminal connects through the platform');
  const h = seen.at(-1);
  const assertion = jwt.decode(h['x-xeno-assertion'], { complete: true });
  check(assertion.header.typ === 'xeno-shell-assertion+jwt' && assertion.payload.aud === 'xeno-shell' && assertion.payload.xeno_canvas === s1.machineId, 'the machine gets an xeno-shell assertion for itself');
  const key = String(h['x-xeno-shell-key'] || '');
  const row = await creds.resolveKey(pool, key);
  const agentId = await shellAgent(pool, me);
  check(/^xwk_/.test(key) && row && String(row.agent_user_id) === agentId && agentId !== String(me) && String(row.owner_user_id) === String(me), 'the shell holds a live xwk_ key for the person’s Cloud Shell AGENT, never the person');
  const bound = (await pool.query('SELECT agent_user_id FROM mcp_client_agent_bindings WHERE owner_user_id = $1 AND client_id = $2', [me, SHELL_CLIENT])).rows[0];
  check(bound && String(bound.agent_user_id) === agentId, 'that agent is the one bound to the xeno-cloud-shell app');
  const grants = (await creds.listGrants(pool, agentId)).filter((g) => g.workspaceId === s1.workspaceId).map((g) => g.capability);
  const cls = new Map(CATALOGUE.map((x) => [x.name, x.class]));
  check(grants.length > 0 && grants.every((g) => cls.get(g) === 'safe'), 'it may READ in the machine’s workspace and nothing that changes data until the person grants it');
  check(!h.cookie && h.authorization === 'Bearer worker-token', 'no platform cookie or sign-in reaches the machine');

  // close → key revoked
  c.ws.close();
  await wait(300);
  check((await creds.resolveKey(pool, key)) === null, 'closing the terminal revokes its key');

  // a person without the switch, even with a ticket path, is refused at the ticket
  process.env.SHELL_ENABLED = `${tag}_me@xeno.test`;
  const otherWs = (await pool.query('SELECT id FROM workspaces WHERE owner_user_id = $1', [other])).rows[0];
  check(await code(() => createTicket(pool, { id: other, kind: 'human' }, s1.machineId, 'shell')) !== null, 'someone else gets no ticket to my shell');
  void otherWs;

  console.log(`\ncloud-shell: ${passed} checks passed`);
}

main().then(() => { wss.close(); server.close(); machine.close(); return pool.end(); }, (e) => { console.error(e); process.exit(1); });

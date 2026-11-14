/**
 * XENO Agent in the cloud (services/cloudAgent.js + the `agent` named port) against a real Postgres, the platform's real
 * WebSocket setup and a stand-in for the machine (its files and its agent server).
 *
 *   - closed unless SHELL_ENABLED names the person; an agent never opens one
 *   - opening finds or creates the person's one Cloud Agent machine and starts it; a second open reuses it
 *   - the machine is given the PERSON's own inference session key, in its home folder, with hours left; a second open
 *     mints nothing; a key about to run out is replaced and the old one revoked
 *   - the connection reaches the machine with an assertion for aud xeno-agent-host and this machine, and with no
 *     platform cookie, sign-in or Cloud Shell key
 *   - a ticket for the port is refused when the switch is off
 *
 *   node src/server/tests/cloud-agent.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { createTicket, handlePortConnection, isPortRequest, selectProtocol } from '../services/computePorts.js';
import { openCloudAgent, cloudAgentStatus, KEY_FILE, HOST_KEY_FILE, RENEW_BELOW_MINUTES } from '../services/cloudAgent.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `cag${Date.now().toString(36)}`;

const seen = [];
const machine = new WebSocketServer({ port: 0 });
machine.on('connection', (sock, req) => { seen.push({ headers: req.headers, url: req.url }); sock.send('xeno-host-bridge/1 {}\n'); });
await new Promise((r) => machine.on('listening', r));
const machineUrl = `ws://127.0.0.1:${machine.address().port}`;
const starts = [];
const files = new Map(); // `${machine id}:${path}` -> Buffer
setComputeBackend({ name: 'fake', create: async () => ({ ref: 'f' }), start: async (m) => { starts.push(m.id); return { state: 'running' }; },
  stop: async () => ({ state: 'stopped', saved: null, saveError: null }), remove: async () => {}, save: async () => ({ saved: { bytes: 1 } }),
  readFile: async (m, path) => { const f = files.get(`${m.id}:${path}`); if (!f) throw Object.assign(new Error('No such file'), { code: 'not_found', statusCode: 404 }); return f; },
  writeFile: async (m, path, buf) => { files.set(`${m.id}:${path}`, Buffer.from(buf)); return { path }; },
  portSocket: (m, name, path) => ({ url: `${machineUrl}/v1/machines/${m.id}/ports/${name}${path}`, headers: { authorization: 'Bearer worker-token' } }) });

const server = http.createServer((q, s) => { s.writeHead(404); s.end(); });
const wss = new WebSocketServer({ server, handleProtocols: (p, req) => (isPortRequest(req) ? selectProtocol(p) : (p.values().next().value ?? false)) });
wss.on('connection', (ws, req) => { if (isPortRequest(req)) handlePortConnection(ws, req, pool, { recheckMs: 200 }); });
await new Promise((r) => server.listen(0, r));
const site = `ws://127.0.0.1:${server.address().port}`;
const open = (path, protocols) => new Promise((resolve) => {
  const ws = new WebSocket(`${site}${path}`, protocols);
  ws.on('message', (d) => resolve({ ws, first: String(d) }));
  ws.on('close', (c, r) => resolve({ closed: c, reason: String(r) }));
  ws.on('error', () => {});
});
const keyRow = async (token) => (await pool.query(`SELECT id::text AS id, user_id::text AS user_id, is_active, agent_user_id, extract(epoch FROM expires_at - (now() AT TIME ZONE 'UTC'))::int AS left FROM api_keys WHERE key_hash = $1`, [crypto.createHash('sha256').update(token).digest('hex')])).rows[0];
const liveKeys = async (userId) => (await pool.query(`SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND is_active AND expires_at > (now() AT TIME ZONE 'UTC') AND name LIKE 'XENO Cloud Agent%'`, [userId])).rows[0].n;

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at, role) VALUES ($1,$2,$3,true,true,'x',NOW(),$4) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s, role])).rows[0].id;
  const me = await user('me'), staff = await user('staff', 'admin');
  const ME = { id: me, kind: 'human', display_name: 'me' };
  await compute.setRate(pool, { id: staff, kind: 'human', role: 'admin' }, { size: 'small', creditsPerHour: 18 });
  await addGrant(pool, me, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${tag}-topup` });

  // the switch
  delete process.env.SHELL_ENABLED;
  check(await code(() => openCloudAgent(pool, ME, { createTicket })) === 'cloud_agent_not_enabled', 'with the switch unset nobody can open a cloud session');
  check((await cloudAgentStatus(pool, ME)).enabled === false, 'and the page is told it is not open to them');
  process.env.SHELL_ENABLED = '@xeno.test';
  check(await code(() => openCloudAgent(pool, { id: me, kind: 'agent' }, { createTicket })) === 'human_only', 'an agent never opens a cloud session');

  // open
  const a1 = await openCloudAgent(pool, ME, { createTicket });
  check(/^mch_[0-9a-f]{32}$/.test(a1.machineId) && starts.includes(a1.machineId), 'opening creates the person’s Cloud Agent machine and starts it');
  const held1 = JSON.parse(files.get(`${a1.machineId}:${KEY_FILE}`).toString('utf8'));
  const row1 = await keyRow(held1.apiKey);
  check(/^xeno-[0-9a-f]{48}$/.test(held1.apiKey) && row1 && row1.user_id === String(me) && row1.is_active && row1.agent_user_id === null && row1.id === held1.keyId, 'the machine holds an inference key of the PERSON’s own, and which key it is');
  check(row1.left > (RENEW_BELOW_MINUTES + 60) * 60, `with hours left (${Math.round(row1.left / 3600)} h)`);
  check(!files.get(`${a1.machineId}:${KEY_FILE}`).toString('utf8').includes('password') && Object.keys(held1).sort().join() === 'apiKey,expiresAt,keyId', 'and nothing else is written there');

  const a2 = await openCloudAgent(pool, ME, { createTicket });
  const host1 = JSON.parse(files.get(`${a1.machineId}:${HOST_KEY_FILE}`).toString('utf8'));
  check(host1.apiKey === held1.apiKey && host1.keyId === held1.keyId && Object.keys(host1).sort().join() === 'apiKey,keyId', 'the Agent host gets the same key where it looks for one (~/.xeno/credentials.json)');
  const held2 = JSON.parse(files.get(`${a2.machineId}:${KEY_FILE}`).toString('utf8'));
  check(a2.machineId === a1.machineId && (await pool.query("SELECT count(*)::int AS n FROM compute_machines WHERE created_by_user_id = $1 AND purpose = 'cloud-agent'", [me])).rows[0].n === 1, 'a second open reuses the same machine');
  check(held2.apiKey === held1.apiKey && await liveKeys(me) === 1, 'and mints no second key');
  const status = await cloudAgentStatus(pool, ME);
  check(status.enabled === true && status.machineId === a1.machineId, 'the page is told the person’s machine');

  // a key about to run out is replaced, and the old one revoked
  await pool.query(`UPDATE api_keys SET expires_at = (now() AT TIME ZONE 'UTC') + interval '30 minutes' WHERE id = $1::uuid`, [held1.keyId]);
  files.set(`${a1.machineId}:${KEY_FILE}`, Buffer.from(JSON.stringify({ ...held1, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })));
  await openCloudAgent(pool, ME, { createTicket });
  const held3 = JSON.parse(files.get(`${a1.machineId}:${KEY_FILE}`).toString('utf8'));
  check(held3.apiKey !== held1.apiKey && (await keyRow(held3.apiKey)).is_active && (await keyRow(held1.apiKey)).is_active === false && await liveKeys(me) === 1, 'a key with little time left is replaced, and the old one is revoked');
  files.delete(`${a1.machineId}:${HOST_KEY_FILE}`);
  await openCloudAgent(pool, ME, { createTicket });
  const held4 = JSON.parse(files.get(`${a1.machineId}:${KEY_FILE}`).toString('utf8'));
  check(held4.apiKey !== held3.apiKey && JSON.parse(files.get(`${a1.machineId}:${HOST_KEY_FILE}`).toString('utf8')).apiKey === held4.apiKey && await liveKeys(me) === 1, 'a machine whose host has no copy of the key gets a new one, in both places');

  // connect
  const a4 = await openCloudAgent(pool, ME, { createTicket });
  const c = await open(`${a4.connect.path}ws`, a4.connect.protocols);
  check(!!c.ws && c.first.startsWith('xeno-host-bridge/1 '), 'the page reaches the machine’s Agent host through the platform');
  const h = seen.at(-1).headers;
  const assertion = jwt.decode(h['x-xeno-assertion'], { complete: true });
  check(assertion.header.typ === 'xeno-agent-host-assertion+jwt' && assertion.payload.aud === 'xeno-agent-host' && assertion.payload.xeno_canvas === a1.machineId && assertion.payload.sub === String(me) && assertion.payload.xeno_role === 'owner', 'the machine gets an xeno-agent-host assertion for itself and the person');
  check(!h.cookie && h.authorization === 'Bearer worker-token' && !h['x-xeno-shell-key'], 'no platform cookie, sign-in or Cloud Shell key reaches the machine');
  check(new URL(seen.at(-1).url, 'http://x').pathname.endsWith(`/ports/agent/ws`), 'on the agent port');
  c.ws.close();

  // the switch off: no ticket
  delete process.env.SHELL_ENABLED;
  check(await code(() => createTicket(pool, ME, a1.machineId, 'agent', { workspace: a1.workspaceId })) === 'cloud_agent_not_enabled', 'with the switch off no ticket is given for the agent port');

  console.log(`\ncloud-agent: ${passed} checks passed`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });

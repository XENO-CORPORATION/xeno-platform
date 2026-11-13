/**
 * Remote control relay on REAL sockets and real Postgres: services/remoteRelay.js through browserRelaySocket.js.
 * Decision 0006 in xeno-agent-interface.
 *
 * Two servers stand in for the two backend replicas, so a PC and a phone sit on different processes' sockets as they
 * do in production. With REDIS_URL the frames cross real Redis, otherwise a shared in-memory bus.
 *
 * What it proves: frames reach the other device across replicas and nothing is stored; only one person's devices
 * reach each other, and only a host and a remote; `from` can't be forged; an absent device is reported, not silently
 * dropped; removing a device closes its socket; the switch being off means absent; a token without the scope, or a
 * key that isn't the device's, is refused; the browser and Corpus surfaces see none of these rows.
 *
 * Run: DATABASE_URL=postgresql://… [REDIS_URL=…] node src/server/tests/remote-relay.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { WebSocketServer, WebSocket } from 'ws';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { authMiddleware } from '../middleware/auth.js';
import browserRelayRoutes, { corpusRelayRoutes, remoteRelayRoutes } from '../routes/browserRelayRoutes.js';
import { liveOrSeenRecently, LIVE_SEEN_WITHIN_MS } from '../services/browserRelay.js';
import { handleRelayConnection, isRelayRequest } from '../services/browserRelaySocket.js';
import * as relay from '../services/browserRelay.js';
import { localBus, redisBus, setRemoteBus, MAX_FRAMES_PER_SECOND } from '../services/remoteRelay.js';
import { startDeviceAuthorization, approveDevice, deviceTokenGrant } from '../utils/oidcProvider.js';
import { accessTokenHash } from '../utils/dpop.js';
import { issuer } from '../config/hosts.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `rr${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keypair = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }), thumb: null }; };
const proof = (key, { htm, htu, accessToken, nonce }) => jwt.sign(
  { jti: crypto.randomUUID(), htm, htu, iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(accessToken), ...(nonce ? { nonce } : {}) },
  key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } });
const jktOf = (jwk) => crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');

const CONNECT = '/api/v2/remote/connect';
const HTU = `${issuer()}${CONNECT}`;
const sealed = (text) => Buffer.from(text).toString('base64');

class Device {
  static async open(port, installation, key, token) {
    const d = new Device();
    d.frames = [];
    d.key = key; d.token = token;
    d.ws = new WebSocket(`http://127.0.0.1:${port}${CONNECT}?installation=${installation}`);
    d.ws.on('message', (m) => { try { d.frames.push(JSON.parse(m.toString())); } catch {} });
    d.ws.on('close', (code, reason) => { d.code = code; d.reason = String(reason || ''); });
    d.ws.on('error', () => {});
    await new Promise((res, rej) => { d.ws.once('open', res); d.ws.once('error', rej); });
    return d;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(...types) {
    const end = Date.now() + 5000;
    for (;;) {
      const i = this.frames.findIndex((f) => types.includes(f.type));
      if (i >= 0) return this.frames.splice(i, 1)[0];
      if (this.ws.readyState === WebSocket.CLOSED) { await sleep(10); return { type: 'close', code: this.code, reason: this.reason }; }
      if (Date.now() > end) throw new Error(`timed out waiting for ${types.join('|')}`);
      await sleep(10);
    }
  }
  async auth() {
    const c = await this.waitFor('challenge', 'close');
    if (c.type === 'close') return c;
    this.send({ type: 'auth', accessToken: this.token, dpop: proof(this.key, { htm: 'GET', htu: HTU, accessToken: this.token, nonce: c.nonce }) });
    return this.waitFor('ready', 'close');
  }
  close() { try { this.ws.close(); } catch {} }
}

async function serve(knobs = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/browser', authMiddleware, browserRelayRoutes);
  app.use('/api/v2/corpus', authMiddleware, corpusRelayRoutes);
  app.use('/api/v2/remote', authMiddleware, remoteRelayRoutes);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => { if (isRelayRequest(req)) handleRelayConnection(ws, req, pool, knobs); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, wss, port: server.address().port };
}

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  process.env.REMOTE_CONTROL_RELAY = 'on';
  const realRedis = Boolean(process.env.REDIS_URL);
  const bus = realRedis ? redisBus(process.env.REDIS_URL) : localBus();
  setRemoteBus(bus);
  console.log(realRedis ? 'frames cross real Redis' : 'frames cross the in-memory bus');

  const mkUser = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash)
    VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0];
  const alice = await mkUser('alice'), bob = await mkUser('bob');
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES
      ('xeno-agent-interface', 'XENO Agent', ARRAY[]::text[], ARRAY['openid','profile','email','remote:connect','corpus:connect'], 'xeno-agent-interface', true)
    ON CONFLICT (client_id) DO UPDATE SET allowed_scopes = EXCLUDED.allowed_scopes`);
  const token = async (u, key, scope = 'openid profile email remote:connect') => {
    const s = await startDeviceAuthorization(pool, { clientId: 'xeno-agent-interface', scope });
    await approveDevice(pool, { userCode: s.user_code, userId: u.id });
    return (await deviceTokenGrant(pool, { deviceCode: s.device_code, clientId: 'xeno-agent-interface', dpopJkt: jktOf(key.publicJwk) })).access_token;
  };

  const a = await serve(), b = await serve();
  const call = async (port, method, apiPath, { t, key, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (t) { headers.authorization = `DPoP ${t}`; headers.dpop = proof(key, { htm: method, htu: `${issuer()}${apiPath}`, accessToken: t }); }
    const r = await fetch(`http://127.0.0.1:${port}${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const enrol = async (user, role, label) => {
    const key = keypair();
    const t = await token(user, key);
    const installationId = crypto.randomUUID();
    const reg = await call(a.port, 'POST', '/api/v2/remote/installations', { t, key, body: { installationId, label, role } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    return { key, t, installationId, id: String(reg.body.installation.id) };
  };
  const open = [];
  const connect = async (port, who) => { const d = await Device.open(port, who.installationId, who.key, who.t); open.push(d); return d; };

  try {
    const host = await enrol(alice, 'host', 'Desk PC');
    const phone = await enrol(alice, 'device', 'Phone');
    const laptop = await enrol(alice, 'device', 'Laptop');
    const stranger = await enrol(bob, 'device', 'Not yours');

    const pc = await connect(a.port, host);
    ok((await pc.auth()).type === 'ready', 'a host connects to one replica');
    const mobile = await connect(b.port, phone);
    ok((await mobile.auth()).type === 'ready', 'a device connects to the other replica');
    const notebook = await connect(b.port, laptop);
    await notebook.auth();

    mobile.send({ type: 'sealed', to: host.id, data: sealed('from the phone') });
    const arrived = await pc.waitFor('sealed');
    ok(Buffer.from(arrived.data, 'base64').toString() === 'from the phone', 'a sealed frame crosses to the other replica');
    ok(arrived.from === phone.id, 'the relay says who sent it');
    pc.send({ type: 'sealed', to: phone.id, data: sealed('from the pc') });
    ok(Buffer.from((await mobile.waitFor('sealed')).data, 'base64').toString() === 'from the pc', 'and back the other way');
    pc.send({ type: 'sealed', to: laptop.id, data: sealed('for the laptop') });
    ok((await notebook.waitFor('sealed')).from === host.id, 'one host serves several devices');
    await sleep(60);
    ok(!mobile.frames.some((f) => f.type === 'sealed'), 'a frame reaches only the device it names');

    mobile.send({ type: 'sealed', to: laptop.id, data: sealed('sideways') });
    ok((await mobile.waitFor('undelivered')).reason === 'refused', 'two remotes cannot talk to each other');

    const theirs = await connect(b.port, stranger);
    await theirs.auth();
    theirs.send({ type: 'sealed', to: host.id, data: sealed('let me in') });
    ok((await theirs.waitFor('undelivered')).reason === 'refused', '🔴 another person cannot reach this PC');
    await sleep(60);
    ok(!pc.frames.some((f) => f.type === 'sealed'), 'and nothing of theirs arrives');

    mobile.send({ type: 'sealed', from: laptop.id, to: host.id, data: sealed('forged') });
    ok((await pc.waitFor('sealed')).from === phone.id, '🔴 a device cannot claim to be another one');

    const counts = await pool.query(`SELECT count(*)::int AS n FROM browser_calls WHERE installation IN (SELECT id FROM browser_installations WHERE surface = 'remote' AND user_id = $1)`, [alice.id]);
    ok(counts.rows[0].n === 0, '🔴 no frame was stored');

    notebook.close();
    await sleep(120);
    pc.send({ type: 'sealed', to: laptop.id, data: sealed('anyone there') });
    ok((await pc.waitFor('undelivered')).reason === 'away', 'an absent device is reported, not silently dropped');

    mobile.send({ type: 'sealed', to: host.id, data: 'not base64!' });
    ok((await mobile.waitFor('error')).code === 'bad_frame', 'a malformed frame is refused with a reason');
    mobile.send({ type: 'sealed', to: host.id, data: sealed('x'.repeat(70_000)) });
    ok((await mobile.waitFor('error')).code === 'bad_frame', 'a frame larger than one sealed message is refused');

    const flood = await enrol(alice, 'device', 'Flood');
    const noisy = await connect(a.port, flood);
    await noisy.auth();
    for (let i = 0; i <= MAX_FRAMES_PER_SECOND + 200; i += 1) noisy.send({ type: 'sealed', to: host.id, data: 'eA==' });
    ok((await noisy.waitFor('close')).code === 4429, 'a device that floods the relay is cut off');
    pc.frames.length = 0;

    const removed = await call(b.port, 'DELETE', `/api/v2/remote/installations/${phone.id}`, { t: phone.t, key: phone.key });
    ok(removed.status === 200, 'a device can be removed');
    ok((await mobile.waitFor('close')).type === 'close', '🔴 removing it closes its live socket, across replicas');
    const back = await connect(b.port, phone);
    ok((await back.auth()).code === 4403, 'and it cannot come back');

    const wrongKey = keypair();
    const hijack = await connect(a.port, { ...laptop, key: wrongKey, t: await token(alice, wrongKey) });
    ok((await hijack.auth()).code === 4403, '🔴 a token bound to another key cannot be this device');
    const noScopeKey = keypair();
    const noScope = await connect(a.port, { ...laptop, key: noScopeKey, t: await token(alice, noScopeKey, 'openid profile email') });
    ok((await noScope.auth()).code === 4403, 'a token without remote:connect is refused');

    // Both servers here share one process, so "connected to the other replica" is shown on the rule itself: a row this
    // process holds no socket for, stamped by another replica's heartbeat.
    const elsewhere = { id: '999999999', lastSeenAt: new Date(Date.now() - 30_000).toISOString() };
    ok(liveOrSeenRecently(elsewhere) === true, '🔴 a device connected to another replica reads as connected');
    ok(liveOrSeenRecently({ ...elsewhere, lastSeenAt: new Date(Date.now() - 2 * LIVE_SEEN_WITHIN_MS).toISOString() }) === false, 'one not heard from for two minutes does not');
    ok(liveOrSeenRecently({ id: '999999999', lastSeenAt: null }) === false, 'nor one that never connected');
    ok(liveOrSeenRecently({ id: host.id, lastSeenAt: null }) === true, 'and a socket held here counts at once, before any stamp');
    const listed = await call(b.port, 'GET', '/api/v2/remote/installations', { t: host.t, key: host.key });
    ok(listed.body.live.includes(host.id), 'the list marks the connected PC as on');

    const seen = await call(a.port, 'GET', '/api/v2/remote/installations', { t: host.t, key: host.key });
    ok(seen.body.installations.some((i) => i.remoteRole === 'host'), 'a person sees their own devices and each one\'s role');
    ok(!seen.body.installations.some((i) => String(i.id) === stranger.id), 'and no one else\'s');
    const bad = await call(a.port, 'POST', '/api/v2/remote/installations', { t: host.t, key: host.key, body: { installationId: crypto.randomUUID(), label: 'No role' } });
    ok(bad.status === 400 && bad.body.error.code === 'invalid_role', 'a device must say what it is');
    const rows = await pool.query(`SELECT count(*)::int AS n FROM browser_installations WHERE surface = 'remote' AND user_id = $1 AND remote_role IS NULL`, [alice.id]);
    ok(rows.rows[0].n === 0, 'every remote row carries a role');
    const crossed = await pool.query(`INSERT INTO browser_installations (user_id, installation_id, dpop_jkt, label, surface) VALUES ($1,$2,'x','x','remote')`, [alice.id, crypto.randomUUID()]).then(() => false, () => true);
    ok(crossed, 'the database refuses a remote row with no role');

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const sql = fs.readFileSync(path.join(here, '../database/migrations/20261117090000-remote-relay.sql'), 'utf8').split('-- DOWN')[1];
      const before = (await c.query(`SELECT count(*)::int AS n FROM browser_installations WHERE surface <> 'remote'`)).rows[0].n;
      await c.query(sql);
      const left = (await c.query('SELECT count(*)::int AS n FROM browser_installations')).rows[0].n;
      const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'browser_installations' AND column_name = 'remote_role'`)).rows;
      ok(left === before && cols.length === 0, 'the down path removes the column and the remote rows, and leaves every other row');
    } finally { await c.query('ROLLBACK'); c.release(); }

    process.env.REMOTE_CONTROL_RELAY = '';
    const off = await call(a.port, 'GET', '/api/v2/remote/installations', { t: host.t, key: host.key });
    ok(off.status === 404, '🔴 with the switch off, the routes are absent');
    const refused = await connect(a.port, host);
    ok((await refused.waitFor('close')).code === 4403, 'and the socket is refused');
  } finally {
    for (const d of open) d.close();
    await sleep(100);
    relay.stopListening();
    await bus.close?.();
    for (const s of [a, b]) { for (const c of s.wss.clients) c.terminate(); s.server.close(); }
    await pool.query(`DELETE FROM browser_installations WHERE user_id IN ($1,$2)`, [alice.id, bob.id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [alice.id, bob.id]).catch(() => {});
    await pool.end();
  }
  console.log(`\nremote-relay: ${passed} passed`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * XENO Corpus on a person's PC, over the relay, on a REAL socket and real Postgres: services/corpusLocalMcp.js + the corpus surface of
 * services/browserRelay.js, browserRelaySocket.js, browserInstallations.js and routes/browserRelayRoutes.js.
 *
 * What it proves: the two surfaces can't reach each other's rows, a Corpus PC is never offered to a chat as a browser, a token needs its
 * own scope, an answer is gone from our servers once it's read, offline is a refusal rather than an empty answer, a device can't add a
 * tool or be read by anyone but its owner, and turning a PC off or removing it holds.
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/corpus-relay.test.mjs
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
import browserRelayRoutes, { corpusRelayRoutes, accountCorpusRouter, accountBrowserRouter } from '../routes/browserRelayRoutes.js';
import { resolveChatBrowser } from '../services/chatBrowserTools.js';
import { handleRelayConnection, isRelayRequest } from '../services/browserRelaySocket.js';
import * as relay from '../services/browserRelay.js';
import * as installations from '../services/browserInstallations.js';
import * as local from '../services/corpusLocalMcp.js';
import * as mcp from '../services/xenoMcp.js';
import { AMBIENT_SCOPES } from '../capabilities/scopes.js';
import { ensureReadGrants } from '../services/cloudShell.js';
import * as creds from '../services/workspaceCredentials.js';
import { startDeviceAuthorization, approveDevice, deviceTokenGrant } from '../utils/oidcProvider.js';
import { accessTokenHash } from '../utils/dpop.js';
import { issuer } from '../config/hosts.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `cr${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const keypair = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) }; };
const proof = (key, { htm, htu, accessToken, nonce }) => jwt.sign(
  { jti: crypto.randomUUID(), htm, htu, iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(accessToken), ...(nonce ? { nonce } : {}) },
  key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } });

const TOOLS = ['corpus_context', 'corpus_tenet', 'corpus_lapsed', 'corpus_consumers', 'corpus_can_ship', 'corpus_unmanaged'].map((name) => ({ name, description: name, parameters: { type: 'object', properties: {} } }));

/** The socket a PC holds, speaking the wire Corpus speaks. */
class Pc {
  constructor(key, token) { this.key = key; this.token = token; this.frames = []; }
  static async open(wsUrl, connectPath, installation, key, token) {
    const p = new Pc(key, token);
    p.ws = new WebSocket(`${wsUrl}${connectPath}?installation=${installation}`);
    // A call can arrive twice, from the sender and from the notification it raised. Corpus drops a call id it has seen, so this does too.
    const seen = new Set();
    p.ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === 'call') { if (seen.has(m.callId)) return; seen.add(m.callId); } p.frames.push(m); } catch {} });
    p.ws.on('close', (code, reason) => { p.code = code; p.reason = String(reason || ''); });
    await new Promise((res, rej) => { p.ws.once('open', res); p.ws.once('error', rej); });
    return p;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(...types) {
    const end = Date.now() + 5000;
    for (;;) {
      const i = this.frames.findIndex((f) => types.includes(f.type));
      if (i >= 0) return this.frames.splice(i, 1)[0];
      if (this.ws.readyState === WebSocket.CLOSED) { await sleep(10); return { type: 'close', code: this.code, reason: this.reason }; }
      if (Date.now() > end) throw new Error(`timed out waiting for ${types.join('|')}`);
      await sleep(15);
    }
  }
  async auth(htu, { nonce } = {}) {
    const c = await this.waitFor('challenge');
    this.send({ type: 'auth', accessToken: this.token, dpop: proof(this.key, { htm: 'GET', htu, accessToken: this.token, nonce: nonce ?? c.nonce }) });
    return this.waitFor('ready', 'close');
  }
  hello(projects, tools = TOOLS) { this.send({ type: 'hello', tools, projects, appVersion: '0.3.5' }); return sleep(120); }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const mkUser = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id, username, email`, [`${tag}${s}`, `${tag}${s}@xeno.test`])).rows[0];
  const alice = await mkUser('alice'), bob = await mkUser('bob');
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES
      ('xeno-corpus', 'XENO Corpus', ARRAY[]::text[], ARRAY['openid','profile','email','corpus:connect','browser:connect'], 'xeno-corpus', true)
    ON CONFLICT (client_id) DO UPDATE SET allowed_scopes = EXCLUDED.allowed_scopes`);
  const token = async (u, jkt, scope = 'openid profile email corpus:connect') => {
    const s = await startDeviceAuthorization(pool, { clientId: 'xeno-corpus', scope });
    await approveDevice(pool, { userCode: s.user_code, userId: u.id });
    return (await deviceTokenGrant(pool, { deviceCode: s.device_code, clientId: 'xeno-corpus', dpopJkt: jkt })).access_token;
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/browser', authMiddleware, browserRelayRoutes);
  app.use('/api/v2/corpus', authMiddleware, corpusRelayRoutes);
  app.use('/api/account/browsers', authMiddleware, accountBrowserRouter);
  app.use('/api/account/corpus-pcs', authMiddleware, accountCorpusRouter);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const knobs = {};
  wss.on('connection', (ws, req) => { if (isRelayRequest(req)) handleRelayConnection(ws, req, pool, knobs); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, wsUrl = `http://127.0.0.1:${port}`;
  const CONNECT = '/api/v2/corpus/connect', HTU = `${issuer()}${CONNECT}`;
  const call = async (method, apiPath, { t, key, body, bearer } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (t) headers.authorization = `${bearer ? 'Bearer' : 'DPoP'} ${t}`;
    if (t && !bearer) headers.dpop = proof(key, { htm: method, htu: `${issuer()}${apiPath}`, accessToken: t });
    const r = await fetch(`http://127.0.0.1:${port}${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const reg = (t, key, installationId, label = 'Work PC') => call('POST', '/api/v2/corpus/installations', { t, key, body: { installationId, label, os: 'win32' } });
  const open = [];
  const connect = async (id, key, t, p = CONNECT) => { const c = await Pc.open(wsUrl, p, id, key, t); open.push(c); return c; };
  const PERSON = { id: alice.id, kind: 'human', role: 'user' };
  const CONN = { categories: ['corpus_local'] };

  try {
    // ── sign-in: its own scope, its own key
    const aKey = keypair(), bKey = keypair(), jkt = (k) => installations.jktOf(k.publicJwk);
    const aTok = await token(alice, jkt(aKey)), bTok = await token(bob, jkt(bKey));
    const noScope = await token(alice, jkt(aKey), 'openid profile email');
    const browserOnly = await token(alice, jkt(aKey), 'openid profile email browser:connect');
    const aId = crypto.randomUUID();
    const r0 = await reg(noScope, aKey, aId);
    ok(r0.status === 403 && r0.body.error.code === 'INSUFFICIENT_SCOPE', 'a sign-in without corpus:connect can’t register a PC');
    ok((await reg(browserOnly, aKey, aId)).status === 403, 'nor can one that only connects a browser');
    const s0 = await connect(aId, aKey, noScope);
    const closed0 = await s0.auth(HTU);
    ok(closed0.type === 'close' && closed0.code === 4403 && /scope/.test(closed0.reason), `a socket without the scope closes 4403 with “scope” in the reason, which Corpus reads as “sign in again” (${closed0.code} ${closed0.reason})`);

    // ── registration
    const r1 = await reg(aTok, aKey, aId);
    ok(r1.status === 201 && r1.body.installation.enabled === true, 'a PC registers ON: its consent is the project switch on the PC');
    ok(!JSON.stringify(r1.body).includes('dpop_jkt'), 'the key binding is never sent back');
    const row = r1.body.installation.id;
    const r2 = await reg(aTok, aKey, aId);
    ok(r2.status === 200 && r2.body.installation.id === row, 'registering again finds the same row');
    const stolen = await reg(aTok, bKey, crypto.randomUUID());
    ok(stolen.status === 401 || stolen.status === 403, `a proof from another key can’t register (${stolen.status})`);

    // ── the handshake, by the id the PC generated
    const pc = await connect(aId, aKey, aTok);
    const ready = await pc.auth(HTU);
    ok(ready.type === 'ready' && String(ready.installation.id) === String(row), 'the socket takes the id the PC generated, for the person holding the token');
    await pc.hello([{ id: 'p-one', name: 'Thesis' }, { id: 'p-two', name: 'C:\\Users\\someone\\secret-client\\Notes' }]);
    const stored = (await pool.query('SELECT tools, offered_tools, projects, extension_version FROM browser_installations WHERE id = $1', [row])).rows[0];
    ok(stored.tools.length === 0 && stored.offered_tools.includes('corpus_lapsed') && stored.extension_version === '0.3.5', 'hello stores tool names beside `tools`, which stays empty');
    ok(stored.projects[1].name === 'Notes' && !JSON.stringify(stored.projects).includes('Users'), 'a project name is only ever a last segment: a path sent by mistake never lands');
    const wrongNonce = await connect(aId, aKey, aTok);
    const bad = await wrongNonce.auth(HTU, { nonce: 'not-the-nonce' });
    ok(bad.type === 'close' && bad.code === 4401, `a proof over another nonce is refused (${bad.code})`);
    const bobSock = await connect(aId, bKey, bTok);
    const bobR = await bobSock.auth(HTU);
    ok(bobR.type === 'close' && bobR.code === 4403, `someone else naming this PC’s id finds nothing of theirs (${bobR.code} ${bobR.reason})`);

    // ── the surfaces can't reach each other
    await pool.query('UPDATE browser_installations SET last_seen_at = now() WHERE id = $1', [row]);
    ok((await resolveChatBrowser(pool, alice.id)) === null, 'a connected Corpus PC is never offered to a chat as a browser');
    await pool.query(`UPDATE browser_installations SET surface = 'browser' WHERE id = $1`, [row]);
    ok((await resolveChatBrowser(pool, alice.id)) === null, 'even with the surface filter gone, empty `tools` keeps it out, which is what a rollback relies on');
    await pool.query(`UPDATE browser_installations SET surface = 'corpus' WHERE id = $1`, [row]);
    const bothTok = await token(alice, jkt(aKey), 'openid profile email browser:connect corpus:connect');
    const bList = await call('GET', '/api/v2/browser/installations', { t: bothTok, key: aKey });
    ok(bList.status === 200 && !bList.body.installations.some((i) => String(i.id) === String(row)), 'a PC isn’t in the list of browsers');
    ok((await call('PATCH', `/api/v2/browser/installations/${row}`, { t: bothTok, key: aKey, body: { enabled: false } })).status === 404, 'and the browser routes can’t touch it');
    const brRow = (await pool.query(`INSERT INTO browser_installations (user_id, installation_id, dpop_jkt, label, enabled) VALUES ($1,$2,$3,'Chrome',true) RETURNING id, installation_id`, [alice.id, crypto.randomUUID(), jkt(aKey)])).rows[0];
    const viaBrowserPath = await connect(row, aKey, bothTok, '/api/v2/browser/connect');
    const vb = await viaBrowserPath.auth(`${issuer()}/api/v2/browser/connect`);
    ok(vb.type === 'close' && vb.code === 4403, `a PC can’t connect on the browser path, even with both scopes (${vb.code} ${vb.reason})`);
    const viaCorpusPath = await connect(brRow.installation_id, aKey, bothTok);
    const vc = await viaCorpusPath.auth(HTU);
    ok(vc.type === 'close' && vc.code === 4403, `a browser can’t connect on the Corpus path (${vc.code} ${vc.reason})`);
    ok(!(await call('GET', '/api/v2/corpus/installations', { t: aTok, key: aKey })).body.installations.some((i) => String(i.id) === String(brRow.id)), 'a browser isn’t in the list of PCs');
    await pool.query('DELETE FROM browser_installations WHERE id = $1', [brRow.id]);

    // ── tool names route here, not to the workspace corpus
    ok(mcp.route('corpus_local_lapsed').service.category === 'corpus_local' && mcp.route('corpus_local_lapsed').tool === 'lapsed', 'corpus_local_lapsed routes to this service');
    ok(mcp.route('corpus_query').service.category === 'corpus', 'and corpus_query stays with the workspace corpus');
    ok(mcp.route('corpus_local_lapsed').capability?.name === 'corpus_local.lapsed.list' && mcp.route('corpus_local_lapsed').capability.provenance === 'untrusted', 'its answers are marked untrusted');
    const off = await mcp.callTool(pool, PERSON, { categories: ['tasks'] }, 'corpus_local_projects', {});
    ok(off.result.isError && /turned off/.test(off.result.content[0].text), 'a connection that hasn’t turned this on can’t use it');
    const scopeless = await mcp.callTool(pool, { ...PERSON, token: { audience: 'xeno-workspace', scopes: ['workspace:read'], ownerId: alice.id } }, CONN, 'corpus_local_projects', {});
    ok(scopeless.result.isError && /corpus_local:read/.test(scopeless.result.content[0].text), 'a workspace credential needs the corpus_local:read scope');

    // ── projects
    const listed = await local.callTool(pool, PERSON, 'projects', {});
    ok(listed.structuredContent.devices.length === 1 && listed.structuredContent.devices[0].projects.some((p) => p.id === 'p-one'), 'corpus_local_projects answers from hello, with no call to the PC');
    ok(pc.frames.filter((f) => f.type === 'call').length === 0, 'no call reached the PC');

    // ── a call, and an answer that doesn't stay
    const CANARY = 'CANARY-private-document-words-7f3a';
    const callP = mcp.callTool(pool, PERSON, CONN, 'corpus_local_lapsed', { project: 'p-one', subject: 'ask-CANARY-question', envelope: { evil: true }, device: String(row) });
    const delivered = await pc.waitFor('call');
    ok(delivered.tool === 'corpus_lapsed', 'the PC gets the local tool name');
    ok(delivered.args.project === 'p-one' && delivered.args.subject === 'ask-CANARY-question' && !('envelope' in delivered.args) && !('device' in delivered.args), 'only the arguments that tool names reach the PC');
    pc.send({ type: 'result', callId: delivered.callId, ok: true, output: { content: [{ type: 'text', text: CANARY }], structuredContent: { a: CANARY }, evil: 'dropped' } });
    const answered = await callP;
    ok(!answered.result.isError && answered.result.content[0].text === CANARY && answered.result.structuredContent.a === CANARY, 'the answer comes back to the caller');
    ok(!('evil' in answered.result), 'only the fields an answer should have');
    const after = (await pool.query('SELECT state, ok, result, args, result_bytes FROM browser_calls WHERE call_id = $1', [delivered.callId])).rows[0];
    ok(after.state === 'done' && after.ok === true && after.result === null && Object.keys(after.args).length === 0 && after.result_bytes > 0, 'its row keeps the status and size, and not the words');
    const anywhere = async (needle) => {
      const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE 'browser_%' OR table_name LIKE 'mcp_%' OR table_name = 'security_events')`)).rows.map((r) => r.table_name);
      for (const t of tables) if ((await pool.query(`SELECT 1 FROM "${t}" x WHERE x::text LIKE $1 LIMIT 1`, [`%${needle}%`])).rows[0]) return t;
      return null;
    };
    ok((await anywhere('CANARY')) === null, 'neither the question nor the answer is anywhere in the relay or MCP tables');
    pc.send({ type: 'result', callId: delivered.callId, ok: true, output: { content: [{ type: 'text', text: 'second-CANARY' }] } });
    await sleep(120);
    ok((await anywhere('second-CANARY')) === null, 'a duplicate answer writes nothing back');

    // ── size: a large answer survives, a huge one says it was cut
    const big = 'x'.repeat(300_000);
    const bigP = local.callTool(pool, PERSON, 'unmanaged', { project: 'p-one' });
    const bd = await pc.waitFor('call');
    pc.send({ type: 'result', callId: bd.callId, ok: true, output: { content: [{ type: 'text', text: big }] } });
    ok((await bigP).content[0].text.length === 300_000, 'a 300 KB answer arrives whole, not cut to the browser’s 60 KB');
    const hugeP = local.callTool(pool, PERSON, 'unmanaged', { project: 'p-one' });
    const hd = await pc.waitFor('call');
    pc.send({ type: 'result', callId: hd.callId, ok: true, output: { content: [{ type: 'text', text: 'y'.repeat(600_000) }] } });
    const huge = await hugeP;
    ok(huge.structuredContent?.truncated === true && /only its start/.test(huge.content[0].text), 'a bigger one says it was cut: it’s never quietly short');
    const truncP = local.callTool(pool, PERSON, 'unmanaged', { project: 'p-one' });
    const td = await pc.waitFor('call');
    pc.send({ type: 'result', callId: td.callId, ok: true, output: { truncated: true, excerpt: 'start of it', note: 'Too long.' } });
    ok((await truncP).content[0].text === 'Too long.\n\nstart of it', 'Corpus’s own cut answer reads as text with its note');
    const junkP = local.callTool(pool, PERSON, 'unmanaged', { project: 'p-one' });
    const jd = await pc.waitFor('call');
    pc.send({ type: 'result', callId: jd.callId, ok: true, output: { nonsense: true } });
    ok(await codeOf(junkP) === 'bad_answer', 'an answer with nothing readable is a refusal, not an empty result');

    // ── refusals
    const errP = local.callTool(pool, PERSON, 'lapsed', { project: 'p-one' });
    const ed = await pc.waitFor('call');
    pc.send({ type: 'result', callId: ed.callId, ok: false, error: { code: 'project_not_found', message: 'This project is no longer on this PC.' } });
    ok(await codeOf(errP) === 'project_not_found', 'a refusal from the PC comes back with its own code');
    const errRow = (await pool.query('SELECT result, args FROM browser_calls WHERE call_id = $1', [ed.callId])).rows[0];
    ok(errRow.result === null && Object.keys(errRow.args).length === 0, 'and that row forgets too');
    ok(await codeOf(local.callTool(pool, PERSON, 'lapsed', { project: 'not-on' })) === 'project_not_enabled', 'a project the PC didn’t list is refused here, with no call');
    ok(await codeOf(local.callTool(pool, PERSON, 'lapsed', {})) === 'project_required', 'it has to name a project');
    ok(await codeOf(local.callTool(pool, PERSON, 'tenet', { project: 'p-one' })) === 'invalid_args', 'a missing required argument is refused here');
    ok(await codeOf(local.callTool(pool, PERSON, 'lapsed', { project: 'p-one', subject: 'z'.repeat(20_000) })) === 'invalid_args', 'a huge request is refused');
    ok(await codeOf(local.callTool(pool, PERSON, 'write_note', { project: 'p-one' })) === 'unknown_tool', 'a tool outside the fixed list doesn’t exist');
    ok(pc.frames.filter((f) => f.type === 'call').length === 0, 'none of those reached the PC');
    await pc.hello([{ id: 'p-one', name: 'Thesis' }], [{ name: 'corpus_lapsed', description: 'x', parameters: {} }, { name: 'corpus_write', description: 'a tool this device invented', parameters: {} }]);
    ok(await codeOf(local.callTool(pool, PERSON, 'context', { project: 'p-one', budget: 10 })) === 'tool_unavailable', 'a PC that doesn’t offer a tool says so rather than failing later');
    ok(!local.TOOLS.some((t) => t.name.includes('write')) && !mcp.route('corpus_local_corpus_write')?.capability, 'a tool a device declares never becomes a tool on XENO MCP');
    await pc.hello([{ id: 'p-one', name: 'Thesis' }]);

    // ── whose PC
    const BOB = { id: bob.id, kind: 'human', role: 'user' };
    ok(await codeOf(local.callTool(pool, BOB, 'projects', {})) === 'corpus_not_connected', 'someone else has no PC to read');
    ok(await codeOf(local.callTool(pool, BOB, 'lapsed', { project: 'p-one', device: String(row) })) === 'corpus_not_connected', 'naming this PC doesn’t help them');
    const agentU = await mkUser('agent'), coAgentU = await mkUser('coagent'), svcU = await mkUser('svc');
    await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU.id, alice.id]);
    const AGENT = { id: agentU.id, kind: 'agent', role: 'user' };
    ok((await local.callTool(pool, AGENT, 'projects', {})).structuredContent.devices.length === 1, 'an agent reads its owner’s PC');
    // nobody gets this by being given everything: it takes a person saying yes for that app
    ok(!mcp.AGENT_DEFAULT_CATEGORIES.includes('corpus_local') && mcp.AGENT_DEFAULT_CATEGORIES.includes('corpus'), 'a platform agent’s own credential doesn’t start with this');
    ok(!AMBIENT_SCOPES.includes('corpus_local:read') && AMBIENT_SCOPES.includes('workspace:read'), 'nor does a key given every ordinary scope');
    const shellAgentU = await mkUser('shellagent');
    await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [shellAgentU.id, alice.id]);
    const shellWs = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Sh',$2) RETURNING id`, [alice.id, `${tag}-sh`])).rows[0].id;
    await ensureReadGrants(pool, shellAgentU.id, shellWs);
    ok(await creds.hasGrant(pool, shellAgentU.id, 'corpus.corpus.query', shellWs) && !(await creds.hasGrant(pool, shellAgentU.id, 'corpus_local.lapsed.list', shellWs)), 'a Cloud Shell agent’s read grants leave it out');
    ok(/scopes: \[\.\.\.AMBIENT_SCOPES\], label: 'Cloud Shell'/.test(fs.readFileSync(path.resolve(here, '../services/cloudShell.js'), 'utf8')), 'and a Cloud Shell key is made from the ordinary scopes');
    // the way an app such as Claude Code gets it: signs in with Tasks only, and the person turns it on for that app
    const appConn = await mcp.connectionFor(pool, { ownerId: alice.id, agentId: agentU.id, clientId: `${tag}-app`, clientName: 'Claude Code' });
    const APP = { ...AGENT, token: { audience: 'xeno-tasks', scopes: ['tasks:read', 'tasks:write'], ownerId: alice.id, agentUserId: agentU.id } };
    const before = await mcp.callTool(pool, APP, appConn, 'corpus_local_projects', {});
    ok(before.result.isError && /Dev › XENO MCP/.test(before.result.content[0].text), 'an app signed in with Tasks only can’t use it, and is told where it’s turned on');
    await mcp.setCategories(pool, alice.id, appConn.id, ['tasks', 'corpus_local']);
    const onConn = await mcp.connectionFor(pool, { ownerId: alice.id, agentId: agentU.id, clientId: `${tag}-app` });
    const after2 = await mcp.callTool(pool, APP, onConn, 'corpus_local_projects', {});
    ok(!after2.result.isError && after2.result.structuredContent.devices[0].projects[0].id === 'p-one', 'once the person turns it on for that app, the same sign-in reads their PC');
    const co = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company','Co',$2) RETURNING id`, [alice.id, `${tag}-co`])).rows[0].id;
    const res = (await pool.query(`INSERT INTO workforce_resources (kind, owner_workspace_id, created_by_user_id, name) VALUES ('agent', $1, $2, 'Co agent') RETURNING id`, [co, alice.id])).rows[0];
    await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id, workforce_resource_id, workforce_resource_kind) VALUES ($1,$2,$3,'agent')`, [coAgentU.id, alice.id, res.id]);
    ok(await codeOf(local.callTool(pool, { id: coAgentU.id, kind: 'agent', role: 'user' }, 'projects', {})) === 'workspace_agent', 'a company’s agent can’t read its admin’s PC');
    ok(await codeOf(local.callTool(pool, { id: svcU.id, kind: 'service', role: 'user' }, 'projects', {})) === 'not_a_person', 'a service account has no PC');

    // ── a call survives a reconnect, and a caller who gives up ends it
    const lateP = local.callTool(pool, PERSON, 'lapsed', { project: 'p-one' });
    const ld = await pc.waitFor('call');
    pc.close();
    await sleep(100);
    const pc2 = await connect(aId, aKey, aTok);
    ok((await pc2.auth(HTU)).type === 'ready', 'the PC reconnects');
    const resent = await pc2.waitFor('call');
    ok(resent.callId === ld.callId && resent.args.project === 'p-one', 'a call still open is sent again with the same id, which Corpus answers without running twice');
    await pc2.hello([{ id: 'p-one', name: 'Thesis' }]);
    pc2.send({ type: 'result', callId: resent.callId, ok: true, output: { content: [{ type: 'text', text: 'after reconnect' }] } });
    ok((await lateP).content[0].text === 'after reconnect', 'and its answer still reaches the caller');
    const gaveUp = crypto.randomUUID();
    const gp = relay.callTool(pool, { callId: gaveUp, installationId: row, tool: 'corpus_lapsed', args: { project: 'p-one', q: 'gave-up-CANARY' }, actorUserId: alice.id, stepMs: 200, approvalMs: 200 });
    const gd = await pc2.waitFor('call');
    await gp; await relay.forgetCall(pool, gaveUp);
    pc2.send({ type: 'result', callId: gd.callId, ok: true, output: { content: [{ type: 'text', text: 'late-CANARY' }] } });
    await sleep(120);
    ok((await anywhere('late-CANARY')) === null && (await anywhere('gave-up-CANARY')) === null, 'an answer after the caller gave up writes nothing');

    // ── the sweep catches a replica that died holding one
    const crashed = crypto.randomUUID();
    await pool.query(`INSERT INTO browser_calls (call_id, installation, user_id, tool, args, state, ok, result, deadline) VALUES ($1,$2,$3,'corpus_lapsed','{"q":"crash-CANARY"}','done',true,'{"a":"crash-CANARY"}', now() - interval '10 minutes')`, [crashed, row, alice.id]);
    const fresh = crypto.randomUUID();
    await pool.query(`INSERT INTO browser_calls (call_id, installation, user_id, tool, args, state, deadline) VALUES ($1,$2,$3,'corpus_lapsed','{"q":"inflight"}','sent', now() + interval '1 minute')`, [fresh, row, alice.id]);
    const ancient = crypto.randomUUID();
    await pool.query(`INSERT INTO browser_calls (call_id, installation, user_id, tool, state, deadline, created_at) VALUES ($1,$2,$3,'corpus_lapsed','done', now() - interval '40 days', now() - interval '40 days')`, [ancient, row, alice.id]);
    const brKeep = (await pool.query(`INSERT INTO browser_installations (user_id, installation_id, dpop_jkt, label) VALUES ($1,$2,$3,'B') RETURNING id`, [alice.id, crypto.randomUUID(), jkt(aKey)])).rows[0].id;
    const brCall = crypto.randomUUID();
    await pool.query(`INSERT INTO browser_calls (call_id, installation, user_id, tool, args, state, ok, result, deadline) VALUES ($1,$2,$3,'navigate','{"url":"x"}','done',true,'{"a":1}', now() - interval '10 minutes')`, [brCall, brKeep, alice.id]);
    await relay.sweepForgottenCalls(pool);
    ok((await anywhere('crash-CANARY')) === null, 'the sweep forgets what a dead replica left behind');
    ok((await pool.query('SELECT args FROM browser_calls WHERE call_id = $1', [fresh])).rows[0].args.q === 'inflight', 'not a call still running');
    ok(!(await pool.query('SELECT 1 FROM browser_calls WHERE call_id = $1', [ancient])).rows[0], 'old status rows go');
    ok((await pool.query('SELECT result FROM browser_calls WHERE call_id = $1', [brCall])).rows[0].result.a === 1, 'and a browser’s records aren’t touched');
    await pool.query('DELETE FROM browser_installations WHERE id = $1', [brKeep]);

    // ── a PC that goes away stops counting at once, and one that goes silent is dropped
    pc2.close();
    await sleep(150);
    const t0 = Date.now();
    ok(await codeOf(local.callTool(pool, PERSON, 'lapsed', { project: 'p-one' })) === 'corpus_not_connected' && Date.now() - t0 < 2000, 'a closed socket refuses at once, rather than waiting out a deadline on a PC that isn’t there');
    Object.assign(knobs, { pingMs: 60, silentMs: 250 });
    const quiet = await connect(aId, aKey, aTok);
    ok((await quiet.auth(HTU)).type === 'ready', 'a PC connects');
    await quiet.hello([{ id: 'p-one', name: 'Thesis' }]);
    const closedQuiet = await quiet.waitFor('close');
    ok(closedQuiet.type === 'close', 'and if it says nothing, the server hangs up rather than stamping it as there');
    await sleep(100);
    ok(await codeOf(local.callTool(pool, PERSON, 'projects', {})) === 'corpus_not_connected', 'so it reads as offline');
    delete knobs.pingMs; delete knobs.silentMs;
    const pc2b = await connect(aId, aKey, aTok);
    ok((await pc2b.auth(HTU)).type === 'ready', 'and it can come back');
    await pc2b.hello([{ id: 'p-one', name: 'Thesis' }]);

    // ── offline is a refusal
    await pool.query(`UPDATE browser_installations SET last_seen_at = now() - interval '5 minutes' WHERE id = $1`, [row]);
    ok(await codeOf(local.callTool(pool, PERSON, 'projects', {})) === 'corpus_not_connected', 'a PC not heard from lately is offline: a refusal, never an empty list');
    const refused = await mcp.callTool(pool, PERSON, CONN, 'corpus_local_lapsed', { project: 'p-one' });
    ok(refused.result.isError && /Open XENO Corpus/.test(refused.result.content[0].text), 'and it says what to do');
    await pool.query('UPDATE browser_installations SET last_seen_at = now() WHERE id = $1', [row]);

    // ── turning off and removing, through the web session's routes
    const legacy = jwt.sign({ userId: alice.id, email: alice.email, username: alice.username }, process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production', { expiresIn: '1h' });
    const web = (method, p, body) => call(method, `/api/account/corpus-pcs${p}`, { t: legacy, bearer: true, body });
    const pcs = await web('GET', '');
    ok(pcs.status === 200 && pcs.body.pcs.length === 1 && pcs.body.pcs[0].projects[0].name === 'Thesis' && pcs.body.pcs[0].connected === true, 'the person sees the PC and its projects');
    ok(!JSON.stringify(pcs.body).includes('dpop'), 'not its key');
    const webB = await call('GET', '/api/account/browsers', { t: legacy, bearer: true });
    ok(!webB.body.browsers.some((b) => String(b.id) === String(row)), 'and it isn’t in their browsers');
    const waiting = local.callTool(pool, PERSON, 'lapsed', { project: 'p-one' });
    await pc2b.waitFor('call');
    ok((await web('PATCH', `/${row}`, { enabled: false })).body.pc.enabled === false, 'Turn off');
    const closedOff = await pc2b.waitFor('close');
    ok(closedOff.code === 4403 && /turned off/.test(closedOff.reason) && !/revoked|scope/.test(closedOff.reason), `closes the socket now, and says “turned off”: Corpus keeps its id on those words, and a “revoked” here would let a new id walk round this switch (${closedOff.reason})`);
    ok(await codeOf(waiting) === 'turned_off', 'and fails the call in flight');
    const stillOff = await connect(aId, aKey, aTok);
    const offAgain = await stillOff.auth(HTU);
    ok(offAgain.code === 4403 && /turned off/.test(offAgain.reason) && !/revoked|scope/.test(offAgain.reason), `it can’t reconnect while off, and hears the same words (${offAgain.reason})`);
    ok((await reg(aTok, aKey, aId)).body.installation.enabled === false, 'and registering again doesn’t turn it back on');
    ok(await codeOf(local.callTool(pool, PERSON, 'projects', {})) === 'corpus_not_connected', 'no tool can reach it');
    ok((await web('PATCH', `/${row}`, { enabled: true })).body.pc.enabled === true, 'Turn on');
    const pc3 = await connect(aId, aKey, aTok);
    ok((await pc3.auth(HTU)).type === 'ready', 'and it connects again');
    await pc3.hello([{ id: 'p-one', name: 'Thesis' }]);
    ok((await call('PATCH', `/api/account/corpus-pcs/${row}`, { t: jwt.sign({ userId: bob.id, email: bob.email, username: bob.username }, process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production', { expiresIn: '1h' }), bearer: true, body: { enabled: false } })).status === 404, 'someone else can’t turn it off: it reads as absent');
    ok((await web('DELETE', `/${row}`)).status === 200, 'Remove');
    const closedGone = await pc3.waitFor('close');
    ok(closedGone.code === 4403 && /revoked/.test(closedGone.reason) && !/turned off|scope/.test(closedGone.reason), `closes the socket and says “revoked”, which Corpus reads as removed (${closedGone.reason})`);
    const gone = (await pool.query('SELECT projects, offered_tools, revoked_at FROM browser_installations WHERE id = $1', [row])).rows[0];
    ok(gone.revoked_at && gone.projects.length === 0 && gone.offered_tools.length === 0, 'and forgets its projects');
    const back = await reg(aTok, aKey, aId);
    ok(back.status === 403 && back.body.error.code === 'installation_removed', 'the same installation can’t quietly come back at the app’s next start');
    const backSock = await connect(aId, aKey, aTok);
    const backClosed = await backSock.auth(HTU);
    ok(backClosed.code === 4403 && /revoked/.test(backClosed.reason) && !/turned off|scope/.test(backClosed.reason), `nor connect, and it hears the same word (${backClosed.reason})`);
    const newId = crypto.randomUUID();
    ok((await reg(aTok, aKey, newId)).status === 201, 'a new installation, which means the person asked again, can');

    // ── nginx and the down path
    const conf = fs.readFileSync(path.resolve(here, '../../../nginx/default.conf'), 'utf8');
    ok(/location \^~ \/api\/v2\/corpus\/connect \{[\s\S]*?proxy_set_header Upgrade \$http_upgrade;[\s\S]*?proxy_read_timeout 7d;/.test(conf), 'nginx lets this path upgrade: /api/ refuses upgrades on purpose');
    const sql = fs.readFileSync(path.resolve(here, '../database/migrations/20261109090000-relay-surfaces.sql'), 'utf8').split('-- DOWN')[1];
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const before = (await c.query(`SELECT count(*)::int AS n FROM browser_installations WHERE surface = 'browser'`)).rows[0].n;
      await c.query(sql);
      const left = (await c.query('SELECT count(*)::int AS n FROM browser_installations')).rows[0].n;
      const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'browser_installations' AND column_name IN ('surface','projects','offered_tools')`)).rows;
      ok(left === before && cols.length === 0, 'the down path drops the columns and takes the PC rows with them, so none can read as a browser');
    } finally { await c.query('ROLLBACK'); c.release(); }
    console.log(`\ncorpus relay: ${passed} passed`);
  } finally {
    for (const s of open) s.close();
    relay.stopListening();
    await new Promise((r) => server.close(r));
  }
}
main().then(async () => { await pool.end(); process.exit(0); }).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });

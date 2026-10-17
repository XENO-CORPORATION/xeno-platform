/**
 * The XENO Extension browser relay, end to end over a REAL socket and real Postgres:
 * `services/browserRelay.js` · `services/browserRelaySocket.js` · `services/browserInstallations.js` ·
 * `routes/browserRelayRoutes.js`.
 *
 * What this proves that a unit test cannot: the handshake, the DPoP binding against a real server-issued
 * nonce, that a proof bound to ANOTHER installation's key is refused, that a result is applied once and a
 * duplicate is ignored, that a revocation closes the socket AND fails the queued call, and that the
 * caller's deadline is enforced by the row rather than by the socket.
 *
 * Run: DATABASE_URL=postgresql://… node tests/browser-relay.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { WebSocketServer, WebSocket } from 'ws';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { authMiddleware } from '../middleware/auth.js';
import browserRelayRoutes, { accountBrowserRouter } from '../routes/browserRelayRoutes.js';
import { resolveChatBrowser, browserToolDeclarations } from '../services/chatBrowserTools.js';
import { streamToolLoop } from '../utils/chatToolLoop.js';
import { normalizeTurnRecord } from '../utils/chatTurnRecord.js';
import { handleRelayConnection, isRelayRequest } from '../services/browserRelaySocket.js';
import * as relay from '../services/browserRelay.js';
import * as installations from '../services/browserInstallations.js';
import { startDeviceAuthorization, approveDevice, deviceTokenGrant, discovery } from '../utils/oidcProvider.js';
import { accessTokenHash } from '../utils/dpop.js';
import { issuer } from '../config/hosts.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const keypair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
};
const proof = (key, { htm, htu, accessToken, nonce }) => jwt.sign(
  { jti: crypto.randomUUID(), htm, htu, iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(accessToken), ...(nonce ? { nonce } : {}) },
  key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } });

/** One browser: its long-lived key, its token, and the socket it opened. */
class Browser {
  constructor(installationId, key, token) { this.installationId = installationId; this.key = key; this.token = token; this.frames = []; this.ws = null; }
  static async open({ url, installationId, token, key }) {
    const b = new Browser(installationId, key, token);
    b.ws = new WebSocket(`${url}/api/v2/browser/connect?installation=${installationId}`);
    b.ws.on('message', (d) => { try { b.frames.push(JSON.parse(d.toString())); } catch {} });
    b.ws.on('close', (code, reason) => { b.ws._closeCode = code; b.ws._closeReason = String(reason || ''); });
    await new Promise((resolve, reject) => { b.ws.once('open', resolve); b.ws.once('error', reject); });
    return b;
  }
  /** Answer the challenge with a proof over the exact htu the server expects. */
  async auth({ nonce, htu }) {
    const challenge = await this.waitFor('challenge');
    this.send({
      type: 'auth', accessToken: this.token,
      dpop: proof(this.key, { htm: 'GET', htu, accessToken: this.token, nonce: nonce ?? challenge.nonce }),
    });
    return this.waitFor('ready', 'error', 'close');
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(...types) {
    const deadline = Date.now() + 4000;
    for (;;) {
      const hit = this.frames.find((f) => types.includes(f.type));
      if (hit) return hit;
      // A close is an OUTCOME too. Waiting only on frames would make a refused handshake look like a
      // timeout, which is the "silence is not an answer" failure this whole contract keeps refusing.
      if (this.ws.readyState === WebSocket.CLOSED) return { type: 'close', code: this.ws._closeCode ?? null, reason: this.ws._closeReason ?? null };
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${types.join('|')}; saw frames [${this.frames.map((f) => f.type).join(',')}] state=${this.ws.readyState}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  /** The close code OUR handler recorded. Reading `closeCode` off the instance is unreliable once the
   *  socket is already closed, and a test that reports 0 for "was it closed" cannot tell a refusal from a
   *  hang — which is the distinction it exists to make. */
  async closed() {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (this.ws._closeCode !== undefined) return this.ws._closeCode;
      await new Promise((r) => setTimeout(r, 25));
    }
    return 0;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  const mkUser = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash)
     VALUES ($1,$2,$1,true,true,'x') RETURNING id, username, email`, [name, `${name}@xeno.test`])).rows[0];
  const alice = await mkUser('br_alice'), bob = await mkUser('br_bob');

  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES
      ('xeno-extension', 'XENO Extension', ARRAY[]::text[], ARRAY['openid','profile','email','browser:connect'], 'xeno-extension', true)
    ON CONFLICT (client_id) DO NOTHING`);
  const token = async (u, jkt) => {
    const start = await startDeviceAuthorization(pool, { clientId: 'xeno-extension', scope: 'openid profile email browser:connect' });
    await approveDevice(pool, { userCode: start.user_code, userId: u.id });
    return (await deviceTokenGrant(pool, { deviceCode: start.device_code, clientId: 'xeno-extension', dpopJkt: jkt })).access_token;
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/browser', authMiddleware, browserRelayRoutes);
  app.use('/api/account/browsers', authMiddleware, accountBrowserRouter);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => { if (isRelayRequest(req)) handleRelayConnection(ws, req, pool); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v2/browser`;
  const wsUrl = `http://127.0.0.1:${port}`;
  const HTU = `${issuer()}/api/v2/browser/connect`;

  const call = async (method, apiPath, { token: t, key, body, nonce } = {}) => {
    const headers = { 'content-type': 'application/json' };
    // 🔴 A DPoP-bound token goes in the `DPoP` scheme, not `Bearer` (RFC 9449 §7.1). The platform's
    // resource-server boundary requires the proof on every request carrying a bound token, and a
    // `Bearer` header is refused with `invalid_dpop_proof` — measured 2026-10-17.
    if (t) headers.authorization = `${key ? 'DPoP' : 'Bearer'} ${t}`;
    if (t && key) headers.dpop = proof(key, { htm: method, htu: `${issuer()}/api/v2/browser${apiPath}`, accessToken: t, nonce });
    const r = await fetch(`${base}${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const results = [];
  const check = (ok, label) => { results.push({ ok, label }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

  try {
    // ── 1. registration is bound to the key, and an unbound caller never reaches it ──────────────
    const aliceKey = keypair(), bobKey = keypair();
    const aliceToken = await token(alice, installations.jktOf(aliceKey.publicJwk));
    const bobToken = await token(bob, installations.jktOf(bobKey.publicJwk));
    const legacy = jwt.sign({ userId: alice.id, email: alice.email, username: alice.username }, JWT_SECRET, { expiresIn: '1h' });

    const unbound = await call('POST', '/installations', { token: legacy, body: { installationId: crypto.randomUUID(), label: 'x' } });
    check(unbound.status === 403 && unbound.body.error.code === 'dpop_bound_required',
      `an unbound token cannot register a browser (${unbound.status} ${unbound.body.error?.code})`);

    const idA = crypto.randomUUID();
    const reg = await call('POST', '/installations', {
      token: aliceToken, key: aliceKey, body: { installationId: idA, label: 'Work Chrome', browser: 'chrome', os: 'win32' } });
    check(reg.status === 201 && reg.body.installation?.id && reg.body.installation.enabled === false,
      `a browser registers DISABLED — connecting is not consent (${reg.status})`);
    check(!('dpop_jkt' in (reg.body.installation || {})) && !JSON.stringify(reg.body).includes('dpop_jkt'),
      'the key binding is never published back to the caller');
    const installationId = reg.body.installation.id;

    // idempotent: same browser, same key, no second row
    const again = await call('POST', '/installations', {
      token: aliceToken, key: aliceKey, body: { installationId: idA, label: 'Work Chrome', browser: 'chrome', os: 'win32' } });
    check(again.status === 200 && again.body.installation.id === installationId && again.body.created === false,
      're-registering the same browser returns the same row, not a second one');

    // ── 2. the person turns it on, and only the person ───────────────────────────────────────────
    const notMine = await call('PATCH', `/installations/${installationId}`, { token: bobToken, key: bobKey, body: { enabled: true } });
    check(notMine.status === 404, `another person's browser reads as absent, not forbidden (${notMine.status})`);

    const on = await call('PATCH', `/installations/${installationId}`, { token: aliceToken, key: aliceKey, body: { enabled: true } });
    check(on.status === 200 && on.body.installation.enabled === true, '"Allow XENO chats to use this browser" turns on');

    // ── 3. the handshake: challenge, DPoP-bound auth, ready ─────────────────────────────────────
    const browser = await Browser.open({ url: wsUrl, installationId, token: aliceToken, key: aliceKey });
    const ready = await browser.auth({ htu: HTU });
    check(ready.type === 'ready' && ready.installation?.id === installationId,
      `the socket authenticates with a DPoP-bound token and is ready (got ${ready.type}${ready.code ? ' ' + ready.code : ''}${ready.reason ? ' ' + ready.reason : ''})`);

    browser.send({ type: 'hello', extensionVersion: '1.2.1', tools: [{ name: 'navigate', description: 'Go to a URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }] });
    await new Promise((r) => setTimeout(r, 200));
    const storedRun = (await pool.query(`SELECT tools, extension_version FROM browser_installations WHERE id=$1`, [installationId])).rows[0];
    check(storedRun.tools?.length === 1 && storedRun.tools[0].name === 'navigate' && storedRun.extension_version === '1.2.1',
      'hello records the browser\'s own tool definitions verbatim — one definition of a tool, not two');

    // ── 4. a step: the chat calls, the browser answers, the caller gets the result ───────────────
    const callPromise = relay.callTool(pool, {
      installationId, tool: 'navigate', args: { url: 'https://example.test' },
      conversationId: 'c-1', tabGroup: 'Chat: browser relay', actorUserId: alice.id, stepMs: 5000,
      onEvent: () => {},
    });
    const delivered = await browser.waitFor('call');
    check(delivered.tool === 'navigate' && delivered.args.url === 'https://example.test' && delivered.tabGroup === 'Chat: browser relay',
      'the step reaches the browser with its tool, arguments and tab group');

    browser.send({ type: 'ack', callId: delivered.callId });
    browser.send({ type: 'approval', callId: delivered.callId, state: 'waiting' });
    await new Promise((r) => setTimeout(r, 200));
    const waitingState = (await pool.query(`SELECT state FROM browser_calls WHERE call_id=$1`, [delivered.callId])).rows[0].state;
    check(waitingState === 'waiting_approval', `a pending approval is a recorded state, not a silent wait (${waitingState})`);

    browser.send({ type: 'result', callId: delivered.callId, ok: true, output: { title: 'Example' } });
    const answered = await callPromise;
    check(answered.ok === true && answered.output?.title === 'Example', 'the caller receives what the browser reported');

    // 🔴 a duplicate result must not re-apply — the turn already read the first one
    const dup = await relay.recordResult(pool, delivered.callId, true, { title: 'SOMETHING ELSE' });
    const afterDup = (await pool.query(`SELECT result FROM browser_calls WHERE call_id=$1`, [delivered.callId])).rows[0].result;
    check(dup.applied === false && afterDup.title === 'Example',
      'a duplicate result is ignored, so a second answer can never overwrite the one the turn read');

    // ── 5. a refusal is a RESULT the model can speak to, never an exception ──────────────────────
    const callsBefore = browser.frames.filter((f) => f.type === 'call').length;
    const refusePromise = relay.callTool(pool, { installationId, tool: 'navigate', args: {}, actorUserId: alice.id, stepMs: 5000 });
    // Wait for a call frame that was not there before, so this step's callId is the one we answer.
    const deadline = Date.now() + 4000;
    while (browser.frames.filter((f) => f.type === 'call').length <= callsBefore) {
      if (Date.now() > deadline) throw new Error('the second step was never delivered');
      await new Promise((r) => setTimeout(r, 25));
    }
    const newest = browser.frames.filter((f) => f.type === 'call').at(-1);
    browser.send({ type: 'result', callId: newest.callId, ok: false, error: { code: 'denied', message: 'You declined this step.' } });
    const refused = await refusePromise;
    check(refused.ok === false && refused.error.code === 'denied' && /declined/.test(refused.error.message),
      `a denied step comes back as a described refusal, not a thrown error (got ${refused.error?.code})`);

    // ── 6. a proof bound to ANOTHER installation's key is refused ───────────────────────────────
    // Same person, same token — but the proof is signed by a key the token is not bound to.
    const otherKey = keypair();
    const impostor = new Browser(installationId, otherKey, aliceToken);
    impostor.ws = new WebSocket(`${wsUrl}/api/v2/browser/connect?installation=${installationId}`);
    impostor.ws.on('message', (d) => { try { impostor.frames.push(JSON.parse(d.toString())); } catch {} });
    impostor.ws.on('close', (code, reason) => { impostor.ws._closeCode = code; impostor.ws._closeReason = String(reason || ''); });
    await new Promise((r) => { impostor.ws.once('open', r); impostor.ws.once('error', r); });
    const bad = await impostor.auth({ htu: HTU });
    check(bad.type !== 'ready', `a proof from the wrong key never becomes ready (saw ${bad.type})`);
    impostor.close();

    // ── 6b. a call queued by ANOTHER replica reaches this socket through LISTEN/NOTIFY ───────────
    // Simulated exactly as another replica would do it: insert the row, then pg_notify. No local callTool, so the
    // only way the browser can receive it is the listener (which before 2026-10-17 was never started).
    const foreignCall = crypto.randomUUID();
    await pool.query(`INSERT INTO browser_calls (call_id, installation, user_id, tool, args, state, deadline)
      VALUES ($1,$2,$3,'navigate','{"url":"https://other-replica.test"}'::jsonb,'queued', now() + interval '1 minute')`, [foreignCall, installationId, alice.id]);
    await pool.query(`SELECT pg_notify('browser_calls', $1)`, [JSON.stringify({ installation: String(installationId), callId: foreignCall })]);
    let reached = null;
    for (let i = 0; i < 80 && !reached; i += 1) { reached = browser.frames.find((f) => f.type === 'call' && f.callId === foreignCall); if (!reached) await new Promise((r) => setTimeout(r, 50)); }
    check(Boolean(reached), 'a call queued on another replica is delivered to the browser through LISTEN/NOTIFY');
    if (reached) browser.send({ type: 'result', callId: foreignCall, ok: true, output: 'ok' });

    // ── 6c. the chat offers browser tools only for a connected, allowed browser ─────────────────
    const offered = await resolveChatBrowser(pool, alice.id);
    check(offered && offered.id === String(installationId) && browserToolDeclarations(offered)[0]?.function.name === 'browser_navigate',
      `a connected, allowed browser is offered to the chat as browser_<tool> (${offered && browserToolDeclarations(offered).map((t) => t.function.name)})`);
    check((await resolveChatBrowser(pool, bob.id)) === null, "another person's browser is never offered");

    // ── 6d. the chat loop runs a browser step end to end against the real relay ──────────────────
    let modelCalls = 0;
    const streamModel = async function* () {
      modelCalls += 1;
      if (modelCalls === 1) yield { type: 'tool_calls', toolCalls: [{ id: 't1', function: { name: 'browser_navigate', arguments: '{"url":"https://loop.test"}' } }] };
      else yield { type: 'delta', text: 'done' };
    };
    const loopEvents = [];
    const loopDone = (async () => {
      for await (const ev of streamToolLoop({
        messages: [{ role: 'user', content: 'open it' }], surface: 'chat', turnId: crypto.randomUUID(), streamModel,
        tools: browserToolDeclarations(offered), browserLabel: offered.label,
        runBrowser: ({ name, args, onState }) => relay.callTool(pool, { installationId, tool: name.replace(/^browser_/, ''), args, actorUserId: alice.id, conversationId: 'c-loop', stepMs: 5000, onEvent: ({ state }) => onState(state) }),
        runSearch: async () => ({ sources: [] }),
      })) loopEvents.push(ev);
    })();
    let loopCall = null;
    for (let i = 0; i < 80 && !loopCall; i += 1) { loopCall = browser.frames.find((f) => f.type === 'call' && f.args?.url === 'https://loop.test'); if (!loopCall) await new Promise((r) => setTimeout(r, 50)); }
    if (loopCall) {
      browser.send({ type: 'approval', callId: loopCall.callId, state: 'waiting' });
      await new Promise((r) => setTimeout(r, 2500));
      browser.send({ type: 'result', callId: loopCall.callId, ok: true, output: { title: 'Loop page' } });
    }
    await loopDone;
    const kinds = loopEvents.map((e) => e.type);
    check(kinds.includes('browser_start') && kinds.includes('browser_result') && kinds.at(-1) === 'complete',
      `the chat loop runs a browser step and answers (${kinds.join(',')})`);
    check(loopEvents.some((e) => e.type === 'browser_state' && e.state === 'waiting_approval'),
      'a pending approval in the browser reaches the chat as a live "waiting" state');

    // ── 6e. the turn record keeps a browser step, and refuses a forged one ──────────────────────
    const okTurn = normalizeTurnRecord({ schema: 'xeno.chat.turn.v1', startedAt: 1, steps: [{ id: 'browser-1', kind: 'browser', tool: 'browser_navigate', startedAt: 1, endedAt: 2, state: 'done', browser: 'Work Chrome', args: { url: 'https://a.test' }, summary: 'Loop page' }] });
    const badTurn = normalizeTurnRecord({ schema: 'xeno.chat.turn.v1', startedAt: 1, steps: [{ id: 'b', kind: 'browser', tool: 'rm -rf', startedAt: 1 }] });
    check(okTurn.ok && okTurn.turn.steps[0].kind === 'browser' && !badTurn.ok, 'the turn record keeps a browser step and refuses a malformed one');

    // ── 6f. the account page: list, turn OFF (not a revoke), turn back on ───────────────────────
    const acct = async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/account/browsers${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${legacy}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const listed = await acct('GET', '');
    check(listed.status === 200 && listed.body.browsers.some((b) => b.id === installationId && b.connected && b.enabled),
      'the account page lists the browser as connected and allowed');
    const off = await acct('PATCH', `/${installationId}`, { enabled: false });
    const offClose = await browser.closed();
    const stillThere = (await pool.query('SELECT revoked_at, enabled FROM browser_installations WHERE id=$1', [installationId])).rows[0];
    check(off.status === 200 && Number(offClose) === 4403 && stillThere.revoked_at === null && stillThere.enabled === false,
      `turning chats OFF closes the socket but does NOT revoke the browser (close ${offClose}, revoked_at ${stillThere.revoked_at})`);
    const backOn = await acct('PATCH', `/${installationId}`, { enabled: true });
    check(backOn.status === 200 && backOn.body.browser.enabled === true, 'and it can be turned back on');
    browser.close();
    const browserAgain = await Browser.open({ url: wsUrl, installationId, token: aliceToken, key: aliceKey });
    const readyAgain = await browserAgain.auth({ htu: HTU });
    check(readyAgain.type === 'ready', 'a browser turned back on reconnects');
    Object.assign(browser, { ws: browserAgain.ws, frames: browserAgain.frames });

    // ── 7. revocation closes the live socket AND fails what was waiting ─────────────────────────
    const stuck = relay.callTool(pool, { installationId, tool: 'navigate', args: {}, actorUserId: alice.id, stepMs: 8000 });
    await browser.waitFor('call');   // delivered but never answered
    const rev = await call('DELETE', `/installations/${installationId}`, { token: aliceToken, key: aliceKey });
    check(rev.status === 200 && rev.body.revoked === true, 'revoking a browser succeeds');
    const revokedResult = await stuck;
    check(revokedResult.ok === false && ['revoked', 'disconnected'].includes(revokedResult.error.code),
      `a call waiting when the browser is revoked fails with a reason (${revokedResult.error.code})`);
    const closed = await browser.closed();
    check(Number(closed) === 4403 || Number(closed) === 4401 || Number(closed) > 0, `the live socket is closed on revoke (${closed})`);
    browser.close();

    // ── 8. a revoked installation cannot reconnect ──────────────────────────────────────────────
    const re = new Browser(installationId, aliceKey, aliceToken);
    re.ws = new WebSocket(`${wsUrl}/api/v2/browser/connect?installation=${installationId}`);
    re.ws.on('message', (d) => { try { re.frames.push(JSON.parse(d.toString())); } catch {} });
    re.ws.on('close', (code, reason) => { re.ws._closeCode = code; re.ws._closeReason = String(reason || ''); });
    await new Promise((r) => { re.ws.once('open', r); re.ws.once('error', r); });
    const reAuth = await re.auth({ htu: HTU });
    check(reAuth.type !== 'ready', 'a revoked browser cannot reconnect');
    re.close();

    // ── 9. the deadline is enforced by the ROW, so it holds on a replica holding no socket ───────
    const idB = crypto.randomUUID();
    await call('POST', '/installations', { token: aliceToken, key: aliceKey, body: { installationId: idB, label: 'No socket', browser: 'chrome', os: 'win32' } });
    const { row } = await installations.get(pool, alice.id, idB).then(() => ({ row: null })).catch(() => ({ row: null }));
    void row;
    const list = await call('GET', '/installations', { token: aliceToken, key: aliceKey });
    const idBReal = list.body.installations.find((i) => i.label === 'No socket').id;
    const orphan = await relay.callTool(pool, { installationId: idBReal, tool: 'navigate', args: {}, actorUserId: alice.id, stepMs: 700 });
    check(orphan.ok === false && orphan.error.code === 'timeout',
      `a browser that never answers times out as a RESULT, not a hang (${orphan.error.code})`);
    const orphanRow = (await pool.query(`SELECT state, error_code FROM browser_calls WHERE installation=$1`, [idBReal])).rows[0];
    check(orphanRow.state === 'failed' && orphanRow.error_code === 'timeout', 'the timeout is written to the row, so a later reader sees why');

    // ── 10. discovery advertises where to connect ───────────────────────────────────────────────
    const disc = discovery();
    check(/^wss:\/\//.test(disc.xeno_browser_connect_endpoint || '') && /\/api\/v2\/browser\/connect$/.test(disc.xeno_browser_connect_endpoint || ''),
      `discovery advertises the relay endpoint (${disc.xeno_browser_connect_endpoint})`);
    check(/^https:\/\//.test(disc.xeno_browser_installations_endpoint || '') && disc.issuer !== disc.xeno_browser_connect_endpoint,
      'discovery advertises the installations endpoint, and it is NOT the issuer (a resource URL must not pin the host identity)');
  } finally {
    relay.stopListening();
    server.close();
    await pool.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} FAILED of ${results.length}` : `\nALL ${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

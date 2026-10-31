/**
 * Settings on real Postgres: the apps signed in with an account, a person's own spend limit, and adding a provider key.
 *
 *   - an app is listed while it can still get a new token; a revoked, replaced or expired token is not an app, and an
 *     agent's own credential stays on its agent page
 *   - removing an app ends its tokens and its session, leaves other apps and other people alone, and a session another
 *     app shares stays open
 *   - a limit reads back what the ledger will test, refuses spending past it, and stops refusing once removed
 *   - from a website session, adding a key needs a fresh "confirm it's you"; an app's own token does not
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/settings-account.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { listApps, removeApp } from '../services/authorizedApps.js';
import { listSpendCaps, clearSpendCap, setSpendCap, addGrant, holdV2 } from '../utils/creditLedgerV2.js';
import { introspectToken } from '../utils/oidcProvider.js';
import * as places from '../services/places.js';
import v2InferenceRoutes from '../routes/v2InferenceRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `sa${process.pid}`;
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s])).rows[0].id;
const client = (id, name, first = true) => pool.query(`INSERT INTO oauth_clients (client_id, name, is_first_party) VALUES ($1,$2,$3) ON CONFLICT (client_id) DO NOTHING`, [id, name, first]);
const session = async (userId) => { const sid = crypto.randomUUID(); await pool.query(`INSERT INTO oauth_session_state (sid, user_id, auth_epoch, auth_time, expires_at) VALUES ($1,$2,0,now(), now() + interval '1 day')`, [sid, userId]); return sid; };
const token = async (userId, clientId, sid, { scope = 'openid profile ledger:read', revoked = false, rotated = false, expires = "now() + interval '1 day'" } = {}) => {
  const raw = crypto.randomBytes(16).toString('hex');
  await pool.query(`INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, family_id, scope, sid, expires_at, revoked, rotated) VALUES ($1,$2,$3,$4,$5,$6,${expires},$7,$8)`,
    [crypto.createHash('sha256').update(raw).digest('hex'), clientId, userId, crypto.randomUUID(), scope, sid, revoked, rotated]);
  return raw;
};
const sessionOpen = async (sid) => (await pool.query('SELECT revoked_at FROM oauth_session_state WHERE sid = $1', [sid])).rows[0].revoked_at === null;
const live = async (raw) => (await introspectToken(pool, { token: raw })).active === true;

async function inferenceApp(as) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: as.userId }; if (as.sid) req.browserSession = { sid: as.sid, userId: as.userId }; next(); });
  app.use('/', v2InferenceRoutes);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function main() {
  await runAllMigrations(pool);
  const me = await user('me'), other = await user('other');
  const [canvas, spawn, gone, old, swapped, thirdParty] = ['canvas', 'spawn', 'gone', 'old', 'swapped', 'third'].map((x) => `${tag}-${x}`);
  await client(canvas, 'XENO Canvas'); await client(spawn, 'XENO Spawn'); await client(gone, 'Gone'); await client(old, 'Old'); await client(swapped, 'Swapped'); await client(thirdParty, 'Some App', false);

  // the list
  const canvasSid = await session(me), canvasSid2 = await session(me), spawnSid = await session(me), sharedSid = await session(me);
  const canvasToken = await token(me, canvas, canvasSid, { scope: 'openid profile ledger:spend' });
  await token(me, canvas, canvasSid2);
  const spawnToken = await token(me, spawn, spawnSid);
  await token(me, gone, await session(me), { revoked: true });
  await token(me, old, await session(me), { expires: "now() - interval '1 hour'" });
  await token(me, swapped, await session(me), { rotated: true });
  await token(me, `agent:${tag}`, await session(me));
  await token(me, thirdParty, sharedSid);
  const sharedSpawn = await token(me, spawn, sharedSid);
  const theirSid = await session(other), theirCanvas = await token(other, canvas, theirSid);
  const endedSid = await session(me); await pool.query('UPDATE oauth_session_state SET revoked_at = now() WHERE sid = $1', [endedSid]);
  await client(`${tag}-ended`, 'Ended'); await token(me, `${tag}-ended`, endedSid);

  const apps = await listApps(pool, me), ids = apps.map((a) => a.clientId);
  ok(ids.includes(canvas) && ids.includes(spawn) && ids.includes(thirdParty), 'apps that can still get a token are listed');
  ok(!ids.includes(gone), 'a revoked token is not an app');
  ok(!ids.includes(old), 'an expired token is not an app');
  ok(!ids.includes(swapped), 'a token that was replaced says nothing on its own');
  ok(!ids.includes(`${tag}-ended`), 'a session that ended is not an app');
  ok(!ids.some((i) => i.startsWith('agent:')), 'an agent’s own credential is not here');
  const c = apps.find((a) => a.clientId === canvas);
  ok(c.name === 'XENO Canvas' && c.sessions === 2 && c.firstParty === true, 'an app shows its name and how many sign-ins it has');
  ok(c.can.includes('spend your credits') && c.can.includes('your name and photo'), 'what it can do is in words');
  ok(apps.find((a) => a.clientId === thirdParty).firstParty === false, 'an app XENO did not make says so');
  ok(!(await listApps(pool, other)).some((a) => a.clientId === spawn), 'someone else’s apps are their own');

  // removal
  ok((await removeApp(pool, me, 'no-such-app')).notFound === true, 'an app with no access answers as not found');
  ok((await removeApp(pool, me, `agent:${tag}`)).notFound === true, 'an agent’s credential cannot be removed here');
  ok((await removeApp(pool, me, gone)).notFound === true, 'an app already gone answers as not found');
  const out = await removeApp(pool, me, canvas);
  ok(out.removed === true && out.sessions === 2, 'removing an app ends each of its sessions');
  ok(!await live(canvasToken), 'its tokens stop working');
  ok(!await sessionOpen(canvasSid) && !await sessionOpen(canvasSid2), 'and its sessions end, so its access tokens stop too');
  ok(!(await listApps(pool, me)).some((a) => a.clientId === canvas), 'it is gone from the list');
  ok(await live(spawnToken) && await sessionOpen(spawnSid), 'another app is untouched');
  ok(await live(theirCanvas) && await sessionOpen(theirSid), 'the same app for another person is untouched');
  await removeApp(pool, me, thirdParty);
  ok(await sessionOpen(sharedSid) && await live(sharedSpawn), 'a session another app also holds stays open for that app');

  // an MCP connection goes with its sign-in
  const agent = await user('agent');
  await client(`${tag}-mcp`, 'Registered'); const mcpSid = await session(me); await token(me, `${tag}-mcp`, mcpSid);
  await pool.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name) VALUES ($1,$2,$3,'My CLI')`, [me, agent, `${tag}-mcp`]);
  ok((await listApps(pool, me)).find((a) => a.clientId === `${tag}-mcp`).name === 'My CLI', 'a connected agent shows the name it connected with');
  await removeApp(pool, me, `${tag}-mcp`);
  ok((await pool.query(`SELECT 1 FROM mcp_connections WHERE client_id = $1 AND revoked_at IS NULL`, [`${tag}-mcp`])).rowCount === 0, 'and its connection ends with it');

  await pool.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name) VALUES ($1,$2,$3,'Agent credential')`, [me, agent, `agent:${tag}`]);
  ok((await removeApp(pool, me, `agent:${tag}`)).notFound === true && (await pool.query('SELECT 1 FROM mcp_connections WHERE client_id = $1 AND revoked_at IS NULL', [`agent:${tag}`])).rowCount === 1, 'an agent’s credential connection stays, whatever is asked here');

  // the limit
  const payer = await user('payer');
  await addGrant(pool, payer, { amountMicro: 100_000_000, kind: 'promo', sourceRef: `${tag}-grant` });
  await pool.query('INSERT INTO usage_credit_preferences (user_id, enabled) VALUES ($1, true)', [payer]);
  ok((await listSpendCaps(pool, payer)).length === 0, 'no limit until one is set');
  const MONTH = 30 * 86400;
  await setSpendCap(pool, payer, { windowSec: MONTH, limitMicro: 5_000_000 });
  await holdV2(pool, payer, { amountMicro: 3_000_000, surface: 'test', operation: 'test', holdId: `${tag}-d1` });
  const [cap] = await listSpendCaps(pool, payer);
  ok(cap.windowSec === MONTH && cap.limitMicro === '5000000' && cap.spentMicro === '3000000', 'a limit reads back what has been spent or reserved against it');
  await assert.rejects(() => holdV2(pool, payer, { amountMicro: 3_000_000, surface: 'test', operation: 'test', holdId: `${tag}-d2` }), (e) => e.code === 'SPEND_CAP_EXCEEDED');
  ok(true, 'spending past the limit is refused');
  ok((await clearSpendCap(pool, payer, MONTH)).removed === true, 'a limit can be removed');
  await holdV2(pool, payer, { amountMicro: 3_000_000, surface: 'test', operation: 'test', holdId: `${tag}-d3` });
  ok(true, 'and then the same spend goes through');
  ok((await clearSpendCap(pool, payer, MONTH)).removed === false, 'removing it twice changes nothing');
  await setSpendCap(pool, payer, { windowSec: MONTH, limitMicro: 1 });
  ok((await clearSpendCap(pool, other, MONTH)).removed === false && (await listSpendCaps(pool, payer)).length === 1, 'another person cannot remove your limit');

  // a provider key from a website session
  process.env.BYOK_ENABLED = 'true';
  const browserSid = await pool.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 day') RETURNING id`, [me, crypto.randomBytes(16).toString('hex')]);
  const sid = browserSid.rows[0].id;
  await pool.query(`INSERT INTO browser_session_state (sid, csrf_hash) VALUES ($1,$2)`, [sid, crypto.randomBytes(16).toString('hex')]);
  const body = JSON.stringify({ provider: 'not-a-provider', label: 'x', secret: 'not-a-real-key-000000000000' });
  const web = await inferenceApp({ userId: me, sid });
  const refused = await fetch(`${web.url}/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  ok(refused.status === 403 && (await refused.json()).error.code === 'confirmation_required', 'a website session must confirm it’s you before adding a key');
  await pool.query(`INSERT INTO account_confirmations (sid, user_id, method, confirmed_at, expires_at) VALUES ($1,$2,'password',now(), now() + interval '10 minutes')`, [sid, me]);
  const confirmed = await fetch(`${web.url}/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  ok(confirmed.status === 400, 'once confirmed it reaches the vault (which refuses an unknown provider)');
  await web.close();
  const appToken = await inferenceApp({ userId: me });
  const direct = await fetch(`${appToken.url}/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  ok(direct.status === 400, 'an app with its own token has no website session to confirm in');
  await appToken.close();

  // gifts read through Places, with the switch off
  delete process.env.ACCOUNT_GIFTS_OPEN;
  const fundingMe = { id: me, kind: 'human', role: 'user', name: 'me' };
  const read = await places.call(pool, fundingMe, 'funding.get', {});
  ok(read.ok === true && read.result.giftsOpen === false && Array.isArray(read.result.ledger), 'the Gifts page reads its history, and that sending is closed');
  const send = await places.call(pool, fundingMe, 'funding.gift', { recipient: 'someone', amount: 5, confirmed: true, requestId: `${tag}-gift-1` });
  ok(send.ok === false && send.error.reason === 'gifts_closed', 'and sending stays closed');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });

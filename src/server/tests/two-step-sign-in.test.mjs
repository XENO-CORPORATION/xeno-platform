/**
 * Two-step sign-in over real routes, real Postgres and a software authenticator that signs what a real one signs.
 *
 *   - the code maths is RFC 6238's own test vector; a code's time step works once; a secret and codes are never stored plain
 *   - with a second step on, the password alone makes no session, and the challenge cookie is not a session
 *   - five wrong tries end a challenge; ten wrong tries stop the account's second step, even for the right code
 *   - a recovery code works once; a stolen password can't switch two-step off; a passkey signs in by itself
 *   - a passkey from the wrong site, one replayed from a clone, or someone else's, is refused
 *   - every way of making a session goes through the second step
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/two-step-sign-in.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import express from 'express';
import pg from 'pg';

process.env.PASSKEY_RP_ID = 'localhost'; process.env.PASSKEY_ORIGINS = 'http://localhost:3000';
const { default: authRoutes, finishOAuth, linkProvider, linkIntent } = await import('../routes/authRoutes.js');
const { default: accountSecurityRoutes } = await import('../routes/accountSecurityRoutes.js');
const { browserSessionMiddleware } = await import('../middleware/browserSession.js');
const { runAllMigrations } = await import('../services/migrationRunner.js');
const twoStep = await import('../services/twoStep.js');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const tag = `ts${process.pid}`, PASSWORD = 'Two-step-test-42!';
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [`${tag}${s}`, `${tag}${s}@xeno.test`, await bcrypt.hash(PASSWORD, 4), s])).rows[0].id;

// ---------- the client ----------
let base = '';
const jar = (res, into = {}) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1), k = kv.slice(0, i); if (!v || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete into[k]; else into[k] = v; } return into; };
const header = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
const csrf = (j) => { const k = Object.keys(j).find((x) => /xeno_csrf$/.test(x)); return k ? decodeURIComponent(j[k]) : ''; };
async function call(method, url, body, j = {}, extra = {}) {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(Object.keys(j).length ? { cookie: header(j) } : {}), ...(csrf(j) && method !== 'GET' ? { 'x-xeno-csrf': csrf(j) } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
  jar(r, j);
  const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch {}
  return { status: r.status, d };
}
const login = (who, j = {}, extra = { 'x-xeno-session-mode': 'browser' }) => call('POST', '/api/auth/login', { email: `${tag}${who}@xeno.test`, password: PASSWORD }, j, extra);
const hasSession = (j) => Object.keys(j).some((k) => /xeno_session$/.test(k));
const signedIn = async (j) => (await call('GET', '/api/account/apps', undefined, j)).status === 200;
const confirmPassword = (j) => call('POST', '/api/account/confirm', { password: PASSWORD }, j);

// ---------- codes ----------
const appCode = (key, step) => twoStep.totpAt(twoStep.unbase32(key), step);
const nowStep = () => Math.floor(Date.now() / 30000);

// ---------- a software authenticator ----------
const cbor = (v) => {
  const head = (m, n) => (n < 24 ? Buffer.from([(m << 5) | n]) : n < 256 ? Buffer.from([(m << 5) | 24, n]) : Buffer.from([(m << 5) | 25, n >> 8, n & 255]));
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
};
const b64 = (b) => Buffer.from(b).toString('base64url');
function authenticator(rpId = 'localhost', origin = 'http://localhost:3000') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }), credId = crypto.randomBytes(32);
  const rpHash = crypto.createHash('sha256').update(rpId).digest();
  const auth = { counter: 0, credentialId: b64(credId) };
  const client = (type, challenge, at = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: at, crossOrigin: false }));
  auth.register = (options) => {
    const clientData = client('webauthn.create', options.challenge);
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
    const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
    const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: auth.credentialId, rawId: auth.credentialId, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), attestationObject: b64(attestation), transports: ['internal'] } };
  };
  auth.sign = (options, { at = origin, counter = ++auth.counter, flags = 0x05, id = auth.credentialId } = {}) => {
    const clientData = client('webauthn.get', options.challenge, at);
    const c = Buffer.alloc(4); c.writeUInt32BE(counter);
    const authData = Buffer.concat([rpHash, Buffer.from([flags]), c]);
    const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]), privateKey);
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) } };
  };
  return auth;
}

async function main() {
  await runAllMigrations(pool);
  const app = express(); app.use(express.json());
  app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.get('/probe-link', async (req, res) => res.json({ intent: await linkIntent(req) }));
  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountSecurityRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // the maths
    const rfc = Buffer.from('12345678901234567890');
    ok(twoStep.totpAt(rfc, 1, 8) === '94287082' && twoStep.totpAt(rfc, 37037036, 8) === '07081804' && twoStep.totpAt(rfc, 37037037, 8) === '14050471', 'code maths matches RFC 6238’s test vectors');
    ok(twoStep.unbase32(twoStep.base32(rfc)).equals(rfc), 'a key survives being written out');
    const clock = 37037036 * 30000;
    ok(twoStep.matchTotp(rfc, twoStep.totpAt(rfc, 37037036), 0, clock) === 37037036, 'a code for now is right');
    ok(twoStep.matchTotp(rfc, twoStep.totpAt(rfc, 37037036), 37037036, clock) === null, 'the same step cannot be used twice');
    ok(twoStep.matchTotp(rfc, twoStep.totpAt(rfc, 37037035), 0, clock) === 37037035, 'a code one step old still works, for a slow clock');
    ok(twoStep.matchTotp(rfc, twoStep.totpAt(rfc, 37037033), 0, clock) === null, 'an older one does not');

    // setting up
    const ada = await user('ada');
    const web = {};
    ok((await login('ada', web)).status === 200 && hasSession(web), 'with no second step, a password signs in as before');
    ok((await call('GET', '/api/account/two-step', undefined, web)).d.twoStep.on === false, 'two-step starts off');
    ok((await call('POST', '/api/account/two-step/totp', {}, web)).d.code === 'confirmation_required', 'setting it up asks who you are');
    await confirmPassword(web);
    const begun = (await call('POST', '/api/account/two-step/totp', {}, web)).d;
    ok(/^otpauth:\/\/totp\/XENO/.test(begun.otpauth) && /<svg/.test(begun.qrSvg), 'it offers a key and a QR code');
    const raw = (await pool.query('SELECT secret_enc FROM account_totp WHERE user_id = $1', [ada])).rows[0].secret_enc;
    ok(!raw.includes(begun.key) && !raw.includes(twoStep.unbase32(begun.key).toString('base64')), 'the secret is not stored in the clear');
    ok((await login('ada')).status === 200, 'it counts for nothing until a code proves it works');
    ok((await call('POST', '/api/account/two-step/totp/confirm', { code: '000000' }, web)).d.code === 'code_wrong', 'a wrong code does not turn it on');
    const on = (await call('POST', '/api/account/two-step/totp/confirm', { code: appCode(begun.key, nowStep() - 1) }, web)).d;
    ok(on.success && on.recoveryCodes.length === 10, 'a right code turns it on, and gives ten recovery codes');
    const stored = (await pool.query('SELECT code_hash FROM account_recovery_codes WHERE user_id = $1', [ada])).rows.map((r) => r.code_hash);
    ok(stored.length === 10 && !stored.some((h) => on.recoveryCodes.some((c) => h.includes(c) || h.includes(c.replace(/-/g, '')))), 'recovery codes are stored only as hashes');
    await new Promise((r) => setTimeout(r, 200));
    ok((await pool.query(`SELECT 1 FROM security_events WHERE user_id = $1 AND event_type = 'two_step_changed'`, [ada])).rowCount === 1, 'the change is recorded');

    // the second step
    let jarA = {};
    const first = await login('ada', jarA);
    ok(first.status === 401 && first.d.code === 'two_step_required' && first.d.methods.includes('authenticator'), 'now a right password asks for the second step');
    ok(!hasSession(jarA) && first.d.user === undefined, 'and makes no session');
    ok(first.d.challenge === undefined, 'a browser never sees the challenge: it is in an HttpOnly cookie');
    ok(!await signedIn(jarA), 'the challenge cookie is not a way in');
    ok((await call('GET', '/api/auth/two-step', undefined, jarA)).d.methods.includes('recovery_code'), 'the page can ask how it may be done');
    const wrong = await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: '000000' }, jarA);
    ok(wrong.status === 401 && wrong.d.code === 'code_wrong' && !hasSession(jarA), 'a wrong code makes no session');
    const right = appCode(begun.key, nowStep());
    const sameChallenge = { ...jarA };
    const pass = await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: right }, jarA);
    ok(pass.status === 200 && pass.d.success && hasSession(jarA) && await signedIn(jarA), 'the right code signs in');
    ok(pass.d.token === null, 'a browser still gets no bearer');
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: on.recoveryCodes[9] }, sameChallenge)).status === 410, 'a challenge makes one session, even asked again with a good code');
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: right }, jarA)).status === 410, 'and the challenge is spent');
    const again = {}; await login('ada', again);
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: right }, again)).d.code === 'code_wrong', 'the same code cannot sign in twice');
    const cleanStep = async () => pool.query('DELETE FROM two_step_throttle WHERE user_id = $1', [ada]);

    // recovery codes
    const code0 = on.recoveryCodes[0];
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: code0.toUpperCase() }, again)).status === 200 && await signedIn(again), 'a recovery code signs in, however it is typed');
    const third = {}; await login('ada', third);
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: code0 }, third)).d.code === 'code_wrong', 'and works only once');
    ok((await call('GET', '/api/account/two-step', undefined, web)).d.twoStep.recoveryLeft === 9, 'the page knows how many are left');

    // five tries for a challenge, ten for the account
    await cleanStep();
    const five = {}; await login('ada', five);
    for (let i = 0; i < 5; i += 1) await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: '111111' }, five);
    const dead = await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: appCode(begun.key, nowStep() + 1) }, five);
    ok(dead.status === 410, 'five wrong tries end a challenge, even for the right code');
    for (let n = 0; n < 2; n += 1) { const j = {}; await login('ada', j); for (let i = 0; i < 3; i += 1) await call('POST', '/api/auth/two-step/verify', { method: 'authenticator', code: '111111' }, j); }
    const locked = {}; await login('ada', locked);
    const stop = await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: on.recoveryCodes[1] }, locked);
    ok(stop.status === 429, 'ten wrong tries stop the account, whichever challenge they came through');
    ok(!hasSession(locked), 'even a right code then');
    await cleanStep();

    // someone with the password can't turn it off
    const thief = {}; await login('ada', thief);
    await pool.query('DELETE FROM two_step_challenges WHERE user_id = $1', [ada]);
    await pool.query('DELETE FROM account_confirmations WHERE user_id = $1', [ada]);
    await confirmPassword(web);
    const off = await call('DELETE', '/api/account/two-step/totp', undefined, web);
    ok(off.status === 403 && off.d.code === 'factor_required', 'a password can’t turn two-step off');
    ok((await call('POST', '/api/account/two-step/recovery-codes', {}, web)).d.code === 'factor_required', 'nor make new recovery codes');
    ok(!(await pool.query('SELECT 1 FROM users u WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM account_totp t WHERE t.user_id = u.id)', [ada])).rowCount, 'it is still on');
    const sec = await call('GET', '/api/account/security', undefined, web);
    ok(sec.d.security.methods[0] === 'authenticator', 'confirming offers the second step first');
    ok((await call('POST', '/api/account/confirm', { authenticator: '000000' }, web)).status >= 400, 'a wrong code doesn’t confirm');
    await cleanStep();
    ok((await call('POST', '/api/account/confirm', { recovery_code: on.recoveryCodes[2] }, web)).d.confirmation?.method === 'recovery_code', 'a recovery code confirms');
    const fresh = (await call('POST', '/api/account/two-step/recovery-codes', {}, web)).d;
    ok(fresh.recoveryCodes.length === 10, 'and then new codes can be made');
    const old = {}; await login('ada', old);
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: on.recoveryCodes[3] }, old)).d.code === 'code_wrong', 'the old ones stop working');
    await cleanStep();

    // a client with no cookies
    const cli = await login('ada', {}, {});
    ok(cli.status === 401 && typeof cli.d.challenge === 'string', 'a client with no cookies is given the challenge');
    const cliDone = await call('POST', '/api/auth/two-step/verify', { method: 'recovery_code', code: fresh.recoveryCodes[0], challenge: cli.d.challenge });
    ok(cliDone.status === 200 && typeof cliDone.d.token === 'string', 'and gets its token after the second step');

    // passkeys
    const key = authenticator();
    const reg = (await call('POST', '/api/account/two-step/passkeys/options', {}, web)).d;
    ok(reg.options.authenticatorSelection.userVerification === 'required' && reg.options.authenticatorSelection.residentKey === 'required', 'a passkey must verify the person');
    ok(reg.options.rp.id === 'localhost', 'it names this site');
    const added = await call('POST', '/api/account/two-step/passkeys', { ceremonyId: reg.ceremonyId, response: key.register(reg.options), name: 'My laptop' }, web);
    ok(added.status === 201 && added.d.recoveryCodes === null, 'a passkey is added; existing codes stay');
    ok((await call('POST', '/api/account/two-step/passkeys', { ceremonyId: reg.ceremonyId, response: key.register(reg.options), name: 'Again' }, web)).status === 409, 'a ceremony works once');
    const listed = (await call('GET', '/api/account/two-step', undefined, web)).d.twoStep.passkeys;
    ok(listed.length === 1 && listed[0].name === 'My laptop', 'it is listed by name');
    ok(!(await pool.query('SELECT 1 FROM account_passkeys WHERE public_key IS NULL')).rowCount, 'with its public key');

    // a passkey signs in by itself
    const so = (await call('POST', '/api/auth/passkey/options', {})).d;
    const pk = {};
    const by = await call('POST', '/api/auth/passkey/verify', { ceremonyId: so.ceremonyId, response: key.sign(so.options) }, pk, { 'x-xeno-session-mode': 'browser' });
    ok(by.status === 200 && hasSession(pk) && await signedIn(pk), 'a passkey signs in with no password');
    const replay = await call('POST', '/api/auth/passkey/verify', { ceremonyId: so.ceremonyId, response: key.sign(so.options) }, {}, { 'x-xeno-session-mode': 'browser' });
    ok(replay.status === 401, 'its ceremony works once');
    const s2 = (await call('POST', '/api/auth/passkey/options', {})).d;
    ok((await call('POST', '/api/auth/passkey/verify', { ceremonyId: s2.ceremonyId, response: key.sign(s2.options, { at: 'https://evil.example' }) })).status === 401, 'a passkey signed on another site is refused');
    const s3 = (await call('POST', '/api/auth/passkey/options', {})).d;
    ok((await call('POST', '/api/auth/passkey/verify', { ceremonyId: s3.ceremonyId, response: key.sign(s3.options, { counter: 1 }) })).status === 401, 'a replayed counter, the sign of a clone, is refused');
    const s4 = (await call('POST', '/api/auth/passkey/options', {})).d;
    ok((await call('POST', '/api/auth/passkey/verify', { ceremonyId: s4.ceremonyId, response: key.sign(s4.options, { flags: 0x01 }) })).status === 401, 'a passkey that did not verify the person is refused');
    const s5 = (await call('POST', '/api/auth/passkey/options', {})).d;
    ok((await call('POST', '/api/auth/passkey/verify', { ceremonyId: s5.ceremonyId, response: authenticator().sign(s5.options) })).status === 401, 'an unknown passkey is refused');

    // as the second step, and only the account's own
    const bob = await user('bob'), bobJar = {};
    await login('bob', bobJar); await confirmPassword(bobJar);
    const bobKey = authenticator(), br = (await call('POST', '/api/account/two-step/passkeys/options', {}, bobJar)).d;
    const bobAdded = await call('POST', '/api/account/two-step/passkeys', { ceremonyId: br.ceremonyId, response: bobKey.register(br.options), name: 'Bob’s' }, bobJar);
    ok(bobAdded.d.recoveryCodes?.length === 10, 'a first passkey gives recovery codes too');
    const stepJar = {}; const b1 = await login('bob', stepJar);
    ok(b1.d.code === 'two_step_required' && b1.d.methods.includes('passkey'), 'a passkey makes it a two-step account');
    const bo = (await call('POST', '/api/auth/two-step/passkey/options', {}, stepJar)).d;
    ok(bo.options.allowCredentials.length === 1 && bo.options.allowCredentials[0].id === bobKey.credentialId, 'the second step asks only for this account’s passkeys');
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'passkey', response: key.sign(bo.options) }, stepJar)).d.code === 'code_wrong', 'someone else’s passkey is refused');
    const bo2 = (await call('POST', '/api/auth/two-step/passkey/options', {}, stepJar)).d;
    ok((await call('POST', '/api/auth/two-step/verify', { method: 'passkey', response: bobKey.sign(bo2.options) }, stepJar)).status === 200 && await signedIn(stepJar), 'its own passkey signs in');

    // confirming with a passkey, then taking everything off
    await pool.query('DELETE FROM account_confirmations WHERE user_id = $1', [bob]);
    const co = (await call('POST', '/api/account/confirm/passkey/options', {}, stepJar)).d;
    ok((await call('POST', '/api/account/confirm', { passkey: { ceremonyId: co.ceremonyId, response: bobKey.sign(co.options) } }, stepJar)).d.confirmation?.method === 'passkey', 'a passkey confirms it’s you');
    const theirs = (await pool.query('SELECT id FROM account_passkeys WHERE user_id = $1', [ada])).rows[0].id;
    ok((await call('DELETE', `/api/account/two-step/passkeys/${theirs}`, undefined, stepJar)).status === 404, 'someone else’s passkey can’t be removed');
    const bobsId = (await pool.query('SELECT id FROM account_passkeys WHERE user_id = $1', [bob])).rows[0].id;
    ok((await call('PATCH', `/api/account/two-step/passkeys/${bobsId}`, { name: 'Phone' }, stepJar)).status === 200, 'a passkey can be renamed');
    ok((await call('DELETE', `/api/account/two-step/passkeys/${bobsId}`, undefined, stepJar)).status === 200, 'and removed');
    ok(!(await pool.query('SELECT 1 FROM account_recovery_codes WHERE user_id = $1', [bob])).rowCount, 'with nothing left to recover, the codes go too');
    ok((await login('bob')).status === 200, 'and the password alone signs in again');

    // a provider sign-in (Google, GitHub, X) takes the second step too
    const fakeRes = () => { const r = { cookies: {}, cookie(n, v) { this.cookies[n] = v; }, redirect(u) { this.to = u; }, send(b) { this.body = b; }, status() { return this; }, json() { return this; } }; return r; };
    const adaRow = (await pool.query('SELECT * FROM users WHERE id = $1', [ada])).rows[0];
    const fakeReq = { db: pool, headers: {}, get: () => undefined, socket: {} };
    const held = fakeRes();
    await finishOAuth(fakeReq, held, adaRow, '/workspace', false);
    ok(String(held.to).endsWith('/login?two_step=1') && !Object.keys(held.cookies).some((k) => /xeno_session$/.test(k)) && Object.keys(held.cookies).some((k) => /xeno_two_step$/.test(k)), 'a provider sign-in on a two-step account makes no session, and asks for the second step');
    const noFactor = (await pool.query('SELECT * FROM users WHERE id = $1', [await user('carol')])).rows[0], plain = fakeRes();
    await finishOAuth(fakeReq, plain, noFactor, '/workspace', false);
    ok(Object.keys(plain.cookies).some((k) => /xeno_session$/.test(k)), 'with no second step it signs in as before');
    await pool.query('DELETE FROM two_step_challenges WHERE user_id = $1', [ada]);

    // connecting a provider to an account
    const dan = await user('dan'), eve = await user('eve');
    ok((await linkProvider(pool, dan, 'github', { id: 'gh-1', username: 'dan' })).linked === true, 'a provider account can be connected');
    ok((await linkProvider(pool, dan, 'github', { id: 'gh-1', username: 'dan' })).already === true, 'connecting it twice changes nothing');
    ok((await linkProvider(pool, eve, 'github', { id: 'gh-1', username: 'dan' })).refused === 'taken', 'someone else’s provider account can’t be taken');
    ok((await pool.query(`SELECT user_id FROM oauth_accounts WHERE provider = 'github' AND provider_user_id = 'gh-1'`)).rows[0].user_id === dan, 'and stays with its owner');
    ok((await linkProvider(pool, dan, 'github', { id: 'gh-2', username: 'dan2' })).refused === 'has_one', 'one of each per person');
    const danJar = {}; await login('dan', danJar);
    const reqFor = (j, query) => { const sid = null; return { query, db: pool, get: (h) => (h === 'host' ? 'xenosystem.ai' : undefined), headers: { cookie: header(j) }, browserSession: sid }; };
    ok((await linkIntent({ ...reqFor(danJar, {}) })) === null, 'an ordinary sign-in is not a connect');
    ok((await linkIntent({ ...reqFor({}, { link: '1' }) })).refused === 'sign_in', 'connecting needs someone signed in');
    ok((await call('GET', '/probe-link?link=1', undefined, danJar)).d.intent.refused === 'confirm', 'and to have just confirmed it’s them');
    await confirmPassword(danJar);
    ok((await call('GET', '/probe-link?link=1', undefined, danJar)).d.intent.linkUserId === dan, 'then the flow carries who asked');

    // the coverage set: every way of making a session goes through the second step
    const src = fs.readFileSync(path.join(here, '../routes/authRoutes.js'), 'utf8');
    const callsOf = (name) => src.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => l.includes(`${name}(`) && !/async function /.test(l));
    const oauthCalls = callsOf('issueOAuthCredential');
    ok(oauthCalls.length === 2 && oauthCalls.every(([l]) => /jwtToken = await|token = await/.test(l)), 'a provider sign-in makes a session only in finishOAuth and completeSignIn');
    ok((src.match(/await finishOAuth\(req, res, user, returnUrl, isNew\)/g) || []).length === 3, 'all three provider callbacks use it');
    const loginCalls = src.indexOf("const loginMode =") < src.indexOf("await recordSecurityEvent(req.db, EVENTS.LOGIN, { userId: user.id, req, metadata: { method: 'password' } })");
    ok(loginCalls, 'the password route asks before it records a sign-in');
    ok(!/account_totp|account_passkeys|account_recovery_codes/.test(src), 'nothing in the sign-in routes, resetting a password included, can clear a second step');
    ok(twoStep.relatedOrigins().origins.includes('http://localhost:3000'), 'the related-origins file lists the site’s hosts');

    // the way back: the migration's DOWN runs, and an account signs in as it did before
    const migration = fs.readFileSync(path.join(here, '../database/migrations/20261104090000-two-step-sign-in.sql'), 'utf8');
    const [up, down] = migration.split('-- DOWN');
    await pool.query(down);
    ok((await pool.query("SELECT to_regclass('public.account_totp') AS t")).rows[0].t === null, 'the migration can be taken back');
    await pool.query(up);
    ok((await login('bob')).status === 200, 'and put back again');

    console.log(`\n${passed} checks passed`);
  } finally { await new Promise((r) => server.close(r)); }
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });

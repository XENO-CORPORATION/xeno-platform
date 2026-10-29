/**
 * Sign-in for a XENO product on its own host (routes/authRoutes.js /api/auth/host/*, tools.xenosystem.ai) against a
 * real Postgres and the real OIDC provider: the code is minted by the provider's own createAuthorizationCode, so PKCE,
 * one-use and the registered redirect are the provider's checks, not this test's.
 *
 *   - start (as tools.xenosystem.ai) → the XENO authorize URL for client xeno-tools-web, PKCE S256, this host's callback
 *   - callback with the matching cookie → a browser session ON THAT HOST, the minted refresh token revoked at once,
 *     and a same-site hop to the return path (never to another site)
 *   - refused: another host (404), a state that does not match, no cookie, a code used twice, a suspended account
 *
 *   node src/server/tests/host-signin.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { createAuthorizationCode } from '../utils/oidcProvider.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const tag = `hs${Date.now().toString(36)}`;
const HOST = 'tools.xenosystem.ai', CB = `https://${HOST}/api/auth/host/callback`;

const { default: authRoutes } = await import('../routes/authRoutes.js');
const app = express();
app.use((req, _res, next) => { req.db = pool; next(); });
app.use('/api/auth', authRoutes);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
// node:http, because fetch refuses to set Host — and Host is the whole point here
const get = (path, { host = HOST, cookie } = {}) => new Promise((resolve, reject) => {
  const req = http.request(base + path, { headers: { host, ...(cookie ? { cookie } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const body = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, setCookie: [].concat(res.headers['set-cookie'] || []), headers: { get: (k) => res.headers[k.toLowerCase()] ?? null }, text: async () => body }); });
  });
  req.on('error', reject); req.end();
});
const cookieOf = (res, name) => res.setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='));

async function start(ret = '/whisper') {
  const r = await get('/api/auth/host/start?return=' + encodeURIComponent(ret));
  const loc = new URL(r.headers.get('location'));
  const carry = cookieOf(r, 'xeno_host_signin');
  const verifier = JSON.parse(Buffer.from(decodeURIComponent(carry.split('=')[1]), 'base64url').toString()).v;
  return { r, loc, carry, verifier };
}
const mint = async (userId, loc) => createAuthorizationCode(pool, { clientId: 'xeno-tools-web', userId, redirectUri: CB, scope: 'openid profile email', codeChallenge: loc.searchParams.get('code_challenge') });

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const user = async (s, active = true) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,$4,'x',NOW()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s, active])).rows[0].id;
  const me = await user('me'), gone = await user('gone', false);

  // start
  check((await get('/api/auth/host/start', { host: 'xenosystem.ai' })).status === 404, 'a host with no client of its own gets no host sign-in');
  const s1 = await start('/whisper');
  check(s1.r.status === 302 && s1.loc.pathname === '/api/oauth2/authorize' && s1.loc.searchParams.get('client_id') === 'xeno-tools-web'
    && s1.loc.searchParams.get('redirect_uri') === CB && s1.loc.searchParams.get('code_challenge_method') === 'S256' && !!s1.carry,
    'start sends the person to the XENO sign-in as xeno-tools-web, PKCE S256, back to this host');

  // the real provider issues a code for that challenge; the callback turns it into a session on this host
  const c1 = await mint(me, s1.loc);
  const before = (await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id = $1', [me])).rows[0].n;
  const cb = await get(`/api/auth/host/callback?code=${encodeURIComponent(c1)}&state=${s1.loc.searchParams.get('state')}`, { cookie: s1.carry });
  const html = await cb.text();
  const after = (await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id = $1', [me])).rows[0].n;
  check(cb.status === 200 && !!cookieOf(cb, 'xeno_session') && after === before + 1, 'the callback opens an ordinary browser session on this host');
  check(/url=\/whisper"/.test(html), 'and continues to the return path on this host');
  const live = (await pool.query("SELECT count(*)::int n FROM oauth_refresh_tokens WHERE user_id = $1 AND client_id = 'xeno-tools-web' AND NOT revoked", [me])).rows[0].n;
  check(live === 0, 'no refresh token is kept for the host sign-in');

  // the same code again
  const again = await get(`/api/auth/host/callback?code=${encodeURIComponent(c1)}&state=${s1.loc.searchParams.get('state')}`, { cookie: s1.carry });
  check(again.status === 400, 'a code used once is refused the second time');

  // state and cookie must match
  const s2 = await start('/'); const c2 = await mint(me, s2.loc);
  check((await get(`/api/auth/host/callback?code=${c2}&state=other`, { cookie: s2.carry })).status === 400, 'a state that does not match the cookie is refused');
  check((await get(`/api/auth/host/callback?code=${c2}&state=${s2.loc.searchParams.get('state')}`)).status === 400, 'no cookie, no session');

  // never a hop to another site
  const s3 = await start('//evil.example/x'); const c3 = await mint(me, s3.loc);
  const r3 = await get(`/api/auth/host/callback?code=${c3}&state=${s3.loc.searchParams.get('state')}`, { cookie: s3.carry });
  check(r3.status === 200 && /url=\/"/.test(await r3.text()), 'a return path to another site becomes this host’s home');

  // a suspended account
  const s4 = await start('/');
  let c4 = null; try { c4 = await mint(gone, s4.loc); } catch { /* the provider may refuse to issue at all */ }
  const r4 = c4 ? await get(`/api/auth/host/callback?code=${c4}&state=${s4.loc.searchParams.get('state')}`, { cookie: s4.carry }) : null;
  const goneSessions = (await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id = $1', [gone])).rows[0].n;
  check((!r4 || r4.status >= 400) && goneSessions === 0 && !(r4 && cookieOf(r4, 'xeno_session')), `a suspended account gets no session (${r4 ? r4.status : 'no code issued'})`);

  void crypto;
  console.log(`\nhost-signin: ${passed} checks passed`);
}

main().then(() => { server.close(); return pool.end(); }, (e) => { console.error(e); process.exit(1); });

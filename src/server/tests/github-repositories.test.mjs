/**
 * GitHub for a cloud Agent session (services/githubApp.js + cloudAgent.js repositories) against a real Postgres, a
 * stand-in GitHub and a stand-in machine.
 *
 *   - fail closed: without the App's configuration nothing is connected and no token is minted
 *   - the connect link names the person; a forged, altered or expired state is refused
 *   - only installations of THIS App that the person's GitHub sign-in reaches are recorded, and the one-time user
 *     token is revoked
 *   - the list is the repositories the person allowed, with no token in it
 *   - opening a repository the person allowed mints a token for THAT repository alone, which reaches the machine on
 *     the command's standard input, never in its arguments, and is stored nowhere on the platform
 *   - a repository none of their installations covers opens without a token; another person's installation is not theirs
 *   - listing starts nothing; an agent never connects GitHub
 *
 *   node src/server/tests/github-repositories.test.mjs   (DATABASE_URL = a disposable database)
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import * as github from '../services/githubApp.js';
import { cloudRepositories, openCloudRepository } from '../services/cloudAgent.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `ghr${Date.now().toString(36)}`;

// --- the App's configuration: a real RSA key, so the App JWT is really signed and checked ----------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const APP_ID = '5837883';
const setConfig = () => Object.assign(process.env, { XENO_GITHUB_APP_ID: APP_ID, XENO_GITHUB_APP_SLUG: 'xenosystem-agent', XENO_GITHUB_APP_CLIENT_ID: 'Iv1.test',
  XENO_GITHUB_APP_CLIENT_SECRET: 'client-secret-test', XENO_GITHUB_APP_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') });
const clearConfig = () => { for (const k of ['XENO_GITHUB_APP_ID', 'XENO_GITHUB_APP_SLUG', 'XENO_GITHUB_APP_CLIENT_ID', 'XENO_GITHUB_APP_CLIENT_SECRET', 'XENO_GITHUB_APP_PRIVATE_KEY_B64']) delete process.env[k]; };
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-github-state';

// --- a stand-in GitHub -------------------------------------------------------------------------------------------------
const MINE = 9001; const OTHER_APP = 9002; const THEIRS = 9003;
const calls = []; const minted = [];
const verifyAppJwt = (auth) => {
  const [h, p, s] = String(auth || '').replace(/^Bearer /, '').split('.');
  if (!s) return false;
  const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  return ok && JSON.parse(Buffer.from(p, 'base64url').toString()).iss === APP_ID;
};
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
github.setGitHubFetch(async (url, init = {}) => {
  const u = new URL(url); const auth = init.headers?.authorization; const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method: init.method || 'GET', path: u.pathname, auth });
  if (u.pathname === '/login/oauth/access_token') return json(200, body.code === 'good-code' ? { access_token: 'ghu_usertoken123' } : { error: 'bad_verification_code' });
  if (u.pathname === '/user/installations') {
    if (auth !== 'Bearer ghu_usertoken123') return json(401, {});
    return json(200, { installations: [{ id: MINE, app_id: Number(APP_ID), account: { login: 'me-on-github', type: 'User' }, repository_selection: 'selected' },
      { id: OTHER_APP, app_id: 1, account: { login: 'me-on-github', type: 'User' } }] });
  }
  if (u.pathname.startsWith('/applications/')) return new Response(null, { status: 204 });
  const tok = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(u.pathname);
  if (tok) {
    if (!verifyAppJwt(auth)) return json(401, { message: 'bad jwt' });
    const t = `ghs_${crypto.randomBytes(12).toString('hex')}`;
    minted.push({ installation: Number(tok[1]), token: t, repositories: body?.repositories || null, permissions: body?.permissions || null });
    return json(201, { token: t, expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (u.pathname === '/installation/repositories') {
    const t = minted.find((m) => `Bearer ${m.token}` === auth);
    if (!t) return json(401, {});
    return json(200, { repositories: t.installation === MINE ? [
      { full_name: 'me-on-github/private-app', private: true, default_branch: 'main', pushed_at: '2026-11-19T10:00:00Z' },
      { full_name: 'me-on-github/old-lib', private: false, default_branch: 'master', pushed_at: '2025-01-01T00:00:00Z' }] : [{ full_name: 'someone/else', private: true }] });
  }
  const inst = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(u.pathname);
  if (inst) {
    if (!verifyAppJwt(auth)) return json(401, {});
    if (inst[1] === 'me-on-github') return json(200, { id: MINE });
    if (inst[1] === 'someone') return json(200, { id: THEIRS });
    return json(404, { message: 'Not Found' });
  }
  return json(404, { message: `unexpected ${u.pathname}` });
});

// --- a stand-in machine ------------------------------------------------------------------------------------------------
const ran = [];
const execReply = (obj) => ({ body: (async function* () { yield Buffer.from(`${JSON.stringify({ stream: 'stdout', data: Buffer.from(JSON.stringify(obj) + '\n').toString('base64') })}\n${JSON.stringify({ done: true, exitCode: 0 })}\n`); })() });
setComputeBackend({ name: 'fake', create: async () => ({ ref: 'f' }), start: async () => ({ state: 'running' }),
  stop: async () => ({ state: 'stopped', saved: null, saveError: null }), remove: async () => {}, save: async () => ({ saved: { bytes: 1 } }),
  readFile: async () => { throw Object.assign(new Error('No such file'), { code: 'not_found', statusCode: 404 }); },
  writeFile: async (m, path) => ({ path }),
  exec: async (m, req) => {
    const stdin = req.stdin ? JSON.parse(Buffer.from(req.stdin, 'base64').toString('utf8')) : null;
    ran.push({ argv: req.argv, stdin, timeoutMs: req.timeoutMs });
    if (req.argv.at(-1) === 'list') return execReply({ ok: true, repositories: [{ path: '/home/xeno/repos/github.com/me-on-github/private-app', host: 'github.com', fullName: 'me-on-github/private-app', branch: 'main', usedAt: '2026-11-19T11:00:00Z' }] });
    const name = stdin.repository.replace(/^https:\/\/github\.com\//, '');
    return execReply({ ok: true, path: `/home/xeno/repos/github.com/${name}`, host: 'github.com', fullName: name, branch: 'main', existed: false });
  } });

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  const me = await user('me'); const other = await user('other'); const staff = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at, role) VALUES ($1,$2,'staff',true,true,'x',NOW(),'admin') RETURNING id`, [`${tag}_staff`, `${tag}_staff@xeno.test`])).rows[0].id;
  const ME = { id: me, kind: 'human' }; const OTHER = { id: other, kind: 'human' };
  await compute.setRate(pool, { id: staff, kind: 'human', role: 'admin' }, { size: 'small', creditsPerHour: 18 });
  await addGrant(pool, me, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${tag}-topup` });
  process.env.SHELL_ENABLED = '@xeno.test';

  // fail closed
  clearConfig();
  check((await github.githubStatus(pool, ME)).configured === false, 'without the App configured, GitHub reads as not set up');
  check(await code(() => github.connectUrl(ME)) === 'github_not_configured', 'and there is no connect link');
  check(await github.tokenForRepository(pool, ME, 'me-on-github/private-app') === null, 'and no token is ever minted');
  setConfig();

  // the connect link and its state
  check(await code(() => github.connectUrl({ id: me, kind: 'agent' })) === 'human_only', 'an agent never connects GitHub');
  const link = new URL(github.connectUrl(ME));
  check(link.origin === 'https://github.com' && link.pathname === '/apps/xenosystem-agent/installations/new', 'the connect link installs the XENO app');
  const state = link.searchParams.get('state');
  check(github.readState(state) === String(me), 'and its state names the person');
  const parts = state.split('.');
  check(github.readState([String(other), ...parts.slice(1)].join('.')) === null, 'a state rewritten to name somebody else is refused');
  check(github.readState(github.signState(me, { now: Date.now() - 31 * 60_000 })) === null, 'a state older than 30 minutes is refused');
  check(github.readState('nonsense') === null && github.readState(undefined) === null, 'a malformed state is refused');
  check(await code(() => github.completeConnect(pool, { code: 'good-code', state: 'forged.1.2.3' })) === 'github_state_invalid', 'a callback with a forged state records nothing');

  // the callback
  const done = await github.completeConnect(pool, { code: 'good-code', state });
  const rows = (await pool.query('SELECT installation_id, app_id, account FROM github_installations WHERE registered_by_user_id = $1', [me])).rows;
  check(done.userId === String(me) && rows.length === 1 && rows[0].id !== null && rows[0].installation_id === String(MINE) && rows[0].app_id === APP_ID && rows[0].account === 'me-on-github', 'only the installation of THIS app is recorded, in the one GitHub record, as the person’s');
  check((await pool.query('SELECT approved FROM github_apps WHERE app_id = $1', [APP_ID])).rows[0]?.approved === true, 'the XENO app is an approved app in that record');
  check(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/applications/Iv1.test/token')), 'the one-time GitHub sign-in is revoked once it was used');
  const stored = JSON.stringify((await pool.query('SELECT * FROM github_installations')).rows) + JSON.stringify((await pool.query('SELECT * FROM github_apps')).rows);
  check(!/ghu_|ghs_|client-secret/.test(stored), 'no GitHub token or secret is stored');
  check(await code(() => github.completeConnect(pool, { code: 'bad-code', state })) === 'github_exchange_failed', 'a code GitHub does not accept connects nothing');

  // the list
  const st = await github.githubStatus(pool, ME);
  check(st.connected && st.installations.length === 1 && st.installations[0].account === 'me-on-github', 'the status shows the connected account');
  const allowed = await github.listRepositories(pool, ME);
  check(allowed.map((r) => r.fullName).join() === 'me-on-github/private-app,me-on-github/old-lib', 'the list is the repositories the person allowed, newest push first');
  check(!JSON.stringify(allowed).includes('ghs_'), 'and it carries no token');
  check(minted.at(-1).permissions && Object.keys(minted.at(-1).permissions).join() === 'metadata', 'listing asks GitHub for read-only metadata access');
  check((await github.githubStatus(pool, OTHER)).connected === false, 'somebody else has nothing connected');

  // the picker's list starts nothing
  const startsBefore = (await pool.query("SELECT count(*)::int AS n FROM compute_machines WHERE created_by_user_id = $1", [me])).rows[0].n;
  const pick = await cloudRepositories(pool, ME, { github });
  check(pick.machine === 'none' && pick.onMachine.length === 0 && pick.allowed.length === 2 && pick.github.connected, 'before a session exists the picker shows GitHub’s list');
  check((await pool.query("SELECT count(*)::int AS n FROM compute_machines WHERE created_by_user_id = $1", [me])).rows[0].n === startsBefore && ran.length === 0, 'and listing created and ran nothing');

  // opening a repository the person allowed
  const opened = await openCloudRepository(pool, ME, { repository: 'me-on-github/private-app', github });
  const call = ran.at(-1);
  check(opened.repository.fullName === 'me-on-github/private-app' && opened.repository.withAccess === true, 'opening an allowed repository clones it with access');
  check(call.argv.join(' ') === 'node /machine/agenthost/repo.mjs open' && !call.argv.join(' ').includes('ghs_'), 'the machine runs the one command, with no token in its arguments');
  const forIt = minted.at(-1);
  check(call.stdin.token === forIt.token && forIt.installation === MINE, 'the token reaches git through standard input');
  check(JSON.stringify(forIt.repositories) === '["private-app"]' && forIt.permissions.contents === 'write' && forIt.permissions.pull_requests === 'write', 'and it is a token for THAT repository alone');
  const everywhere = JSON.stringify((await pool.query('SELECT * FROM compute_machine_events').catch(() => ({ rows: [] }))).rows) + JSON.stringify((await pool.query('SELECT * FROM github_installations')).rows)
    + JSON.stringify((await pool.query('SELECT * FROM github_app_tokens')).rows);
  check(!everywhere.includes(forIt.token), 'and the platform stores it nowhere');
  const rec = (await pool.query('SELECT repositories, minted_for_user_id::text AS who FROM github_app_tokens WHERE token_digest = $1', [crypto.createHash('sha256').update(forIt.token).digest('hex')])).rows[0];
  check(rec && JSON.stringify(rec.repositories) === '["me-on-github/private-app"]' && rec.who === String(me), 'only its digest is kept: for whom, which repository');
  const listed = await cloudRepositories(pool, ME, { github });
  check(listed.machine === 'running' && listed.onMachine[0].fullName === 'me-on-github/private-app', 'once the machine runs, the picker also lists what is on it');

  // repositories the person did not allow
  await openCloudRepository(pool, ME, { repository: 'torvalds/linux', github });
  check(!('token' in ran.at(-1).stdin), 'a repository none of their installations covers opens without a token');
  await openCloudRepository(pool, ME, { repository: 'https://github.com/someone/else', github });
  check(!('token' in ran.at(-1).stdin), 'an installation that is somebody else’s gives no token');
  const mintedFor = minted.filter((m) => m.installation === THEIRS).length;
  check(mintedFor === 0, 'and no token was ever minted on it');
  check(await code(() => openCloudRepository(pool, { id: me, kind: 'agent' }, { repository: 'a/b', github })) === 'human_only', 'an agent never opens a repository this way');
  check(await code(() => openCloudRepository(pool, ME, { repository: '', github })) === 'invalid_repository', 'an empty name is refused before anything runs');

  // disconnect
  await github.disconnect(pool, ME, String(MINE));
  check((await github.githubStatus(pool, ME)).connected === false && await github.tokenForRepository(pool, ME, 'me-on-github/private-app') === null, 'after disconnecting, XENO mints nothing for that account');
  check(await code(() => github.disconnect(pool, OTHER, String(MINE))) === 'not_found', 'somebody else cannot disconnect it');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });

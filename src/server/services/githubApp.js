/**
 * GitHub for XENO, through the XENO GitHub App "XENOSYSTEM Agent" (github.com/apps/xenosystem-agent, owned by
 * XENO-CORPORATION, registered 2026-11-19). Owner, 2026-11-19: "ok should we, ok, let's implement this, right?" for the
 * repository picker on Cloud; the app was registered the same evening.
 *
 * Why an App and not an OAuth token: an App is installed by the person on their own account and they choose which
 * repositories it may see. XENO then asks GitHub for an installation token that works for ONE repository and runs out
 * within the hour (Codespaces and Vercel work the same way). Nothing long-lived ever reaches a machine.
 *
 *   - connect:   the page asks for an install address carrying a signed state (who is connecting, for 30 minutes).
 *   - setup:     GitHub sends the person back to /api/github/setup. The installation id in that address is NOT proof
 *                (anyone can type one), so the platform sends them through GitHub's sign-in once ("authorize"), and
 *   - callback:  with that one-time user token asks GitHub which installations of THIS app the person can reach. Only
 *                those are recorded as theirs. The user token is used once and never stored.
 *   - list:      the repositories the person allowed, read from GitHub with installation tokens (metadata only).
 *   - token:     a token for one repository (contents + pull requests), minted when a cloud session opens it.
 *
 * Records: the platform's ONE GitHub record, the FORGE-03 tables (github_apps, github_installations, github_app_tokens,
 * migration 20261004500000). An installation's `registered_by_user_id` is the person who connected it; a token is kept
 * only as its SHA-256 digest. `uninstalled` means XENO no longer uses it (disconnected here, or gone on GitHub).
 *
 * Configuration (the box's .env, listed in docker-compose.yml): XENO_GITHUB_APP_ID, XENO_GITHUB_APP_SLUG,
 * XENO_GITHUB_APP_CLIENT_ID, XENO_GITHUB_APP_CLIENT_SECRET, XENO_GITHUB_APP_PRIVATE_KEY_B64. Without them every call
 * says "not configured" (fail closed); nothing falls back to a personal token.
 */
import crypto from 'node:crypto';

export class GitHubAppError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

const API = 'https://api.github.com';
const APP_NAME = 'XENOSYSTEM Agent';
const STATE_TTL_MS = 30 * 60_000;
const MAX_PAGES = 10;
/** What a token for one repository may do in a cloud session: read and push code, open and update pull requests. */
export const REPOSITORY_PERMISSIONS = Object.freeze({ contents: 'write', pull_requests: 'write', metadata: 'read' });

let fetchImpl = (...args) => fetch(...args);
/** Tests replace GitHub. */
export function setGitHubFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

export function appConfig(env = process.env) {
  const id = env.XENO_GITHUB_APP_ID; const key = env.XENO_GITHUB_APP_PRIVATE_KEY_B64;
  const slug = env.XENO_GITHUB_APP_SLUG; const clientId = env.XENO_GITHUB_APP_CLIENT_ID; const clientSecret = env.XENO_GITHUB_APP_CLIENT_SECRET;
  if (!id || !key || !slug || !clientId || !clientSecret) return null;
  return { id: String(id), slug, clientId, clientSecret, privateKey: Buffer.from(key, 'base64').toString('utf8') };
}
const requireConfig = () => {
  const c = appConfig();
  if (!c) throw new GitHubAppError('GitHub is not connected to XENO on this server yet', 'github_not_configured', 503);
  return c;
};

const b64u = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** The App's own JWT (RS256, 9 minutes, issued a minute in the past for clock skew), as GitHub documents. */
export function appJwt(config = requireConfig(), now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60;
  const unsigned = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iat, exp: iat + 540, iss: config.id })}`;
  return `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(config.privateKey).toString('base64url')}`;
}

async function gh(path, { method = 'GET', token, body, base = API } = {}) {
  const res = await fetchImpl(`${base}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'xeno-platform',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

// --- the signed state that says who is connecting -------------------------------------------------------------------

const stateKey = (env = process.env) => {
  const secret = env.GITHUB_CONNECT_STATE_SECRET || env.JWT_SECRET;
  if (!secret) throw new GitHubAppError('The server has no signing key', 'github_not_configured', 503);
  return crypto.createHmac('sha256', String(secret)).update('xeno-github-connect-state/1').digest();
};

export function signState(userId, { now = Date.now() } = {}) {
  const body = `${userId}.${now + STATE_TTL_MS}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')}`;
}

/** The user id the state was signed for, or null when it is forged, malformed or expired. */
export function readState(state, { now = Date.now() } = {}) {
  if (typeof state !== 'string' || state.length > 300) return null;
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  const want = crypto.createHmac('sha256', stateKey()).update(body).digest();
  let got; try { got = Buffer.from(parts[3], 'base64url'); } catch { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  if (!(Number(parts[1]) > now)) return null;
  return parts[0];
}

// --- connecting -----------------------------------------------------------------------------------------------------

function personOf(actor) {
  if (!actor || !actor.id) throw new GitHubAppError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'agent' || actor.kind === 'service') throw new GitHubAppError('GitHub is connected by a person', 'human_only', 403);
  return String(actor.id);
}

/** Where to send the person to install the App (or change which repositories it may see). */
export function connectUrl(actor) {
  const c = requireConfig();
  return `https://github.com/apps/${encodeURIComponent(c.slug)}/installations/new?state=${encodeURIComponent(signState(personOf(actor)))}`;
}

/** After the install: GitHub's sign-in once, so the installations can be checked as the person (see the header). */
export function authorizeUrl(state, redirectUri) {
  const c = requireConfig();
  return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(c.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

/**
 * GitHub's sign-in came back: exchange the code, ask which installations of this App the GitHub user can reach, and
 * record those as the XENO person's. Returns the installations recorded. The user token is used here and dropped.
 */
export async function completeConnect(db, { code, state }) {
  const c = requireConfig();
  const userId = readState(state);
  if (!userId) throw new GitHubAppError('That GitHub connection link has run out. Start again from XENO.', 'github_state_invalid', 400);
  if (typeof code !== 'string' || !code || code.length > 200) throw new GitHubAppError('GitHub did not finish the sign-in', 'github_code_missing', 400);
  const exchange = await gh('/login/oauth/access_token', { method: 'POST', base: 'https://github.com',
    body: { client_id: c.clientId, client_secret: c.clientSecret, code } });
  const userToken = exchange.data && exchange.data.access_token;
  if (!userToken) throw new GitHubAppError('GitHub did not accept the sign-in', 'github_exchange_failed', 502);
  const found = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const r = await gh(`/user/installations?per_page=100&page=${page}`, { token: userToken });
    if (!r.ok) throw new GitHubAppError('GitHub would not list your installations', 'github_list_failed', 502);
    const list = (r.data && r.data.installations) || [];
    for (const i of list) if (String(i.app_id) === c.id) found.push(i);
    if (list.length < 100) break;
  }
  // the one-time user token is revoked: XENO keeps no GitHub sign-in of the person's
  await fetchImpl(`${API}/applications/${encodeURIComponent(c.clientId)}/token`, { method: 'DELETE',
    headers: { accept: 'application/vnd.github+json', authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'content-type': 'application/json', 'user-agent': 'xeno-platform' },
    body: JSON.stringify({ access_token: userToken }) }).catch(() => {});
  // The ONE record of GitHub Apps and installations on the platform (the FORGE-03 tables, 20261004500000): the App is a
  // row there, approved by configuration, and each installation names the person who connected it.
  if (found.length) {
    await db.query(`INSERT INTO github_apps (app_id, name, approved, approved_at) VALUES ($1, $2, TRUE, now()) ON CONFLICT (app_id) DO NOTHING`, [c.id, APP_NAME]);
  }
  for (const i of found) {
    await db.query(
      `INSERT INTO github_installations (installation_id, app_id, account, permissions, suspended, registered_by_user_id, uninstalled, uninstalled_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, NULL)
       ON CONFLICT (installation_id) DO UPDATE SET account = EXCLUDED.account, permissions = EXCLUDED.permissions,
         suspended = EXCLUDED.suspended, registered_by_user_id = EXCLUDED.registered_by_user_id, uninstalled = FALSE, uninstalled_at = NULL`,
      [String(i.id), c.id, (i.account?.login || String(i.id)).slice(0, 200), JSON.stringify(i.permissions || {}), !!i.suspended_at, userId]);
  }
  return { userId, installations: found.map((i) => ({ id: i.id, account: i.account?.login || '' })) };
}

async function installationsOf(db, userId) {
  const c = appConfig();
  if (!c) return [];
  return (await db.query(
    `SELECT installation_id, account FROM github_installations
      WHERE registered_by_user_id = $1 AND app_id = $2 AND NOT uninstalled AND NOT suspended ORDER BY created_at`, [userId, c.id])).rows;
}

const markRemoved = (db, installationId) => db.query('UPDATE github_installations SET uninstalled = TRUE, uninstalled_at = now() WHERE installation_id = $1 AND NOT uninstalled', [String(installationId)]);

/** An installation token. `repositories` (names) narrows it; `permissions` narrows what it may do. */
async function installationToken(db, installationId, { repositories, permissions } = {}) {
  const r = await gh(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: 'POST', token: appJwt(),
    body: { ...(repositories ? { repositories } : {}), ...(permissions ? { permissions } : {}) } });
  if (r.status === 404 || r.status === 403 && /suspended/i.test(JSON.stringify(r.data || ''))) { await markRemoved(db, installationId); return null; }
  if (!r.ok || !r.data || !r.data.token) throw new GitHubAppError('GitHub would not give XENO access right now', 'github_token_failed', 502);
  return { token: r.data.token, expiresAt: r.data.expires_at };
}

/** Whether GitHub is set up here, and which accounts the person has connected. */
export async function githubStatus(db, actor) {
  const userId = personOf(actor);
  if (!appConfig()) return { configured: false, connected: false, installations: [] };
  const rows = await installationsOf(db, userId);
  return { configured: true, connected: rows.length > 0,
    installations: rows.map((r) => ({ id: String(r.installation_id), account: r.account })) };
}

/** The repositories the person allowed, across their installations, newest push first. Never a token. */
export async function listRepositories(db, actor) {
  const userId = personOf(actor);
  requireConfig();
  const out = [];
  for (const inst of await installationsOf(db, userId)) {
    const t = await installationToken(db, inst.installation_id, { permissions: { metadata: 'read' } });
    if (!t) continue;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const r = await gh(`/installation/repositories?per_page=100&page=${page}`, { token: t.token });
      if (!r.ok) break;
      const list = (r.data && r.data.repositories) || [];
      for (const repo of list) out.push({ fullName: repo.full_name, private: !!repo.private, defaultBranch: repo.default_branch || '',
        pushedAt: repo.pushed_at || null, account: inst.account });
      if (list.length < 100) break;
    }
  }
  out.sort((a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')));
  return out;
}

/** owner/name on github.com for what a person typed, or null (anything else is opened without a token). */
export function githubRepoOf(input) {
  if (typeof input !== 'string') return null;
  let t = input.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(t);
  if (ssh) t = ssh[1];
  else if (/^https:\/\/(www\.)?github\.com\//i.test(t)) t = t.replace(/^https:\/\/(www\.)?github\.com\//i, '');
  else if (/^[a-z][a-z0-9+.-]*:/i.test(t) || /^[^/]+\.[a-z]{2,}\//i.test(t)) return null;
  const [owner, name] = t.split('/');
  if (!owner || !name || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) return null;
  return { owner, name, fullName: `${owner}/${name}` };
}

/**
 * A token for ONE repository the person allowed, for a cloud session to clone and push it. Null when the repository
 * is not on github.com or none of the person's installations covers it (a public repository then opens without one).
 */
export async function tokenForRepository(db, actor, repository) {
  const userId = personOf(actor);
  const repo = githubRepoOf(repository);
  if (!repo || !appConfig()) return null;
  const mine = new Map((await installationsOf(db, userId)).map((r) => [String(r.installation_id), r]));
  if (!mine.size) return null;
  const r = await gh(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/installation`, { token: appJwt() });
  if (!r.ok || !r.data || !mine.has(String(r.data.id))) return null;
  const t = await installationToken(db, r.data.id, { repositories: [repo.name], permissions: { ...REPOSITORY_PERMISSIONS } });
  if (!t) return null;
  // its digest only, in the one token record (FORGE-03's github_app_tokens): who it was for, which repository, until when
  await db.query(
    `INSERT INTO github_app_tokens (installation_id, token_digest, repositories, permissions, expires_at, minted_by_user_id, minted_for_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [String(r.data.id), crypto.createHash('sha256').update(t.token).digest('hex'), JSON.stringify([repo.fullName]), JSON.stringify(REPOSITORY_PERMISSIONS),
      t.expiresAt || new Date(Date.now() + 3600_000).toISOString(), userId]);
  return { ...t, fullName: repo.fullName };
}

/** Forget an account the person connected (XENO stops using it; uninstalling on GitHub is theirs to do). */
export async function disconnect(db, actor, installationId) {
  const userId = personOf(actor);
  const r = await db.query('UPDATE github_installations SET uninstalled = TRUE, uninstalled_at = now() WHERE installation_id = $1 AND registered_by_user_id = $2 AND NOT uninstalled', [String(installationId), userId]);
  if (!r.rowCount) throw new GitHubAppError('That GitHub account is not connected', 'not_found', 404);
  return { removed: true };
}

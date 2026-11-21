// XENO Depot audience + authority (services/depotAuthority.js, decision 0001 §3), against real Postgres.
// Proves, with tokens minted by the real code exchange:
//   - the Depot CLI's token names 'xeno-depot'; the platform's own verifier refuses it, and Depot's refuses a xeno-api one
//   - self-registration: depot:* alone → the depot audience; mixed with another area → refused
//   - the door: staff and staff's agents in, everyone else out; a service account never; no policy row → closed
//   - grants: workspace role base + explicit grants, implication, scope ceiling, never confirming an unreadable repo,
//     cross-workspace registration refused, last admin kept, grantees must belong to the workspace
//   - an agent sign-in acts with its PERSON's access and reports the agent as the actor
//   - live: suspension and lost membership take effect on the next call
//   - the service route fails closed without its token, and the migration's DOWN refuses while another product uses 'staff'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import {
  createAuthorizationCode, exchangeAuthorizationCode, registerDynamicClient, verifyAccessToken, DEPOT_AUDIENCE,
} from '../utils/oidcProvider.js';
import * as depot from '../services/depotAuthority.js';
import { createDepotAuthorityRouter } from '../routes/depotAuthorityRoutes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, '../database/migrations/20261205093000-depot-staff-door.sql'), 'utf8');
const [UP, DOWN] = MIGRATION.split(/^-- DOWN$/m);
const CREDENTIALS = fs.readFileSync(path.join(here, '../database/migrations/20261205100000-depot-agent-credentials.sql'), 'utf8');
const [CREDENTIALS_UP, CREDENTIALS_DOWN] = CREDENTIALS.split(/^-- DOWN$/m);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const CB = 'http://127.0.0.1/callback';

async function setup() {
  await pool.query('CREATE TABLE credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))');
  await pool.query('CREATE TABLE external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())');
  await migrateAccountV2(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text,
    display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true,
    role text DEFAULT 'user', status text DEFAULT 'active')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_identities (user_id uuid PRIMARY KEY, owner_user_id uuid, agent_role text,
    agent_origin text, status text DEFAULT 'active', created_at timestamptz DEFAULT now(), public_id text, workforce_resource_id uuid)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'w', status text NOT NULL DEFAULT 'active', workspace_type text NOT NULL DEFAULT 'team')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workforce_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_workspace_id uuid, owner_user_id uuid)`);
  await pool.query(CREDENTIALS_UP);
  await pool.query(`CREATE TABLE IF NOT EXISTS mcp_client_agent_bindings (owner_user_id uuid NOT NULL, client_id text NOT NULL,
    agent_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, client_id))`);
  // the door table exactly as its own migration made it, then THIS change's UP
  await pool.query(`CREATE TABLE product_access_policy (product TEXT PRIMARY KEY,
    access TEXT NOT NULL CHECK (access IN ('account', 'paid-plan')), message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by UUID)`);
  await pool.query(UP);
  // the REAL seed (the only writer of first-party oauth_clients rows), which must write each client's audience
  await migrateOidcClients(pool);
  const aud = Object.fromEntries((await pool.query("SELECT client_id, access_audience FROM oauth_clients WHERE is_first_party")).rows.map((r) => [r.client_id, r.access_audience]));
  assert.equal(aud['xeno-depot-cli'], 'xeno-depot');
  assert.ok(Object.entries(aud).every(([id, a]) => id === 'xeno-depot-cli' || a === 'xeno-api'), 'every other first-party client stays xeno-api');
  // a row whose audience was changed by hand is put back by the next seed run: the seed owns it
  await pool.query("UPDATE oauth_clients SET access_audience = 'xeno-api' WHERE client_id = 'xeno-depot-cli'");
  await migrateOidcClients(pool);
  assert.equal((await pool.query("SELECT access_audience FROM oauth_clients WHERE client_id = 'xeno-depot-cli'")).rows[0].access_audience, 'xeno-depot');

  const user = async (handle, role = 'user') => (await pool.query(
    'INSERT INTO users (email, username, display_name, role) VALUES ($1,$2,$2,$3) RETURNING id', [`${handle}@xeno.test`, handle, role])).rows[0].id;
  const staff = await user('staff', 'admin');
  const mate = await user('mate');          // a plain member of the same workspace
  const outsider = await user('outsider');  // not staff
  const robot = await user('robot.staff');
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin) VALUES ($1,$2,'worker','mcp')", [robot, staff]);
  const service = await user('svc', 'service');
  const ws = (await pool.query('INSERT INTO workspaces (owner_user_id) VALUES ($1) RETURNING id', [staff])).rows[0].id;
  const ws2 = (await pool.query('INSERT INTO workspaces (owner_user_id) VALUES ($1) RETURNING id', [mate])).rows[0].id;
  await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES
    ('workspace',$1,'owner','user',$2), ('workspace',$1,'editor','user',$3), ('workspace',$4,'owner','user',$3)`, [ws, staff, mate, ws2]);
  return { staff, mate, outsider, robot, service, ws, ws2 };
}

async function signIn(userId, clientId, scope) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const code = await createAuthorizationCode(pool, {
    clientId, userId, redirectUri: CB, scope, codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  });
  return (await exchangeAuthorizationCode(pool, { code, clientId, redirectUri: CB, codeVerifier: verifier })).access_token;
}
const refusal = (promise, code) => assert.rejects(promise, (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return true; });

async function main() {
  const u = await setup();
  const ALL = 'openid depot:read depot:write depot:admin';

  // ── 1. Audience: the Depot CLI's token is Depot's, and only Depot's.
  const staffTok = await signIn(u.staff, 'xeno-depot-cli', ALL);
  const [, body] = staffTok.split('.');
  assert.equal(JSON.parse(Buffer.from(body, 'base64url')).aud, DEPOT_AUDIENCE);
  await assert.rejects(verifyAccessToken(pool, staffTok), /invalid/);                          // the platform refuses it
  const pixelTok = await signIn(u.staff, 'xeno-pixel', 'openid profile');
  await refusal(depot.verifyToken(pool, pixelTok), 'invalid_token');                           // Depot refuses xeno-api
  await refusal(depot.verifyToken(pool, 'not-a-jwt'), 'invalid_token');

  // ── 2. Self-registration: depot:* alone is a Depot client; mixed with another area is refused.
  const reg = await registerDynamicClient(pool, { client_name: 'Claude Code', redirect_uris: [CB], scope: 'depot:read depot:write' });
  assert.equal((await pool.query('SELECT access_audience, surface FROM oauth_clients WHERE client_id = $1', [reg.client_id])).rows[0].access_audience, DEPOT_AUDIENCE);
  await assert.rejects(registerDynamicClient(pool, { client_name: 'Mixed', redirect_uris: [CB], scope: 'depot:read tasks:read' }), /register a client of their own/);

  // ── 3. The door.
  const staff = await depot.verifyToken(pool, staffTok);
  assert.equal(staff.via, 'person');
  assert.equal((await depot.authorityFor(pool, staff)).door.allowed, true);
  const outsider = await depot.verifyToken(pool, await signIn(u.outsider, 'xeno-depot-cli', ALL));
  const shut = (await depot.authorityFor(pool, outsider)).door;
  assert.equal(shut.allowed, false); assert.equal(shut.reason, 'staff_only');
  await refusal(depot.registerRepo(pool, outsider, { repoId: 'x1', workspaceId: u.ws }), 'door_closed');
  const svc = await depot.actorForSession(pool, u.service);
  assert.equal((await depot.doorFor(pool, svc)).reason, 'service_not_allowed');

  // ── 4. Register, permissions, ceiling.
  const r1 = await depot.registerRepo(pool, staff, { repoId: 'citadel', workspaceId: u.ws });
  assert.deepEqual(r1, { id: 'citadel', workspaceId: u.ws, created: true });
  assert.equal((await depot.registerRepo(pool, staff, { repoId: 'citadel', workspaceId: u.ws })).created, false);   // idempotent
  await refusal(depot.registerRepo(pool, staff, { repoId: 'citadel', workspaceId: u.ws2 }), 'not_allowed');       // not their workspace
  await refusal(depot.registerRepo(pool, staff, { repoId: '../etc', workspaceId: u.ws }), 'invalid_repo_id');
  assert.deepEqual((await depot.authorityFor(pool, staff, { repoId: 'citadel' })).repo.permissions,
    ['read', 'write', 'review', 'merge', 'lock', 'admin']);
  const readOnly = await depot.verifyToken(pool, await signIn(u.staff, 'xeno-depot-cli', 'openid depot:read'));
  assert.deepEqual((await depot.authorityFor(pool, readOnly, { repoId: 'citadel' })).repo.permissions, ['read']);   // ceiling
  await refusal(depot.registerRepo(pool, readOnly, { repoId: 'other', workspaceId: u.ws }), 'insufficient_scope');
  const unknown = (await depot.authorityFor(pool, staff, { repoId: 'nope' })).repo;
  assert.deepEqual([unknown.registered, unknown.permissions], [false, []]);

  // the member: staff-only door, so give mate staff to test their base role (then take it back below)
  await pool.query("UPDATE users SET role = 'moderator' WHERE id = $1", [u.mate]);
  const mate = await depot.verifyToken(pool, await signIn(u.mate, 'xeno-depot-cli', ALL));
  assert.deepEqual((await depot.authorityFor(pool, mate, { repoId: 'citadel' })).repo.permissions, ['read', 'write', 'review', 'lock']);  // member base: no merge
  await refusal(depot.grant(pool, mate, { repoId: 'citadel', userId: u.mate, permission: 'merge' }), 'not_allowed');
  assert.equal((await depot.grant(pool, staff, { repoId: 'citadel', userId: u.mate, permission: 'merge' })).added, true);
  assert.ok((await depot.authorityFor(pool, mate, { repoId: 'citadel' })).repo.permissions.includes('merge'));
  await refusal(depot.grant(pool, staff, { repoId: 'citadel', userId: u.outsider, permission: 'read' }), 'not_a_member');
  await refusal(depot.grant(pool, staff, { repoId: 'citadel', userId: u.mate, permission: 'owner' }), 'invalid_permission');
  const grants = await depot.listGrants(pool, staff, { repoId: 'citadel' });
  assert.deepEqual(grants.grants.map((g) => `${g.permission}:${g.userId === u.staff ? 'staff' : 'mate'}`).sort(), ['admin:staff', 'merge:mate']);
  await refusal(depot.revoke(pool, staff, { repoId: 'citadel', userId: u.staff, permission: 'admin' }), 'last_admin');
  assert.equal((await depot.revoke(pool, staff, { repoId: 'citadel', userId: u.mate, permission: 'merge' })).removed, true);

  // never confirm a repo to someone who cannot read it: a staff member of ANOTHER workspace gets not-found, not forbidden
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.outsider]);
  const stranger = await depot.verifyToken(pool, await signIn(u.outsider, 'xeno-depot-cli', ALL));
  await refusal(depot.listGrants(pool, stranger, { repoId: 'citadel' }), 'repo_not_found');
  assert.deepEqual((await depot.authorityFor(pool, stranger, { repoId: 'citadel' })).repo.permissions, []);
  assert.deepEqual((await depot.readableRepos(pool, stranger, { workspaceId: u.ws })).repos, []);
  assert.deepEqual((await depot.readableRepos(pool, staff, { workspaceId: u.ws })).repos.map((r) => r.id), ['citadel']);

  // ── 5. An agent sign-in acts with its person's access, and says it is the agent.
  await pool.query("UPDATE users SET display_name = 'Claude Code' WHERE id = $1", [u.robot]);
  const agentTok = await signIn(u.staff, reg.client_id, 'openid depot:read depot:write');
  const agent = await depot.verifyToken(pool, agentTok);
  const a = await depot.authorityFor(pool, agent, { repoId: 'citadel' });
  assert.equal(a.principal.kind, 'agent'); assert.equal(a.principal.id, u.robot); assert.equal(a.principal.accountableUserId, u.staff);
  assert.equal(a.door.allowed, true);                                     // a staff member's agent
  assert.deepEqual(a.repo.permissions, ['read', 'write', 'review', 'merge', 'lock']);   // the person's, cut to depot:write

  // ── 6. Live: suspension and lost membership apply on the next call.
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [u.staff]);
  assert.equal((await depot.authorityFor(pool, agent, { repoId: 'citadel' })).door.allowed, false);   // owner suspended → agent out
  await pool.query('UPDATE users SET is_active = true WHERE id = $1', [u.staff]);
  await pool.query("DELETE FROM relationship_tuples WHERE object_type = 'workspace' AND object_id = $1 AND subject_id = $2", [u.ws, u.mate]);
  assert.deepEqual((await depot.authorityFor(pool, mate, { repoId: 'citadel' })).repo.permissions, []);

  // ── 7. The service route fails closed and round-trips.
  const secret = crypto.randomBytes(24).toString('base64url');
  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/a', createDepotAuthorityRouter({ getExpected: () => secret }));
  app.use('/closed', createDepotAuthorityRouter({ getExpected: () => '' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, auth = `Bearer ${secret}`) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/a/token', { token: staffTok }, '')).status, 401);
    assert.equal((await post('/a/token', { token: staffTok }, 'Bearer wrong')).status, 401);
    assert.equal((await post('/closed/token', { token: staffTok }, 'Bearer ')).status, 401);
    assert.equal((await post('/a/token', { token: pixelTok })).status, 401);
    const ok = await (await post('/a/token', { token: staffTok, repoId: 'citadel' })).json();
    assert.deepEqual(ok.repo.permissions, ['read', 'write', 'review', 'merge', 'lock', 'admin']);
    assert.equal((await post('/a/repos/citadel/grants/list', { token: pixelTok })).status, 401);
    assert.equal((await post('/a/repos/citadel/delete', { token: staffTok })).status, 200);
    assert.equal((await depot.authorityFor(pool, staff, { repoId: 'citadel' })).repo.registered, false);
  } finally { server.close(); }

  // ── 7b. Headless agents: an xdp_ credential acts as the AGENT, with its own grants, under its own scopes.
  const me = await (await import('../services/agentIdentity.js')).resolvePrincipal(pool, u.staff);
  await depot.registerRepo(pool, staff, { repoId: 'build', workspaceId: u.ws });
  await refusal(depot.issueAgentCredential(pool, me, { agentId: u.robot, scopes: ['tasks:read'] }), 'invalid_scope');
  const robotMe = await (await import('../services/agentIdentity.js')).resolvePrincipal(pool, u.robot);
  await refusal(depot.issueAgentCredential(pool, robotMe, { agentId: u.robot }), 'not_allowed');           // an agent never issues one
  const outsiderMe = await (await import('../services/agentIdentity.js')).resolvePrincipal(pool, u.outsider);
  await refusal(depot.issueAgentCredential(pool, outsiderMe, { agentId: u.robot }), 'agent_not_found');    // not their agent
  const cred = await depot.issueAgentCredential(pool, me, { agentId: u.robot, scopes: ['depot:read'], label: 'Runner' });
  assert.match(cred.token, /^xdp_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
  const stored = (await pool.query('SELECT token_hash, token_prefix FROM depot_agent_credentials WHERE id = $1', [cred.id])).rows[0];
  assert.notEqual(stored.token_hash, cred.token); assert.ok(!JSON.stringify(stored).includes(cred.token.split('_')[2]));   // the secret is never stored
  const listed = await depot.listAgentCredentials(pool, me);
  assert.deepEqual(listed.credentials.map((c) => [c.id, c.hint]), [[cred.id, `xdp_${stored.token_prefix}_…`]]);
  assert.ok(!JSON.stringify(listed).includes(cred.token));
  const runner = await depot.verifyToken(pool, cred.token);
  assert.deepEqual([runner.via, runner.principal.id, runner.accountableId], ['agent', u.robot, u.staff]);
  assert.deepEqual((await depot.authorityFor(pool, runner, { repoId: 'build' })).repo.permissions, []);    // no grant yet: nothing
  await depot.grant(pool, staff, { repoId: 'build', userId: u.robot, permission: 'merge' });
  assert.deepEqual((await depot.authorityFor(pool, runner, { repoId: 'build' })).repo.permissions, ['read']);   // its scope caps merge to read
  const writerCred = await depot.issueAgentCredential(pool, me, { agentId: u.robot, scopes: ['depot:write'] });
  const writer = await depot.verifyToken(pool, writerCred.token);
  assert.deepEqual((await depot.authorityFor(pool, writer, { repoId: 'build' })).repo.permissions, ['read', 'write', 'review', 'merge', 'lock']);
  await refusal(depot.verifyToken(pool, `${cred.token.slice(0, -1)}${cred.token.endsWith('A') ? 'B' : 'A'}`), 'invalid_token');   // tampered
  await refusal(depot.verifyToken(pool, 'xdp_short'), 'invalid_token');
  assert.equal((await depot.revokeAgentCredential(pool, me, cred.id)).revoked, true);
  await refusal(depot.verifyToken(pool, cred.token), 'invalid_token');                                       // revoked → refused at once
  await refusal(depot.revokeAgentCredential(pool, outsiderMe, writer.credentialId), 'credential_not_found');
  await pool.query("UPDATE depot_agent_credentials SET expires_at = now() - interval '1 second' WHERE id = $1", [writer.credentialId]);
  await refusal(depot.verifyToken(pool, writerCred.token), 'invalid_token');                                // expired → refused
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM depot_agent_credentials WHERE revoked_at IS NULL AND expires_at > now()')).rows[0].n, 0);
  await assert.rejects(pool.query(`INSERT INTO depot_agent_credentials (token_prefix, token_hash, agent_user_id, owner_user_id, scopes, expires_at)
    VALUES ('abcdefghijkl', repeat('a', 64), $1, $2, ARRAY['tasks:read'], now() + interval '1 day')`, [u.robot, u.staff]), /check constraint/);
  const live = await depot.issueAgentCredential(pool, me, { agentId: u.robot });
  await assert.rejects(pool.query(CREDENTIALS_DOWN), /live credentials exist/);                             // DOWN refuses while one is live
  await depot.revokeAgentCredential(pool, me, live.id);

  // ── 8. The door policy is data: no row closes Depot; the DOWN refuses while another product uses 'staff'.
  await pool.query("INSERT INTO product_access_policy (product, access) VALUES ('other', 'staff')");
  await assert.rejects(pool.query(DOWN), /another product uses the staff access level/);
  await pool.query("DELETE FROM product_access_policy WHERE product IN ('other', 'depot')");
  assert.equal((await depot.doorFor(pool, staff)).reason, 'no_policy');
  await pool.query(DOWN);
  await assert.rejects(pool.query("INSERT INTO product_access_policy (product, access) VALUES ('x', 'staff')"), /check constraint/);
  console.log('depot-authority: ok');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

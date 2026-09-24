/**
 * XENO-WORKFORCE-01 ASN-07 and ASN-08 -- a project's directory is a binding on a named host.
 *
 *   ASN-07 reads: "Directory resource bindings include host/environment identity and canonical root.
 *            Identical path strings on different machines are not the same resource. Host
 *            realpath/symlink and platform permission enforcement remain authoritative."
 *   ASN-08 reads: "Keep existing project identities and personal/workspace ownership semantics. Reconcile
 *            Interface directory projections and Platform `chat_projects` through explicit ID
 *            mappings/bindings, not name/path equality. ... Research projects may have no
 *            directory; Agent execution still requires an authorized execution root."
 *
 * Driven through the REAL chat router behind the REAL auth middleware, with real OIDC access tokens
 * signed by the platform's own signing key and real DPoP proofs from TWO installations -- two
 * different key pairs, which is what two machines are. Real PostgreSQL, real ReBAC tuples.
 *
 *   1. Two hosts bind the SAME path string to DIFFERENT projects: both succeed, and each host's
 *      lookup of that path answers its own project. Same path, different machine, different resource.
 *   2. The host is the authenticated installation: a body naming another host is refused, a bearer
 *      token with no proof cannot bind at all, and a binding is revocable only from the host that made it.
 *   3. Roots must be canonical -- relative, dot segments, trailing or doubled separators, wrong
 *      separators are refused, never rewritten -- and Windows roots compare case-insensitively.
 *   4. Reconciliation is by id: two projects with the SAME NAME are told apart by their bindings,
 *      and renaming a project does not move its binding.
 *   5. A research project has no directory and that is legitimate; the execution root is then NULL,
 *      and it is null on a host where the project is bound elsewhere. Revoking the binding removes
 *      the execution root at once; an archived project admits no new binding.
 *   6. Ownership semantics are untouched: binding a directory changes no owner, no tuple and no
 *      project row, and a caller without `editor` on the project cannot bind it.
 *
 * Run: WORKSPACE_KEY_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workspacekeyproof \
 *      node --test scripts/project-directory-bindings.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the live-root key ignores the host              -> "the same path on another machine is another resource"
 *   - the service reads the host from the body         -> "the body cannot name the host"
 *   - revoke skips the host check                      -> "only the binding host may revoke it"
 *   - the canonical-root constraint is dropped         -> "a non-canonical root is refused, not rewritten"
 *   - Windows roots compare case-sensitively           -> "Windows roots compare case-insensitively"
 *   - execution root ignores the installation          -> "no execution root on a host where it is not bound"
 *   - execution root ignores revocation                -> "revoking the binding removes the execution root"
 *   - editor check dropped                             -> "a caller without editor cannot bind"
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import pg from 'pg';

import { authMiddleware } from '../src/server/middleware/auth.js';
import chatRoutes from '../src/server/routes/chatRoutes.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
import { accessTokenHash, jwkThumbprint } from '../src/server/utils/dpop.js';
import { getSigningKey } from '../src/server/utils/oidcProvider.js';

const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const url = process.env.WORKSPACE_KEY_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/workspacekeyproof') {
    throw new Error('Only the owned loopback workspacekeyproof database is allowed');
  }
}

test('project directories are bindings on authenticated hosts, reconciled by id (ASN-07, ASN-08)', { skip: !url }, async (t) => {
  const schema = `dir_bind_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
  let server;
  try {
    await pool.query(`CREATE SCHEMA "${schema}";
      CREATE TABLE users(id uuid PRIMARY KEY, username text, email text, display_name text, avatar_url text,
        created_at timestamptz DEFAULT now(), email_verified boolean DEFAULT true, is_active boolean DEFAULT true);
      CREATE TABLE credit_transactions(user_id uuid, reference_type text, reference_id text);
      CREATE TABLE user_sessions(id uuid PRIMARY KEY, user_id uuid, expires_at timestamptz, last_active_at timestamptz DEFAULT now());
      CREATE TABLE api_keys(id uuid PRIMARY KEY, user_id uuid, key_prefix text, key_hash text, is_active boolean,
        expires_at timestamptz, last_used_at timestamptz, usage_count integer DEFAULT 0);
      CREATE TABLE account_activations(user_id uuid PRIMARY KEY, method text);`);
    await migrateAccountV2(pool);
    const migration = (f) => readFile(new URL(`../src/server/database/migrations/${f}`, import.meta.url), 'utf8');
    await pool.query((await migration('20260711120000-workspaces.sql')).split('-- DOWN')[0]);
    await pool.query(`CREATE TABLE chat_projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      owner_user_id uuid, workspace_id uuid REFERENCES workspaces(id), name text NOT NULL, is_archived boolean NOT NULL DEFAULT false,
      updated_at timestamptz DEFAULT now())`);
    const [up, down] = (await migration('20260924170000-project-directory-bindings.sql')).split('-- DOWN');
    await pool.query(up); await pool.query(down); await pool.query(up);

    const users = Object.fromEntries(['owner', 'reader', 'outsider'].map((n) => [n, crypto.randomUUID()]));
    for (const [name, id] of Object.entries(users)) {
      await pool.query('INSERT INTO users(id,username,email,display_name) VALUES($1,$2,$3,$2)', [id, name, `${name}@example.test`]);
    }
    const project = async (name, owner = users.owner) => {
      const id = (await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id', [owner, name])).rows[0].id;
      await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)`, [id, owner]);
      return id;
    };

    // Two installations = two DPoP key pairs. That is the whole difference between two machines here.
    const hosts = ['laptop', 'desktop'].map((name) => {
      const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = pair.publicKey.export({ format: 'jwk' });
      return { name, pair, jwk, jkt: jwkThumbprint(jwk) };
    });
    const [laptop, desktop] = hosts;
    assert.notEqual(laptop.jkt, desktop.jkt);
    const signing = await getSigningKey(pool);
    const mint = async ({ user = users.owner, host = laptop, scope = 'projects:read projects:write', bound = true } = {}) => {
      const sid = crypto.randomUUID(), authTime = Math.floor(Date.now() / 1000);
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [user]);
      await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
        VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`, [sid, user, authTime, bound ? host.jkt : null]);
      return jwt.sign({ sub: user, sid, auth_epoch: 0, auth_time: authTime, client_id: 'xeno-agent-interface', scope, typ: 'at+jwt',
        ...(bound ? { cnf: { jkt: host.jkt } } : {}) }, signing.privatePem,
      { algorithm: signing.alg, keyid: signing.kid, audience: 'xeno-api', issuer: 'https://xenostudio.ai', expiresIn: '10m', header: { typ: 'at+jwt' } });
    };
    const proof = (token, host, method, path) => jwt.sign({ jti: crypto.randomUUID(), htm: method, htu: `https://xenostudio.ai${path}`,
      iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(token) }, host.pair.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk: host.jwk } });

    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/chat', authMiddleware, chatRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const call = async ({ token, host = laptop, method = 'POST', path, body, scheme = 'DPoP', withProof = true }) => {
      const headers = { 'content-type': 'application/json', authorization: `${scheme} ${token}` };
      if (withProof) headers.dpop = proof(token, host, method, path);
      const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const onLaptop = await mint({ host: laptop }), onDesktop = await mint({ host: desktop });
    const bind = (token, host, projectId, root, rootFamily = 'posix', extra = {}) =>
      call({ token, host, path: `/api/chat/projects/${projectId}/directories`, body: { rootFamily, root, ...extra } });
    const resolve = (token, host, root, rootFamily = 'posix') =>
      call({ token, host, path: '/api/chat/directories/resolve', body: { rootFamily, root } });
    const executionRoot = (token, host, projectId) =>
      call({ token, host, method: 'GET', path: `/api/chat/projects/${projectId}/execution-root` });

    await t.test('the same path on another machine is another resource', async () => {
      const a = await project('App'), b = await project('App fork');
      const onA = await bind(onLaptop, laptop, a, '/home/me/app');
      assert.equal(onA.status, 200, JSON.stringify(onA.body));
      const onB = await bind(onDesktop, desktop, b, '/home/me/app');
      assert.equal(onB.status, 200, 'the same path on another machine is another resource');
      assert.notEqual(onA.body.binding.host.installationId, onB.body.binding.host.installationId);
      assert.equal((await resolve(onLaptop, laptop, '/home/me/app')).body.binding.projectId, a, 'the laptop resolves its own project');
      assert.equal((await resolve(onDesktop, desktop, '/home/me/app')).body.binding.projectId, b, 'the desktop resolves its own project');
      const clash = await bind(onLaptop, laptop, b, '/home/me/app');
      assert.equal(clash.body.code, 'root_bound_to_another_project', 'one directory is one resource per host');
      assert.equal((await bind(onLaptop, laptop, a, '/home/me/app')).body.replayed, true, 'binding it again is idempotent');
    });

    await t.test('the host is the authenticated installation, never a claim', async () => {
      const p = await project('Claims');
      const forged = await bind(onLaptop, laptop, p, '/srv/claims', 'posix', { installationId: desktop.jkt });
      assert.equal(forged.status, 400, 'the body cannot name the host');
      const unbound = await mint({ host: laptop, bound: false });
      const bearer = await call({ token: unbound, scheme: 'Bearer', withProof: false, path: `/api/chat/projects/${p}/directories`,
        body: { rootFamily: 'posix', root: '/srv/claims' } });
      assert.equal(bearer.body?.code, 'sender_bound_installation_required', 'a token with no proof names no host and cannot bind');
      const readOnly = await mint({ host: laptop, scope: 'projects:read' });
      assert.equal((await bind(readOnly, laptop, p, '/srv/claims')).body.code, 'insufficient_scope');

      const made = (await bind(onLaptop, laptop, p, '/srv/claims')).body.binding;
      const fromDesktop = await call({ token: onDesktop, host: desktop, path: `/api/chat/directories/${made.id}/revoke`, body: {} });
      assert.equal(fromDesktop.status, 404, 'only the binding host may revoke it');
      const fromLaptop = await call({ token: onLaptop, host: laptop, path: `/api/chat/directories/${made.id}/revoke`, body: { expectedRevision: '1' } });
      assert.equal(fromLaptop.body.binding.state, 'revoked');
      assert.equal(fromLaptop.body.binding.revision, '2', 'revocation advances the grant revision');
    });

    await t.test('a non-canonical root is refused, not rewritten', async () => {
      const p = await project('Canonical');
      for (const [family, root] of [['posix', 'home/me'], ['posix', '/home/me/'], ['posix', '/home//me'], ['posix', '/home/./me'],
        ['posix', '/home/../etc'], ['posix', '/home/me\\x'], ['windows', 'C:/work'], ['windows', 'C:\\work\\'], ['windows', 'C:\\a\\..\\b'],
        ['windows', 'work\\app'], ['windows', '\\\\server']]) {
        const r = await bind(onLaptop, laptop, p, root, family);
        assert.equal(r.body.code, 'root_not_canonical', `${family} ${JSON.stringify(root)}: a non-canonical root is refused, not rewritten`);
      }
      assert.equal((await pool.query('SELECT count(*) FROM project_directory_bindings WHERE project_id=$1', [p])).rows[0].count, '0');
      // The database refuses them too, not only the service: a direct write cannot slip one in.
      await assert.rejects(pool.query(`INSERT INTO project_directory_bindings(project_id,host_installation_id,host_owner_user_id,host_client_id,root_family,canonical_root)
        VALUES($1,$2,$3,'x','posix','/home/../etc')`, [p, laptop.jkt, users.owner]), (e) => e.code === '23514',
      'a non-canonical root is refused, not rewritten');
      for (const [family, root] of [['posix', '/'], ['posix', '/home/.config'], ['windows', 'C:\\'], ['windows', '\\\\srv\\share\\dir']]) {
        assert.equal((await bind(onLaptop, laptop, p, root, family)).status, 200, `${family} ${root} is canonical`);
      }
    });

    await t.test('Windows roots compare case-insensitively, POSIX roots do not', async () => {
      const p = await project('Case'), q = await project('Case two');
      assert.equal((await bind(onLaptop, laptop, p, 'D:\\Work\\App', 'windows')).status, 200);
      assert.equal((await bind(onLaptop, laptop, q, 'd:\\work\\app', 'windows')).body.code, 'root_bound_to_another_project',
        'Windows roots compare case-insensitively');
      assert.equal((await resolve(onLaptop, laptop, 'D:\\WORK\\APP', 'windows')).body.binding.projectId, p);
      // The service checks this before writing, so the DATABASE rule is exercised by a direct write:
      // two concurrent binders both pass the service's read and race to insert, and only the unique
      // key decides. Measured: without this case, dropping the key's case-folding survived.
      await assert.rejects(pool.query(`INSERT INTO project_directory_bindings(project_id,host_installation_id,host_owner_user_id,
        host_client_id,root_family,canonical_root) VALUES($1,$2,$3,'x','windows','D:\\WORK\\app')`, [q, laptop.jkt, users.owner]),
      (e) => e.code === '23505', 'Windows roots compare case-insensitively');
      assert.equal((await bind(onLaptop, laptop, p, '/opt/Case')).status, 200);
      assert.equal((await bind(onLaptop, laptop, q, '/opt/case')).status, 200, 'POSIX /opt/Case and /opt/case are two directories');
    });

    await t.test('reconciliation is by id, never by name', async () => {
      const first = await project('Website'), second = await project('Website');
      await bind(onLaptop, laptop, first, '/code/site-a');
      await bind(onLaptop, laptop, second, '/code/site-b');
      assert.equal((await resolve(onLaptop, laptop, '/code/site-a')).body.binding.projectId, first, 'two projects named alike are told apart');
      assert.equal((await resolve(onLaptop, laptop, '/code/site-b')).body.binding.projectId, second);
      await pool.query(`UPDATE chat_projects SET name='Renamed' WHERE id=$1`, [first]);
      assert.equal((await resolve(onLaptop, laptop, '/code/site-a')).body.binding.projectId, first, 'renaming a project does not move its binding');
      assert.equal((await resolve(onLaptop, laptop, '/code/unknown')).body.binding, null, 'an unbound path resolves to nothing, not a guess');
    });

    await t.test('execution requires an authorized root on THIS installation; research projects have none', async () => {
      const research = await project('Literature review');
      const none = await executionRoot(onLaptop, laptop, research);
      assert.equal(none.status, 200, 'a research project with no directory is legitimate');
      assert.equal(none.body.executionRoot, null);
      assert.equal(none.body.reason, 'no_authorized_root_on_this_installation');

      const code = await project('Service');
      const made = (await bind(onLaptop, laptop, code, '/srv/service')).body.binding;
      assert.equal((await executionRoot(onLaptop, laptop, code)).body.executionRoot.canonicalRoot, '/srv/service');
      assert.equal((await executionRoot(onDesktop, desktop, code)).body.executionRoot, null,
        'no execution root on a host where it is not bound');
      await call({ token: onLaptop, host: laptop, path: `/api/chat/directories/${made.id}/revoke`, body: {} });
      assert.equal((await executionRoot(onLaptop, laptop, code)).body.executionRoot, null, 'revoking the binding removes the execution root');

      const archived = await project('Old');
      await pool.query('UPDATE chat_projects SET is_archived=true WHERE id=$1', [archived]);
      assert.equal((await bind(onLaptop, laptop, archived, '/srv/old')).body.code, 'project_archived');
    });

    await t.test('binding changes no ownership, and needs editor on the project', async () => {
      const p = await project('Owned');
      const before = (await pool.query('SELECT * FROM chat_projects WHERE id=$1', [p])).rows[0];
      const tuplesBefore = (await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count;
      await bind(onLaptop, laptop, p, '/srv/owned');
      assert.deepEqual((await pool.query('SELECT * FROM chat_projects WHERE id=$1', [p])).rows[0], before, 'the project row is untouched');
      assert.equal((await pool.query('SELECT count(*) FROM relationship_tuples')).rows[0].count, tuplesBefore, 'no grant was written');

      await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'viewer','user',$2)`, [p, users.reader]);
      const reader = await mint({ user: users.reader, host: desktop });
      assert.equal((await bind(reader, desktop, p, '/srv/owned-too')).body.code, 'project_not_found', 'a caller without editor cannot bind');
      assert.equal((await call({ token: reader, host: desktop, method: 'GET', path: `/api/chat/projects/${p}/directories` })).body.bindings.length, 1,
        'but a viewer sees which hosts have it');
      const outsider = await mint({ user: users.outsider, host: desktop });
      assert.equal((await call({ token: outsider, host: desktop, method: 'GET', path: `/api/chat/projects/${p}/directories` })).status, 404);
    });

    await t.test('binding history cannot be erased, and rollback refuses while bindings exist', async () => {
      await assert.rejects(pool.query('DELETE FROM project_directory_bindings'), /history is retained/);
      await assert.rejects(pool.query(down), /rollback refused/);
    });
  } finally {
    server?.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await pool.end();
  }
});

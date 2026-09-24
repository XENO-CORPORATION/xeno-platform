/**
 * XENO-WORKFORCE-01 VIEW-02: "Workspace lists show assigned resources only; project views narrow
 * participation. Unauthorized assignment names, counts, credentials and private resource metadata
 * must not leak through a globally visible identity."
 *
 * Built as VIEWS of the one catalog (`POST /api/workforce/resources/list`, `view: 'assigned' |
 * 'project'`), never a second list API -- the refusal note in workforce-catalog.test.mjs named that
 * as the only acceptable close. Real PostgreSQL, the REAL workforce migration chain (so the
 * assignment guard, the ASN-06 effective-policy view and the ASN-09 participation record are the
 * real ones), the real service and the real HTTP router behind real OIDC + DPoP.
 *
 * Asserted:
 *   1. ASSIGNED ONLY. A workspace's assigned view lists exactly the resources ASSIGNED INTO it by an
 *      accepted, current assignment -- never what it merely owns, never a proposal, a revoked or an
 *      expired assignment, never an assignment into another workspace.
 *   2. PROJECT VIEWS NARROW. A project view lists exactly the resources participating in THAT
 *      project, with the participation's narrowed capabilities -- which follow the assignment when
 *      it dies -- and never the workspace's other assigned resources.
 *   3. NOTHING LEAKS. A scoped row carries the resource's display metadata and THIS scope's own
 *      facts. It never carries the source owner, the creator, the definition, the resource's other
 *      assignments, their names or their count -- checked by planting sentinels in all of them.
 *      The route's response validator refuses a service reply that carries them.
 *   4. SAME AUTHORITY, SAME ORACLE-FREE DENIAL. The views are authorized exactly like the owned
 *      list (a non-viewer is denied), a project owned by another scope answers identically to a
 *      nonexistent one, and cursors are bound to the view and the project.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-catalog-scoped-views.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the assigned view admits revoked assignments       -> "a revoked assignment is not an assignment"
 *   - the assigned view ignores validity                 -> "an expired assignment is not an assignment"
 *   - the assigned view filters by owner, not target     -> "a workspace lists what was assigned INTO it"
 *   - a scoped row carries the source owner              -> "a scoped row never names the source owner"
 *   - the project view ignores the project id            -> "a project view narrows to that project"
 *   - the project view skips the scope check             -> "another scope's project answers like a missing one"
 *   - the scope hash ignores the view                    -> "a cursor is bound to its view"
 *   - the route validator admits a source owner          -> "the route refuses a reply that names the source owner"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import pg from 'pg';
import express from 'express';
import { listOwnedWorkforceResources } from '../src/server/services/workforceCatalog.js';
import { issuer } from '../src/server/config/hosts.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const { default: router, createWorkforceRouter } = await import('../src/server/routes/workforceRoutes.js');

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);
const SENTINEL = 'PRIVATE-SENTINEL';

test('workspace and project views of the one catalog show assigned and participating resources only (VIEW-02)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_views_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, application_name: schema });
  let created = false, server;

  const [viewer, sourceAdmin, stranger, creator] = Array.from({ length: 4 }, () => randomUUID());
  const [target, source, elsewhere] = [randomUUID(), randomUUID(), randomUUID()];
  const scope = (id) => ({ type: 'workspace', id });
  const ctx = (actorUserId = viewer) => ({ actorUserId, clientId: 'views-test' });
  const list = (owner, rest = {}, context = ctx()) =>
    listOwnedWorkforceResources(pool, context, { owner, expectedActorAccountId: context.actorUserId, ...rest });
  const reject = (promise, code, message) => assert.rejects(promise, (e) => e.code === code, message);
  const policy = (capabilities) => ({ schemaVersion: 1, mode: 'explicit', capabilities });

  const resource = async (name, owner = source) => (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,
    created_by_user_id,name,description) VALUES('agent',$1,$2,$3,'shown description') RETURNING id`, [owner, creator, name])).rows[0].id;
  const propose = async (resourceId, into, capabilities = ['files.read'], owner = source) => (await pool.query(
    `INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,resource_revision,
      created_by_user_id,policy) VALUES($1,'agent',$2,$3,1,$4,$5) RETURNING *`,
    [resourceId, into, owner, sourceAdmin, policy(capabilities)])).rows[0];
  const accept = async (row) => (await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,
    source_approved_by_user_id=$2,source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,accepted_at=clock_timestamp(),
    updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [row.id, sourceAdmin])).rows[0];
  const assign = async (resourceId, into, capabilities) => accept(await propose(resourceId, into, capabilities));
  const revoke = (id) => pool.query(`UPDATE workforce_workspace_assignments SET state='revoked',revision=revision+1,
    revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [id]);
  const ids = (page) => page.items.map((i) => i.id);

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,display_name TEXT,email TEXT,avatar_url TEXT,
      email_verified BOOLEAN DEFAULT true,role TEXT DEFAULT 'user',is_active BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY,alg TEXT,private_pem TEXT);
      CREATE TABLE oauth_dpop_replays(jkt TEXT,jti TEXT,htm TEXT,htu TEXT,expires_at TIMESTAMPTZ,UNIQUE(jkt,jti));`);
    for (const id of [viewer, sourceAdmin, stranger, creator]) await pool.query('INSERT INTO users(id,username) VALUES($1::uuid,$1::text)', [id]);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || ['20260711120000-workspaces.sql', '20260811130000-agent-identities.sql'].includes(f))).sort();
    await pool.query((await readFile(new URL('20260711120000-workspaces.sql', MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID,
      owner_user_id UUID REFERENCES users(id), workspace_id UUID REFERENCES workspaces(id), name TEXT NOT NULL DEFAULT 'p',
      is_archived BOOLEAN NOT NULL DEFAULT false, CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)))`);
    for (const f of chain.filter((f) => f !== '20260711120000-workspaces.sql'))
      await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$4,'Target','target'),($2,$4,'${SENTINEL} source','source'),
      ($3,$4,'${SENTINEL} elsewhere','elsewhere')`, [target, source, elsewhere, sourceAdmin]);
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
      VALUES('workspace',$1,'viewer','user',$2)`, [target, viewer]);

    // The fixture. Every assignment below is from `source` (which the viewer cannot see) into
    // `target` or elsewhere; the viewer is only ever a viewer of `target`.
    const owned = await resource('owned by target', target);
    const live = await resource('assigned and live');
    const proposed = await resource('only proposed');
    const revoked = await resource('assigned then revoked');
    const expiring = await resource('assigned, expired');
    const foreignOnly = await resource(`${SENTINEL} assigned elsewhere only`);
    const liveAssignment = await assign(live, target, ['files.read', 'git.push']);
    // The live resource is ALSO assigned into two other workspaces, so a leak of its other
    // assignments, their names or their count has something to leak.
    await assign(live, elsewhere, ['deploy.prod']);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'${SENTINEL} third','third')`, [randomUUID(), sourceAdmin]);
    await propose(proposed, target);
    await revoke((await assign(revoked, target)).id);
    const soon = await propose(expiring, target);
    await pool.query(`UPDATE workforce_workspace_assignments SET valid_until=clock_timestamp()+interval '300 milliseconds',
      revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`, [soon.id]);
    await accept({ id: soon.id });
    await assign(foreignOnly, elsewhere);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [live, { instructions: `${SENTINEL} definition`, secretReferences: [{ name: 'KEY', ref: randomUUID() }] }, 'a'.repeat(64)]);
    await new Promise((resolve) => setTimeout(resolve, 400));

    await t.test('a workspace lists exactly what was assigned INTO it, and only while it is live', async () => {
      const page = await list(scope(target), { view: 'assigned' });
      assert.equal(page.scope, 'assigned');
      // Each exclusion is asserted BEFORE the exact list, so a regression is reported by the
      // property it breaks rather than by a generic mismatch.
      assert.ok(!ids(page).includes(proposed), 'a proposal is not an assignment');
      assert.ok(!ids(page).includes(revoked), 'a revoked assignment is not an assignment');
      assert.ok(!ids(page).includes(expiring), 'an expired assignment is not an assignment');
      assert.ok(!ids(page).includes(owned), 'owning is not being assigned');
      assert.ok(!ids(page).includes(foreignOnly), 'another workspace\'s assignment is not this one\'s');
      assert.deepEqual(ids(page), [live], 'a workspace lists what was assigned INTO it');
      const [row] = page.items;
      assert.equal(row.assignment.id, liveAssignment.id);
      assert.deepEqual(row.assignment.effectiveCapabilities, ['files.read', 'git.push'], 'the row states what THIS assignment grants');
      assert.deepEqual(ids(await list(scope(target))), [owned], 'the owned view is unchanged by all of this');
    });

    await t.test('a scoped row carries its own scope\'s facts and nothing that belongs to another', async () => {
      const [row] = (await list(scope(target), { view: 'assigned' })).items;
      assert.ok(!Object.hasOwn(row, 'owner'), 'a scoped row never names the source owner');
      assert.ok(!Object.hasOwn(row, 'createdByUserId'), 'a scoped row never names the creator');
      const wire = JSON.stringify(row);
      for (const secret of [SENTINEL, source, elsewhere, creator, sourceAdmin, 'secretReferences', 'deploy.prod'])
        assert.ok(!wire.includes(secret), `the assigned row leaks ${secret}`);
      assert.deepEqual(Object.keys(row).sort(), ['assignment', 'createdAt', 'description', 'id', 'kind', 'name', 'revision', 'status', 'updatedAt']);
      assert.deepEqual(Object.keys(row.assignment).sort(), ['acceptedAt', 'divisionId', 'effectiveCapabilities', 'effectiveMode', 'id', 'revision'],
        'no count, list or name of the resource\'s other assignments');
    });

    const project = (await pool.query(`INSERT INTO chat_projects(workspace_id) VALUES($1) RETURNING id`, [target])).rows[0].id;
    const otherProject = (await pool.query(`INSERT INTO chat_projects(workspace_id) VALUES($1) RETURNING id`, [target])).rows[0].id;
    const foreignProject = (await pool.query(`INSERT INTO chat_projects(workspace_id) VALUES($1) RETURNING id`, [elsewhere])).rows[0].id;
    const second = await resource('second assigned');
    const secondAssignment = await assign(second, target, ['files.read']);
    const participate = async (resourceId, projectId, assignmentId, capabilities) => (await pool.query(
      `INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,
         responsibility,policy,created_by_user_id) VALUES($1,'agent',$2,'workspace',$3,$4,'reviewer',$5,$6) RETURNING *`,
      [resourceId, projectId, target, assignmentId, policy(capabilities), sourceAdmin])).rows[0];
    const participation = await participate(live, project, liveAssignment.id, ['files.read']);
    await participate(second, otherProject, secondAssignment.id, ['files.read']);

    await t.test('a project view narrows to the resources participating in that project', async () => {
      const page = await list(scope(target), { view: 'project', projectId: project });
      assert.equal(page.projectId, project);
      assert.deepEqual(ids(page), [live], 'a project view narrows to that project');
      assert.equal(page.items[0].participation.id, participation.id);
      assert.deepEqual(page.items[0].participation.effectiveCapabilities, ['files.read'], 'the participation\'s narrowed grant, not the assignment\'s');
      assert.ok(!Object.hasOwn(page.items[0], 'owner') && !JSON.stringify(page).includes(SENTINEL));
      assert.deepEqual(ids(await list(scope(target), { view: 'project', projectId: otherProject })), [second]);
    });

    await t.test('another scope\'s project answers exactly like a project that does not exist', async () => {
      const refusal = (promise) => promise.then(() => 'allowed', (e) => JSON.stringify({ code: e.code, status: e.status, details: e.details }));
      const foreign = await refusal(list(scope(target), { view: 'project', projectId: foreignProject }));
      const missing = await refusal(list(scope(target), { view: 'project', projectId: randomUUID() }));
      assert.notEqual(foreign, 'allowed', "another scope's project answers like a missing one");
      assert.equal(foreign, missing, "another scope's project answers like a missing one");
    });

    await t.test('the same authority gates every view; cursors are bound to their view and project', async () => {
      await reject(list(scope(target), { view: 'assigned' }, ctx(stranger)), 'denied', 'a non-viewer is refused the assigned view');
      await reject(list(scope(source), { view: 'assigned' }), 'denied', 'a viewer of one workspace cannot list another\'s assignments');
      await reject(list({ type: 'user', id: viewer }, { view: 'assigned' }), 'bad_input', 'only a workspace has an assigned view');
      await reject(list(scope(target), { view: 'project' }), 'bad_input', 'a project view names its project');
      await reject(list(scope(target), { projectId: project }), 'bad_input', 'only a project view takes a project');
      await reject(list(scope(target), { view: 'global' }), 'bad_input', 'there is no global view here');

      const extra = await resource('third assigned');
      await assign(extra, target);
      const first = await list(scope(target), { view: 'assigned', limit: 1 });
      assert.ok(first.nextCursor, 'two live assignments paginate');
      await reject(list(scope(target), { cursor: first.nextCursor }), 'bad_input', 'a cursor is bound to its view');
      const rest = await list(scope(target), { view: 'assigned', limit: 5, cursor: first.nextCursor });
      assert.equal(new Set([...ids(first), ...ids(rest)]).size, 3, 'the keyset walk is exact across pages');
      const p = await list(scope(target), { view: 'project', projectId: project, limit: 1 });
      assert.equal(p.nextCursor, null);
    });

    await t.test('when the assignment dies, the project view grants nothing, and the assigned view drops it', async () => {
      await revoke(liveAssignment.id);
      assert.ok(!ids(await list(scope(target), { view: 'assigned' })).includes(live));
      const [row] = (await list(scope(target), { view: 'project', projectId: project })).items;
      assert.deepEqual(row.participation.effectiveCapabilities, [], 'a participation follows its assignment');
    });

    await t.test('over real HTTP: the router serves the views and refuses a reply that leaks', async () => {
      const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
      await pool.query("INSERT INTO oidc_signing_keys(kid,alg,private_pem) VALUES('views-key','ES256',$1)", [key.privateKey.export({ type: 'pkcs8', format: 'pem' })]);
      const leaky = createWorkforceRouter({ listOwnedWorkforceResources: async (...args) => {
        const page = await listOwnedWorkforceResources(...args);
        return { ...page, items: page.items.map((item) => ({ ...item, owner: scope(source) })) };
      } });
      const app = express(); app.use((req, _res, next) => { req.db = pool; next(); });
      app.use('/api/workforce', router); app.use('/api/leaky', leaky);
      server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
      const raw = jwt.sign({ sub: viewer, typ: 'at+jwt', client_id: 'xeno-agent-interface', scope: 'workforce:read', cnf: { jkt } },
        key.privateKey, { algorithm: 'ES256', keyid: 'views-key', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
      const post = async (base, body) => {
        const path = `${base}/resources/list`;
        const dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: `${issuer()}${path}`, ath: accessTokenHash(raw), iat: Math.floor(Date.now() / 1000) },
          proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `DPoP ${raw}`, dpop }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      const body = { owner: scope(target), expectedActorAccountId: viewer, view: 'project', projectId: otherProject };
      const served = await post('/api/workforce', body);
      assert.equal(served.status, 200, JSON.stringify(served.body));
      assert.deepEqual(served.body.items.map((i) => i.id), [second]);
      assert.equal(served.body.scope, 'project');
      const assigned = await post('/api/workforce', { owner: scope(target), expectedActorAccountId: viewer, view: 'assigned' });
      assert.equal(assigned.status, 200); assert.ok(!JSON.stringify(assigned.body).includes(SENTINEL));
      const leak = await post('/api/leaky', body);
      assert.equal(leak.status, 500, 'the route refuses a reply that names the source owner');
      assert.ok(!JSON.stringify(leak.body).includes(source));
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

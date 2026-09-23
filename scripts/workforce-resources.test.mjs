import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import pg from 'pg';
import express from 'express';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from '../src/server/services/workspaceOperationReceipts.js';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

// Set fixture-only signing material before loading real authentication modules.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const { createWorkforceResource, readWorkforceResourceOperation } = await import('../src/server/services/workforceResources.js');
const { default: workforceRoutes } = await import('../src/server/routes/workforceRoutes.js');

test('transactional workforce creation and receipts on isolated PostgreSQL', { skip: workforceProofUnavailable() }, async t => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const target = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/workforceproof');
  assert.equal(target.search, '');
  const schema = `workforce_create_${randomBytes(12).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  let createdSchema = false;
  const owner = randomUUID(), manager = randomUUID(), outsider = randomUUID(), agent = randomUUID(), machine = randomUUID();
  const workspace = randomUUID(), foreign = randomUUID();
  const personal = { type: 'user', id: owner }, company = { type: 'workspace', id: workspace };
  const context = (id = owner, clientId = 'workforce-test') => ({ actorUserId: id, clientId });
  const definition = () => ({ schemaVersion: 1, instructions: 'PRIVATE pinned instruction sentinel',
    skills: [{ id: 'skill.review', version: '1.2.3', hash: 'b'.repeat(64) }], requestedCapabilities: ['files.read'],
    secretReferences: [{ name: 'PROVIDER_KEY', ref: randomUUID() }], provenance: { source: 'authored' }, license: { identifier: 'Apache-2.0' } });
  const request = (scope = personal, kind = 'agent') => ({ operationId: randomUUID(), owner: scope, kind, name: 'Private resource name sentinel',
    ...(kind === 'agent' ? { definition: definition() } : {}) });
  const reject = (apply, code, reason) => assert.rejects(async () => apply(), error => error.code === code && (!reason || error.details?.reason === reason));
  const count = async table => Number((await pool.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);
  const counts = async () => Promise.all(['users', 'agent_identities', 'workforce_resources', 'workforce_agent_versions', 'workforce_resource_operations', 'workspace_audit'].map(count));
  const grant = (objectType, objectId, relation, subjectType, subjectId) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [objectType, objectId, relation, subjectType, subjectId]);
  let companyRequest, companyResult;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,display_name TEXT,email TEXT,avatar_url TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT true,role TEXT NOT NULL DEFAULT 'user',is_active BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE user_sessions(id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,last_active_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())`);
    for (const id of [owner, manager, outsider, agent, machine]) await pool.query('INSERT INTO users(id,username,display_name) VALUES($1,$2,$2)', [id, id]);
    await pool.query("UPDATE users SET role='service' WHERE id=$1", [machine]);
    for (const filename of ['20260711120000-workspaces.sql', '20260811130000-agent-identities.sql', '20260905120000-workforce-resources.sql', '20260905121000-workforce-resource-operations.sql']) {
      await pool.query((await readFile(new URL(`../src/server/database/migrations/${filename}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agent, owner]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Company','company'),($3,$2,'Foreign','foreign')`, [workspace, owner, foreign]);
    await grant('workspace', workspace, 'editor', 'user', manager);
    await grant('workspace', foreign, 'owner', 'user', outsider);

    await t.test('empty operation migration can roll back and reapply without changing canonical rows', async () => {
      const sql = await readFile(new URL('../src/server/database/migrations/20260905121000-workforce-resource-operations.sql', import.meta.url), 'utf8');
      const [up, down] = sql.split('-- DOWN');
      await pool.query(down);
      await pool.query(up);
      assert.equal(await count('users'), 5);
      assert.equal(await count('workspaces'), 2);
      assert.equal(await count('agent_identities'), 1);
      assert.equal(await count('workforce_resources'), 0);
    });

    // OWN-02: agent identity, its versioned definition and a runtime PRINCIPAL are three
      // different things. Creating the first two creates no account -- a configuration file is
      // not credential-bearing -- and `kind: 'principal'` is refused outright below.
      await t.test('personal creation persists resource/version/receipt together without principal creation (OWN-02)', async () => {
      const before = await counts();
      const input = request();
      const result = await createWorkforceResource(pool, context(), input);
      assert.equal(result.state, 'committed');
      assert.equal(result.replayed, false);
      assert.deepEqual(result.resource.owner, personal);
      assert.equal(result.resource.createdByUserId, owner);
      assert.equal(result.resource.revision, '1');
      assert.equal(result.operation.resourceId, result.resource.id);
      assert.equal(result.version.resourceId, result.resource.id);
      assert.equal(result.version.version, 1);
      assert.equal(result.version.content.instructions, input.definition.instructions);
      assert.equal(result.version.contentHash, operationHash({ schemaVersion: 1, content: result.version.content,
        provenance: result.version.provenance, license: result.version.license }));
      const after = await counts();
      assert.deepEqual(after, before.map((n, index) => n + ([2, 3, 4].includes(index) ? 1 : 0)));
      assert.deepEqual((await readWorkforceResourceOperation(pool, context(), { operationId: input.operationId, owner: personal })).operation, result.operation);
    });

    await t.test('workspace manager creates company-owned resource with independent creator and metadata-only audit', async () => {
      companyRequest = request(company);
      companyResult = await createWorkforceResource(pool, context(manager), companyRequest);
      assert.deepEqual(companyResult.resource.owner, company);
      assert.equal(companyResult.resource.createdByUserId, manager);
      assert.equal(companyResult.version.createdByUserId, manager);
      const audit = (await pool.query('SELECT * FROM workspace_audit WHERE workspace_id=$1', [workspace])).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].metadata.resourceId, companyResult.resource.id);
      const stored = JSON.stringify({ audit, receipts: (await pool.query('SELECT * FROM workforce_resource_operations')).rows });
      assert.ok(!stored.includes(companyRequest.name));
      assert.ok(!stored.includes(companyRequest.definition.instructions));
      assert.ok(!stored.includes('PROVIDER_KEY'));
    });

    await t.test('expected actor binds prepared intent even when both accounts manage the target', async () => {
      await grant('workspace', workspace, 'editor', 'user', outsider);
      const input = { ...request(company, 'team'), expectedActorAccountId: manager };
      const before = await counts();
      await reject(() => createWorkforceResource(pool, context(outsider), input), 'conflict', 'actor_context_conflict');
      assert.deepEqual(await counts(), before);
      const result = await createWorkforceResource(pool, context(manager), input);
      assert.equal(result.resource.createdByUserId, manager);
      const replay = await createWorkforceResource(pool, context(manager), input);
      assert.equal(replay.resource.id, result.resource.id);
      const other = await createWorkforceResource(pool, context(outsider), { ...input, expectedActorAccountId: outsider });
      assert.notEqual(other.resource.id, result.resource.id);
      await reject(() => readWorkforceResourceOperation(pool, context(outsider), {
        operationId: input.operationId, owner: company, expectedActorAccountId: manager,
      }), 'conflict', 'actor_context_conflict');
      const boundRead = await readWorkforceResourceOperation(pool, context(manager), {
        operationId: input.operationId, owner: company, expectedActorAccountId: manager,
      });
      assert.equal(boundRead.resource.id, result.resource.id);
      const omitted = { ...input }; delete omitted.expectedActorAccountId;
      await reject(() => createWorkforceResource(pool, context(manager), omitted), 'conflict', 'operation_payload_conflict');
      await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2", [workspace, outsider]);
    });

    await t.test('teams create identity and receipt without versions or assignments', async () => {
      const before = await count('workforce_agent_versions');
      const result = await createWorkforceResource(pool, context(), request(personal, 'team'));
      assert.equal(result.resource.kind, 'team');
      assert.equal(result.version, null);
      assert.equal(result.operation.agentVersion, null);
      assert.equal(await count('workforce_agent_versions'), before);
      assert.ok(!Object.hasOwn(result, 'assignment'));
    });

    await t.test('foreign personal/workspace owners and misleading agent/service subjects cannot create', async () => {
      const before = await counts();
      await reject(() => createWorkforceResource(pool, context(outsider), request()), 'denied');
      await reject(() => createWorkforceResource(pool, context(), request(company)), 'denied');
      await reject(() => createWorkforceResource(pool, context(manager), request({ type: 'workspace', id: foreign })), 'denied');
      await grant('workspace', workspace, 'owner', 'user', agent);
      await grant('workspace', workspace, 'owner', 'agent', agent);
      await reject(() => createWorkforceResource(pool, context(agent), request(company)), 'denied');
      await grant('workspace', workspace, 'editor', 'user', machine);
      await reject(() => createWorkforceResource(pool, context(machine), request(company)), 'denied');
      assert.deepEqual(await counts(), before);
    });

    await t.test('direct personal agent delegation creates for human owner without impersonating creator', async () => {
      await reject(() => createWorkforceResource(pool, context(agent), request()), 'denied');
      await grant('user', owner, 'workforce_resource_creator', 'agent', agent);
      const result = await createWorkforceResource(pool, context(agent), request());
      assert.deepEqual(result.resource.owner, personal);
      assert.equal(result.resource.createdByUserId, agent);
      assert.equal(result.version.createdByUserId, agent);
    });

    // OWN-03: configuration carries secret REFERENCES, never secret values. The fixture uses
      // `secretReferences: [{ name, ref }]`; an inline `env: { TOKEN: 'secret-value' }` is
      // refused here, at the boundary, rather than being stored and hoped about.
      await t.test('strict bounded input rejects arbitrary config, plaintext secret fields and invalid pins (OWN-03)', async () => {
      const before = await counts();
      const invalid = [
        { ...request(), env: { TOKEN: 'secret-value' } },
        { ...request(), owner: { ...personal, principalKind: 'human' } },
        { ...request(), assignment: { workspaceId: workspace } },
        { ...request(), name: ' '.repeat(3) },
        { ...request(), name: 'x'.repeat(201) },
        { ...request(), description: null },
        { ...request(), kind: 'principal' },
        { ...request(), definition: { ...definition(), env: { TOKEN: 'secret-value' } } },
        { ...request(), definition: { ...definition(), secretReferences: [{ name: 'TOKEN', ref: 'secret-value' }] } },
        { ...request(), definition: { ...definition(), secretReferences: null } },
        { ...request(), definition: { ...definition(), instructions: 'x'.repeat(32769) } },
        { ...request(), definition: { ...definition(), skills: [{ id: 'skill', version: '1' }] } },
        { ...request(), definition: { ...definition(), requestedCapabilities: ['files.read', 'files.read'] } },
        { ...request(), definition: { ...definition(), schemaVersion: 2 } },
        { ...request(), kind: 'team' },
        { ...request(), definition: null },
      ];
      for (const input of invalid) await reject(() => createWorkforceResource(pool, context(), input), 'bad_input');
      const accessor = request();
      Object.defineProperty(accessor, 'name', { enumerable: true, get() { throw new Error('getter must not execute'); } });
      await reject(() => createWorkforceResource(pool, context(), accessor), 'bad_input');
      await reject(() => createWorkforceResource(pool, { ...context(), role: 'admin' }, request()), 'bad_input');
      assert.deepEqual(await counts(), before);
    });

    await t.test('concurrent duplicate requests produce one resource, version and receipt', async () => {
      const before = await counts();
      const input = request();
      const results = await Promise.all(Array.from({ length: 6 }, () => createWorkforceResource(pool, context(), input)));
      assert.equal(new Set(results.map(result => result.resource.id)).size, 1);
      assert.equal(results.filter(result => !result.replayed).length, 1);
      assert.deepEqual(await counts(), before.map((n, index) => n + ([2, 3, 4].includes(index) ? 1 : 0)));
      await reject(() => createWorkforceResource(pool, context(), { ...input, name: 'Changed' }), 'conflict', 'operation_payload_conflict');
      const reordered = { definition: input.definition, name: input.name, kind: input.kind, owner: input.owner, operationId: input.operationId };
      assert.equal((await createWorkforceResource(pool, context(), reordered)).resource.id, results[0].resource.id);
      await reject(() => createWorkforceResource(pool, context(), { ...input, owner: company }), 'conflict', 'operation_scope_conflict');
      assert.equal((await readWorkforceResourceOperation(pool, context(owner, 'different-client'), { operationId: input.operationId, owner: personal })).state, 'not-observed');
    });

    await t.test('receipt insertion failure rolls back resource/version/audit and same operation can retry', async () => {
      const before = await counts();
      const input = request(company);
      await pool.query(`CREATE FUNCTION fail_workforce_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.client_id='rollback-test' THEN RAISE EXCEPTION 'injected receipt failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER injected_receipt_failure BEFORE INSERT ON workforce_resource_operations FOR EACH ROW EXECUTE FUNCTION fail_workforce_receipt()`);
      try { await reject(() => createWorkforceResource(pool, context(manager, 'rollback-test'), input), '23514'); }
      finally { await pool.query('DROP TRIGGER injected_receipt_failure ON workforce_resource_operations; DROP FUNCTION fail_workforce_receipt()'); }
      assert.deepEqual(await counts(), before);
      assert.equal((await readWorkforceResourceOperation(pool, context(manager, 'rollback-test'), { owner: company, operationId: input.operationId })).state, 'not-observed');
      assert.equal((await createWorkforceResource(pool, context(manager, 'rollback-test'), input)).replayed, false);
    });

    await t.test('lost COMMIT acknowledgement returns uncertainty and reconciles one committed result', async () => {
      const input = request();
      const lossyPool = { async connect() {
        const db = await pool.connect();
        return { release: () => db.release(), async query(sql, values) {
          const result = await db.query(sql, values);
          if (sql === 'COMMIT') throw Object.assign(new Error('simulated lost commit response'), { code: 'ECONNRESET' });
          return result;
        } };
      } };
      await reject(() => createWorkforceResource(lossyPool, context(), input), 'unavailable', 'operation_state_uncertain');
      const read = await readWorkforceResourceOperation(pool, context(), { operationId: input.operationId, owner: personal });
      assert.equal(read.state, 'committed');
      assert.equal((await createWorkforceResource(pool, context(), input)).resource.id, read.resource.id);
    });

    await t.test('revoked manager receives only their committed receipt; new creation and payload read fail closed', async () => {
      await authorityTransaction(pool, async db => {
        await lockWorkspaceAuthority(db, workspace);
        await db.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2", [workspace, manager]);
      });
      const before = await counts();
      for (const replay of [
        await createWorkforceResource(pool, context(manager), companyRequest),
        await readWorkforceResourceOperation(pool, context(manager), { operationId: companyRequest.operationId, owner: company }),
      ]) {
        assert.equal(replay.state, 'committed');
        assert.deepEqual(replay.operation, companyResult.operation);
        assert.equal(replay.resource, null);
        assert.equal(replay.version, null);
        assert.equal(replay.resourceAccess.reason, 'no_access');
        assert.ok(!JSON.stringify(replay).includes(companyRequest.name));
        assert.ok(!JSON.stringify(replay).includes(companyRequest.definition.instructions));
      }
      await reject(() => createWorkforceResource(pool, context(manager), request(company)), 'denied');
      assert.deepEqual(await counts(), before);
      await grant('workspace', workspace, 'editor', 'user', manager);
      assert.equal((await createWorkforceResource(pool, context(manager), companyRequest)).resource.id, companyResult.resource.id);
    });

    await t.test('suspension and resource owner drift do not disclose replay payload', async () => {
      await pool.query('UPDATE users SET is_active=false WHERE id=$1', [manager]);
      await reject(() => createWorkforceResource(pool, context(manager), companyRequest), 'denied', 'actor_unavailable');
      await reject(() => readWorkforceResourceOperation(pool, context(manager), { operationId: companyRequest.operationId, owner: company }), 'denied', 'actor_unavailable');
      await pool.query('UPDATE users SET is_active=true WHERE id=$1', [manager]);
      await pool.query('UPDATE workforce_resources SET owner_workspace_id=$1 WHERE id=$2', [foreign, companyResult.resource.id]);
      const replay = await createWorkforceResource(pool, context(manager), companyRequest);
      assert.equal(replay.state, 'committed');
      assert.equal(replay.resource, null);
      assert.equal(replay.version, null);
      await pool.query('UPDATE workforce_resources SET owner_workspace_id=$1 WHERE id=$2', [workspace, companyResult.resource.id]);
    });

    await t.test('real HTTP JWT session authenticates default router and PostgreSQL creation/read/revocation', async () => {
      const httpActor = randomUUID(), sid = randomUUID();
      await pool.query('INSERT INTO users(id) VALUES($1)', [httpActor]);
      await grant('workspace', workspace, 'editor', 'user', httpActor);
      await pool.query("INSERT INTO user_sessions(id,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '5 minutes')", [sid, httpActor]);
      const token = jwt.sign({ userId: httpActor, sid }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      const app = express();
      app.use((req, _res, next) => { req.db = pool; next(); });
      // Default router, actual authMiddleware, actual service and actual database.
      app.use('/api/workforce', workforceRoutes);
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${server.address().port}/api/workforce`;
      const post = async (path, body) => {
        const response = await fetch(`${origin}${path}`, { method: 'POST', headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-client-id': 'forged-client',
        }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      try {
        const input = request(company);
        const created = await post('/resources', input);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.equal(created.body.success, true);
        assert.equal(created.body.resource.createdByUserId, httpActor);
        const lookup = { owner: company, operationId: input.operationId };
        const read = await post('/resource-operations/read', lookup);
        assert.equal(read.status, 200, JSON.stringify(read.body));
        assert.equal(read.body.resource.id, created.body.resource.id);
        const repeated = await post('/resources', input);
        assert.equal(repeated.status, 200);
        assert.equal(repeated.body.replayed, true);
        assert.equal(repeated.body.resource.id, created.body.resource.id);
        const receipt = (await pool.query('SELECT * FROM workforce_resource_operations WHERE actor_user_id=$1 AND operation_id=$2', [httpActor, input.operationId])).rows[0];
        assert.equal(receipt.client_id, 'legacy-workforce-session');
        assert.equal(receipt.resource_id, created.body.resource.id);
        await authorityTransaction(pool, async db => {
          await lockWorkspaceAuthority(db, workspace);
          await db.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2", [workspace, httpActor]);
        });
        for (const result of [await post('/resource-operations/read', lookup), await post('/resources', input)]) {
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(result.body.state, 'committed');
          assert.equal(result.body.resource, null);
          assert.equal(result.body.version, null);
          assert.equal(result.body.resourceAccess.reason, 'no_access');
          assert.equal(result.body.operation.resourceId, created.body.resource.id);
          assert.ok(!JSON.stringify(result.body).includes(input.definition.instructions));
        }
        assert.equal((await post('/resources', request(company))).status, 403);
        await pool.query('DELETE FROM user_sessions WHERE id=$1', [sid]);
        assert.equal((await post('/resource-operations/read', lookup)).status, 401);
      } finally { await new Promise(resolve => server.close(resolve)); }
    });

    await t.test('creator account erasure retains company identity and tombstone; reincarnation cannot replay', async () => {
      await pool.query('DELETE FROM users WHERE id=$1', [manager]);
      const resource = (await pool.query('SELECT * FROM workforce_resources WHERE id=$1', [companyResult.resource.id])).rows[0];
      assert.equal(resource.owner_workspace_id, workspace);
      assert.equal(resource.created_by_user_id, null);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_resource_operations WHERE operation_id=$1', [companyRequest.operationId])).rows[0].count, '1');
      await pool.query("INSERT INTO users(id,created_at) VALUES($1,clock_timestamp()+interval '1 second')", [manager]);
      await reject(() => createWorkforceResource(pool, context(manager), companyRequest), 'conflict', 'operation_incarnation_conflict');
      await reject(() => readWorkforceResourceOperation(pool, context(manager), { operationId: companyRequest.operationId, owner: company }), 'conflict', 'operation_incarnation_conflict');
    });

    await t.test('workspace incarnation and immutable receipt constraints protect retained outcomes', async () => {
      const input = request(company, 'team');
      await createWorkforceResource(pool, context(manager), input);
      await pool.query("UPDATE workspaces SET created_at=created_at+interval '1 second' WHERE id=$1", [workspace]);
      await reject(() => createWorkforceResource(pool, context(manager), input), 'conflict', 'operation_incarnation_conflict');
      await assert.rejects(pool.query('UPDATE workforce_resource_operations SET request_hash=$1', ['a'.repeat(64)]), error => error.code === '23514');
      await assert.rejects(pool.query('DELETE FROM workforce_resource_operations'), error => error.code === '23514');
      await assert.rejects(pool.query('TRUNCATE workforce_resource_operations'), error => error.code === '23514');
      const down = (await readFile(new URL('../src/server/database/migrations/20260905121000-workforce-resource-operations.sql', import.meta.url), 'utf8')).split('-- DOWN')[1];
      await assert.rejects(pool.query(down), error => error.code === '23514');
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

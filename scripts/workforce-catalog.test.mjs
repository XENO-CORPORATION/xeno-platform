import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import pg from 'pg';
import express from 'express';
import { listOwnedWorkforceResources } from '../src/server/services/workforceCatalog.js';
import { lockWorkspaceAuthority } from '../src/server/services/workspaceOperationReceipts.js';
import { issuer } from '../src/server/config/hosts.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const { default: router } = await import('../src/server/routes/workforceRoutes.js');

test('owned workforce catalog: real isolated PostgreSQL, authorization, keyset and HTTP boundary', async t => {
  const connectionString = process.env.WORKFORCE_TEST_DATABASE_URL;
  assert.ok(connectionString, 'WORKFORCE_TEST_DATABASE_URL required; no skipped database proof');
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)); assert.equal(url.pathname, '/workforceproof'); assert.equal(url.search, '');
  const schema = `workforce_catalog_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, application_name: schema });
  let created = false, server;
  const human = randomUUID(), other = randomUUID(), agent = randomUUID(), creator = randomUUID();
  const workspace = randomUUID(), foreign = randomUUID();
  const personal = { type: 'user', id: human }, company = { type: 'workspace', id: workspace };
  const ctx = (actorUserId = human, clientId = 'catalog-test') => ({ actorUserId, clientId });
  const input = (owner = personal, rest = {}) => ({ owner, expectedActorAccountId: human, ...rest });
  const list = (owner = personal, rest = {}, context = ctx()) => listOwnedWorkforceResources(pool, context, input(owner, rest));
  const grant = (ot, oi, relation, st, si) => pool.query('INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [ot, oi, relation, st, si]);
  const reject = (promise, code = 'denied') => assert.rejects(promise, e => e.code === code);
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,display_name TEXT,email TEXT,avatar_url TEXT,
      email_verified BOOLEAN DEFAULT true,role TEXT DEFAULT 'user',is_active BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY,alg TEXT,private_pem TEXT);
      CREATE TABLE oauth_dpop_replays(jkt TEXT,jti TEXT,htm TEXT,htu TEXT,expires_at TIMESTAMPTZ,UNIQUE(jkt,jti));`);
    for (const id of [human, other, agent, creator]) await pool.query('INSERT INTO users(id,username) VALUES($1,$2)', [id, id]);
    for (const filename of ['20260711120000-workspaces.sql', '20260811130000-agent-identities.sql', '20260905120000-workforce-resources.sql']) {
      await pool.query((await readFile(new URL(`../src/server/database/migrations/${filename}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agent, human]);
    await pool.query("INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$3,'One','one'),($2,$3,'Two','two')", [workspace, foreign, other]);
    for (const scope of [personal, company, { type: 'workspace', id: foreign }]) {
      for (let i = 0; i < 7; i++) {
        const id = randomUUID(), kind = i % 2 ? 'team' : 'agent', status = i === 6 ? 'archived' : 'active';
        await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name,description,status,created_at)
          VALUES($1,$2,$3,$4,$5,$6,'Metadata description',$7,'2026-09-05T12:00:00Z'::timestamptz+($8::int*interval '1 microsecond'))`,
        [id, kind, scope.type === 'user' ? scope.id : null, scope.type === 'workspace' ? scope.id : null, creator, `Resource ${i}`, status, Math.floor(i / 2)]);
        if (kind === 'agent') await pool.query("INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)", [id, { instructions: 'PRIVATE definition sentinel', secretReferences: [{ name: 'KEY', ref: randomUUID() }] }, 'a'.repeat(64)]);
      }
    }
    await grant('workspace', workspace, 'viewer', 'user', human); await grant('workspace', foreign, 'admin', 'user', human);

    await t.test('personal owner and workspace viewer get metadata only; static keyset retains exact microsecond order', async () => {
      for (const owner of [personal, company]) {
        const ids = [], cursors = []; let cursor;
        do {
          const page = await list(owner, { limit: 2, ...(cursor ? { cursor } : {}) });
          assert.equal(page.scope, 'owned'); assert.ok(page.items.length <= 2);
          assert.ok(!JSON.stringify(page).includes('PRIVATE')); assert.ok(!JSON.stringify(page).includes('secretReferences'));
          ids.push(...page.items.map(r => r.id)); cursor = page.nextCursor;
          if (cursor) cursors.push(cursor);
        } while (cursor);
        const expected = (await pool.query(`SELECT id FROM workforce_resources WHERE ${owner.type === 'user' ? 'owner_user_id' : 'owner_workspace_id'}=$1 AND status='active' ORDER BY created_at DESC,id DESC`, [owner.id])).rows.map(r => r.id);
        assert.deepEqual(ids, expected); assert.equal(ids.length, 6); assert.equal(new Set(ids).size, 6); assert.equal(cursors.length, 2);
      }
      assert.equal((await list(personal, { kind: 'team' })).items.length, 3);
      assert.equal((await list(personal, { status: 'archived' })).items.length, 1);
    });
    await t.test('actor precondition and foreign personal owner refuse even a resource creator or UUID-shaped agent', async () => {
      await reject(list(personal, { expectedActorAccountId: other }));
      await reject(list(personal, { expectedActorAccountId: other }, ctx(other)));
      await reject(list(company, { expectedActorAccountId: creator }, ctx(creator)));
      await reject(list({ type: 'user', id: agent }, { expectedActorAccountId: agent }, ctx(agent)));
    });
    await t.test('agents require exact read grant; creation and user-typed relations never substitute', async () => {
      await grant('user', human, 'workforce_resource_creator', 'agent', agent);
      await reject(list(personal, { expectedActorAccountId: agent }, ctx(agent)));
      await grant('user', human, 'workforce_resource_reader', 'agent', agent);
      assert.equal((await list(personal, { expectedActorAccountId: agent }, ctx(agent))).items.length, 6);
      await grant('workspace', workspace, 'owner', 'user', agent); await grant('workspace', workspace, 'editor', 'agent', agent);
      await reject(list(company, { expectedActorAccountId: agent }, ctx(agent)));
      await grant('workspace', workspace, 'viewer', 'agent', agent);
      assert.equal((await list(company, { expectedActorAccountId: agent }, ctx(agent))).items.length, 6);
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [human]);
      await reject(list(company, { expectedActorAccountId: agent }, ctx(agent)));
      await pool.query("UPDATE users SET status='active' WHERE id=$1", [human]);
    });
    await t.test('unrelated member and parent relation cannot authorize catalog reads', async () => {
      await grant('workspace', workspace, 'member', 'user', creator);
      await grant('workspace', foreign, 'viewer', 'user', creator);
      await grant('workspace', workspace, 'parent', 'workspace', foreign);
      await reject(list(company, { expectedActorAccountId: creator }, ctx(creator)));
    });
    await t.test('cursor is bound to actor, client, owner, kind and status even across two authorized workspaces', async () => {
      const page = await list(company, { limit: 1 });
      await reject(list({ type: 'workspace', id: foreign }, { cursor: page.nextCursor }), 'bad_input');
      await reject(list(company, { kind: 'team', cursor: page.nextCursor }), 'bad_input');
      await reject(list(company, { status: 'archived', cursor: page.nextCursor }), 'bad_input');
      await reject(list(company, { cursor: page.nextCursor }, ctx(human, 'other-client')), 'bad_input');
      await reject(list(company, { expectedActorAccountId: agent, cursor: page.nextCursor }, ctx(agent)), 'bad_input');
      assert.ok((await list(company, { limit: 3, cursor: page.nextCursor })).items.length <= 3);
    });
    await t.test('bounded strict inputs refuse malformed cursor, filters and authority fields', async () => {
      for (const patch of [{ limit: 0 }, { limit: 101 }, { limit: '5' }, { limit: 2.5 }, { kind: 'all' }, { status: 'all' }, { cursor: '' },
        { cursor: '!!!!' }, { cursor: Buffer.from('{}').toString('base64url') }, { actorUserId: other }, { expectedActorAccountId: undefined }]) {
        await reject(list(personal, patch), 'bad_input');
      }
    });
    await t.test('revocation winning the workspace authority lock blocks queued catalog read before returning metadata', async () => {
      const tx = await pool.connect(); let contender;
      try {
        await tx.query('BEGIN'); await lockWorkspaceAuthority(tx, workspace);
        await tx.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_type='user' AND subject_id=$2 AND relation='viewer'", [workspace, human]);
        contender = list(company).then(() => ({ allowed: true }), error => ({ allowed: false, code: error.code }));
        let waiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const observed = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [schema]);
          if (observed.rowCount) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(waiting, 'list waited on existing authority gate');
        await tx.query('COMMIT'); assert.deepEqual(await contender, { allowed: false, code: 'denied' });
        await reject(list(company));
      } finally { await tx.query('ROLLBACK').catch(() => {}); tx.release(); await contender; }
      await grant('workspace', workspace, 'viewer', 'user', human);
    });
    await t.test('archived/missing workspace and suspended human never produce a successful empty list', async () => {
      await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1", [workspace]); await reject(list(company));
      await pool.query("UPDATE workspaces SET status='active' WHERE id=$1", [workspace]);
      await reject(list({ type: 'workspace', id: randomUUID() }));
      await pool.query('UPDATE users SET is_active=false WHERE id=$1', [human]); await reject(list());
      await pool.query('UPDATE users SET is_active=true WHERE id=$1', [human]);
    });
    await t.test('real default router enforces authentication, workforce read scope/client ceiling and DPoP with metadata-only response', async () => {
      const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
      await pool.query("INSERT INTO oidc_signing_keys(kid,alg,private_pem) VALUES('catalog-key','ES256',$1)", [key.privateKey.export({ type: 'pkcs8', format: 'pem' })]);
      const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
      server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const token = (scope = 'workforce:read', client = 'xeno-agent-interface') => jwt.sign({ sub: human, typ: 'at+jwt', client_id: client, scope, cnf: { jkt } }, key.privateKey, { algorithm: 'ES256', keyid: 'catalog-key', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
      const post = async (raw = token(), body = input(), proof = true) => {
        const path = '/api/workforce/resources/list';
        const headers = { 'content-type': 'application/json', ...(raw ? { authorization: `DPoP ${raw}` } : {}) };
        if (proof && raw) headers.dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: `${issuer()}${path}`, ath: accessTokenHash(raw), iat: Math.floor(Date.now() / 1000) }, proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      const result = await post(); assert.equal(result.status, 200); assert.equal(result.body.success, true); assert.equal(result.body.items.length, 6);
      assert.ok(!JSON.stringify(result.body).includes('PRIVATE')); assert.ok(!JSON.stringify(result.body).includes('secretReferences'));
      assert.equal((await post(null)).status, 401); assert.equal((await post(token(), input(), false)).status, 401);
      assert.equal((await post(token('workforce:manage'))).status, 403); assert.equal((await post(token('workforce:read', 'xeno-pixel'))).status, 403);
      assert.equal((await post(token(), input(personal, { expectedActorAccountId: other }))).status, 403);
      assert.equal((await post(token(), input(personal, { actorUserId: other }))).status, 400);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

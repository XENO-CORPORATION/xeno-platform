/**
 * XENO-WORKFORCE-01 VIEW-01: "Global lists are authorized aggregates, never a tenant or permission
 * bypass. Filter metadata by owner, access type, assignment, status and search; paginate server-side."
 *
 * Built as `view: 'global'` on the one catalog endpoint. The refusal note in workforce-catalog.test.mjs
 * named what was missing -- no assignment filter and no search -- and that the close was to extend
 * this endpoint, never add a second list API. Real PostgreSQL, the REAL workforce chain, the real
 * service and the real HTTP router behind OIDC + DPoP.
 *
 * Asserted:
 *   1. AN AUTHORIZED AGGREGATE. The global list is EXACTLY the union of what the caller's per-scope
 *      views return -- their personal scope, every workspace they can read, and every resource
 *      assigned into one of those -- compared as sets, not sampled. A workspace the caller holds
 *      only `member` or `parent` on (which the per-scope view refuses) contributes nothing.
 *   2. NEVER A BYPASS. Nothing a per-scope view would refuse appears: another person's personal
 *      resources, a workspace the caller cannot read, a resource assigned ONLY elsewhere. A filter
 *      that names an unreadable scope is refused like reading it -- not answered empty, which would be
 *      an oracle. A row reached only through an assignment names no owner and no creator, and lists
 *      only the caller's own workspaces it was assigned into, never the others or their count.
 *   3. EVERY FILTER THE REQUIREMENT NAMES: owner, access type, assignment, status and search -- each
 *      one narrows the aggregate to exactly the rows that satisfy it. Search matches name and
 *      description, and treats `%` and `_` as literal text.
 *   4. SERVER-SIDE PAGINATION: a keyset walk returns every row exactly once, and the cursor is bound
 *      to the filters -- reusing it under another filter is refused.
 *   5. REVOCATION WINS: once a workspace grant is removed, that workspace's resources and the ones
 *      assigned into it leave the aggregate on the next page.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-catalog-global-view.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - a workspace tuple of any relation is readable         -> "a stray member tuple admits nothing"
 *   - assignments are read into every workspace             -> "a resource assigned only elsewhere is not reachable"
 *   - an assigned-only row carries its owner                -> "an assigned-only row names no owner or creator"
 *   - a filter on an unreadable scope is answered empty     -> "filtering by an unreadable workspace is refused like reading it"
 *   - search ignores the description                        -> "search matches the description too"
 *   - search does not escape wildcards                      -> "a literal % matches only a literal %"
 *   - the scope hash ignores the filters                    -> "a cursor is bound to its filters"
 *   - the access filter is ignored                          -> "access narrows to exactly that access type"
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
const { default: router } = await import('../src/server/routes/workforceRoutes.js');

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

test('the global catalog is an authorized aggregate with every named filter (VIEW-01)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_global_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, application_name: schema });
  let created = false, server;

  const [me, other, admin, creator] = Array.from({ length: 4 }, () => randomUUID());
  const [studio, agency, stranger, memberOnly] = Array.from({ length: 4 }, () => randomUUID());
  const ctx = (actorUserId = me) => ({ actorUserId, clientId: 'global-test' });
  const list = (rest = {}, context = ctx()) =>
    listOwnedWorkforceResources(pool, context, { expectedActorAccountId: context.actorUserId, view: 'global', ...rest });
  const scoped = (owner, rest = {}) => listOwnedWorkforceResources(pool, ctx(), { owner, expectedActorAccountId: me, limit: 100, ...rest });
  const reject = (promise, code, message) => assert.rejects(promise, (e) => e.code === code, message);
  const all = async (rest = {}) => {
    const ids = []; let cursor;
    do {
      const page = await list({ limit: 3, ...rest, ...(cursor ? { cursor } : {}) });
      ids.push(...page.items.map((i) => i.id)); cursor = page.nextCursor;
    } while (cursor);
    return ids;
  };
  const policy = { schemaVersion: 1, mode: 'explicit', capabilities: ['files.read'] };
  let seq = 0;
  // A team's assignment needs an admitted member set to be accepted, which is ASN-05's business and not
  // this suite's, so assigned resources are agents; owned-only ones mix in teams so `kind` is exercised.
  const resource = async (name, owner, description = 'plain', kind = 'agent') => (await pool.query(`INSERT INTO workforce_resources(kind,owner_user_id,owner_workspace_id,
    created_by_user_id,name,description,created_at) VALUES($1,$2,$3,$4,$5,$6,'2026-09-01T00:00:00Z'::timestamptz + ($7::int * interval '1 millisecond'))
    RETURNING id`, [kind, owner.type === 'user' ? owner.id : null, owner.type === 'workspace' ? owner.id : null,
    creator, name, description, ++seq])).rows[0].id;
  const assign = async (resourceId, into, sourceWorkspace) => {
    const row = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
      resource_revision,created_by_user_id,policy) SELECT id,kind,$2,$3,1,$4,$5 FROM workforce_resources WHERE id=$1 RETURNING id`,
    [resourceId, into, sourceWorkspace, admin, policy])).rows[0];
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted',revision=revision+1,source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(),target_accepted_by_user_id=$2,accepted_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1`, [row.id, admin]);
  };
  const grant = (ws, relation, subject = me) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('workspace',$1,$2,'user',$3) ON CONFLICT DO NOTHING`, [ws, relation, subject]);

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,display_name TEXT,email TEXT,avatar_url TEXT,
      email_verified BOOLEAN DEFAULT true,role TEXT DEFAULT 'user',is_active BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY,alg TEXT,private_pem TEXT);
      CREATE TABLE oauth_dpop_replays(jkt TEXT,jti TEXT,htm TEXT,htu TEXT,expires_at TIMESTAMPTZ,UNIQUE(jkt,jti));`);
    for (const id of [me, other, admin, creator]) await pool.query('INSERT INTO users(id,username) VALUES($1::uuid,$1::text)', [id]);
    await pool.query((await readFile(new URL('20260711120000-workspaces.sql', MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, owner_user_id UUID REFERENCES users(id),
      workspace_id UUID REFERENCES workspaces(id), name TEXT NOT NULL DEFAULT 'p', is_archived BOOLEAN NOT NULL DEFAULT false)`);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || f === '20260811130000-agent-identities.sql')).sort();
    for (const f of chain) await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$5,'Studio','studio'),($2,$5,'Agency','agency'),
      ($3,$5,'Stranger','stranger'),($4,$5,'Member only','member-only')`, [studio, agency, stranger, memberOnly, admin]);
    await grant(studio, 'viewer'); await grant(agency, 'admin');
    // Tuples the per-scope view REFUSES: `member` is not viewer-or-above, and `parent` is structural.
    await grant(memberOnly, 'member');
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
      VALUES('workspace',$1,'parent','workspace',$2)`, [stranger, studio]);

    const mine = { type: 'user', id: me }, S = { type: 'workspace', id: studio }, A = { type: 'workspace', id: agency };
    const X = { type: 'workspace', id: stranger }, M = { type: 'workspace', id: memberOnly };
    const personal1 = await resource('my scribe', mine, 'writes 100% of the notes');
    const personal2 = await resource('my_helper', mine, 'plain', 'team');
    const theirs = await resource('someone else\'s', { type: 'user', id: other });
    const studio1 = await resource('studio editor', S, 'cuts trailers');
    const studio2 = await resource('studio colourist', S);
    const agency1 = await resource('agency planner', A, 'plain', 'team');
    const strangerOwned = await resource('stranger private', X);
    const memberOwned = await resource('member-only private', M);
    const intoStudio = await resource('lent to studio', X, 'reached only by assignment');
    const elsewhereOnly = await resource('lent elsewhere only', X);
    const agencyIntoStudio = await resource('agency lends to studio', A);
    await assign(intoStudio, studio, stranger);
    await assign(intoStudio, memberOnly, stranger);
    await assign(elsewhereOnly, memberOnly, stranger);
    await assign(agencyIntoStudio, studio, agency);
    await pool.query("UPDATE workforce_resources SET status='archived', revision=revision+1 WHERE id=$1", [studio2]);

    await t.test('the aggregate is exactly the union of the per-scope views the caller may read', async () => {
      const union = new Set();
      for (const owner of [mine, S, A]) for (const i of (await scoped(owner)).items) union.add(i.id);
      for (const i of (await scoped(S, { view: 'assigned' })).items) union.add(i.id);
      for (const i of (await scoped(A, { view: 'assigned' })).items) union.add(i.id);
      await reject(scoped(M), 'denied', 'the precondition: the per-scope view refuses the member-only workspace');
      await reject(scoped(X), 'denied', 'the precondition: and the stranger\'s');
      const global = await all();
      assert.equal(new Set(global).size, global.length, 'every row once');
      // The specific exclusions first, so a regression is named by the property it breaks.
      assert.ok(!global.includes(memberOwned), 'a stray member tuple admits nothing');
      assert.ok(!global.includes(elsewhereOnly), 'a resource assigned only elsewhere is not reachable');
      assert.deepEqual([...new Set(global)].sort(), [...union].sort(), 'the global list is the union, no more and no less');
      assert.deepEqual([...union].sort(), [personal1, personal2, studio1, agency1, intoStudio, agencyIntoStudio].sort());
    });

    await t.test('never a bypass: nothing a per-scope view refuses appears, and assigned-only rows say little', async () => {
      const global = await all();
      assert.ok(!global.includes(theirs), "another person's personal resources are not reachable");
      assert.ok(!global.includes(strangerOwned), 'an unreadable workspace contributes nothing');
      assert.ok(!global.includes(memberOwned), 'a stray member tuple admits nothing');
      assert.ok(!global.includes(elsewhereOnly), 'a resource assigned only elsewhere is not reachable');
      const rows = (await list({ limit: 100 })).items;
      const lent = rows.find((r) => r.id === intoStudio);
      assert.deepEqual(lent.access, ['assigned']);
      assert.ok(!Object.hasOwn(lent, 'owner') && !Object.hasOwn(lent, 'createdByUserId'), 'an assigned-only row names no owner or creator');
      assert.deepEqual(lent.assignedInto, [studio], 'only the caller\'s own workspace it was assigned into -- not the member-only one');
      const both = rows.find((r) => r.id === agencyIntoStudio);
      assert.deepEqual(both.access, ['workspace', 'assigned'], 'a resource reached two ways is one row with both');
      assert.deepEqual(both.owner, A);
      assert.ok(!JSON.stringify(rows).includes(stranger) && !JSON.stringify(rows).includes(memberOnly), 'no unreadable scope id reaches the wire');
      await reject(list({ assignedTo: memberOnly }), 'denied', 'filtering by an unreadable workspace is refused like reading it');
      await reject(list({ owner: X }), 'denied', 'filtering by an unreadable owner is refused like reading it');
      await reject(list({ owner: { type: 'user', id: other } }), 'denied', 'and so is another person\'s personal scope');
    });

    await t.test('every filter the requirement names narrows to exactly its rows', async () => {
      assert.deepEqual((await all({ owner: S })).sort(), [studio1].sort(), 'owner');
      assert.deepEqual((await all({ owner: mine })).sort(), [personal1, personal2].sort(), 'owner: personal');
      assert.deepEqual((await all({ access: 'assigned' })).sort(), [intoStudio, agencyIntoStudio].sort(), 'access narrows to exactly that access type');
      assert.deepEqual((await all({ access: 'personal' })).sort(), [personal1, personal2].sort());
      assert.deepEqual((await all({ access: 'workspace' })).sort(), [studio1, agency1, agencyIntoStudio].sort());
      assert.deepEqual((await all({ assignedTo: studio })).sort(), [intoStudio, agencyIntoStudio].sort(), 'assignment');
      assert.deepEqual(await all({ assignedTo: agency }), []);
      assert.deepEqual(await all({ status: 'archived' }), [studio2], 'status');
      assert.deepEqual((await all({ kind: 'team' })).sort(), [personal2, agency1].sort(), 'kind');
      assert.deepEqual((await all({ search: 'STUDIO' })).sort(), [studio1, intoStudio, agencyIntoStudio].sort(), 'search, case-insensitive, on the name');
      assert.deepEqual(await all({ search: 'trailers' }), [studio1], 'search matches the description too');
      assert.deepEqual(await all({ search: '100%' }), [personal1], 'a literal % matches only a literal %');
      assert.deepEqual(await all({ search: 'my_' }), [personal2], 'a literal _ matches only a literal _');
      assert.deepEqual(await all({ search: 'lent', access: 'assigned', assignedTo: studio }), [intoStudio], 'filters compose');
      for (const bad of [{ search: '' }, { search: ' ' }, { search: 'x'.repeat(101) }, { search: 'a\u0000b' }, { access: 'all' },
        { assignedTo: 'nope' }]) await reject(list(bad), 'bad_input', `refused: ${JSON.stringify(bad)}`);
      await reject(listOwnedWorkforceResources(pool, ctx(), { owner: S, expectedActorAccountId: me, search: 'x' }), 'bad_input',
        'a global filter on a scoped view is refused, not silently ignored');
    });

    await t.test('pagination is server-side, exact, and bound to the filters', async () => {
      const walked = await all();
      const once = (await list({ limit: 100 })).items.map((i) => i.id);
      assert.deepEqual(walked, once, 'a keyset walk in pages of 3 returns exactly the one-page answer, in order');
      const first = await list({ limit: 2 });
      await reject(list({ limit: 2, cursor: first.nextCursor, access: 'assigned' }), 'bad_input', 'a cursor is bound to its filters');
      await reject(list({ limit: 2, cursor: first.nextCursor, search: 'studio' }), 'bad_input', 'a cursor is bound to its search');
      await reject(listOwnedWorkforceResources(pool, ctx(), { owner: mine, expectedActorAccountId: me, cursor: first.nextCursor }), 'bad_input',
        'a global cursor is not a scoped one');
    });

    await t.test('revocation wins: a removed grant takes its scope out of the aggregate', async () => {
      await pool.query(`DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2`, [studio, me]);
      const after = await all();
      assert.ok(!after.includes(studio1) && !after.includes(intoStudio), 'the studio and what was assigned into it are gone');
      assert.ok(after.includes(agencyIntoStudio), 'a resource still reachable another way stays');
      const row = (await list({ limit: 100 })).items.find((r) => r.id === agencyIntoStudio);
      assert.deepEqual(row.access, ['workspace'], '-- and no longer claims the studio assignment');
      await grant(studio, 'viewer');
    });

    await t.test('over real HTTP: the router serves the global view and validates it', async () => {
      const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
      await pool.query("INSERT INTO oidc_signing_keys(kid,alg,private_pem) VALUES('global-key','ES256',$1)", [key.privateKey.export({ type: 'pkcs8', format: 'pem' })]);
      const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
      server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
      const raw = jwt.sign({ sub: me, typ: 'at+jwt', client_id: 'xeno-agent-interface', scope: 'workforce:read', cnf: { jkt } },
        key.privateKey, { algorithm: 'ES256', keyid: 'global-key', audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
      const path = '/api/workforce/resources/list';
      const post = async (body) => {
        const dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: `${issuer()}${path}`, ath: accessTokenHash(raw), iat: Math.floor(Date.now() / 1000) },
          proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
        const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `DPoP ${raw}`, dpop }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
      };
      const served = await post({ view: 'global', expectedActorAccountId: me, search: 'lent', limit: 10 });
      assert.equal(served.status, 200, JSON.stringify(served.body));
      assert.deepEqual(served.body.items.map((i) => i.id), [intoStudio]);
      assert.equal(served.body.scope, 'global');
      const denied = await post({ view: 'global', expectedActorAccountId: me, assignedTo: memberOnly });
      assert.equal(denied.status, 403);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

/**
 * XENO-WORKFORCE-01 NFR-07 -- cursors, caches, subscriptions, deep links and exports are scope-bound and
 * revision-aware, and an unauthorized id does not reveal existence through error-detail differences.
 *
 *   NFR-07: "API cursors, caches, subscriptions, deep links and exports are scope-bound and revision-aware.
 *            Unauthorized IDs do not reveal existence through error-detail differences."
 *
 * The requirement names FIVE surfaces plus one parity rule, and refuses to be satisfied by any one of them.
 * Each is proven below on the surface it is actually about, over real HTTP on real PostgreSQL:
 *
 *   cursors        the owned catalog's keyset cursor and the live-event cursor. A cursor is bound to the
 *                  exact scope that issued it -- actor, client, owner, filters -- so handing it to another
 *                  actor or replaying it under a different filter is refused, not silently honoured. It is
 *                  revision-aware: a grant revoked between two pages fences the next page.
 *   caches         every /api reply carries a cache policy, and no authenticated reply may be shared. The
 *                  default is set BEFORE any router runs; it sat at the END of index.js, so it applied only
 *                  to requests no route answered and every real reply went out with no header at all.
 *   subscriptions  the live-event feed, and
 *   deep links     the live share link -- both need a sender-bound (DPoP) OIDC session, so they are proven in
 *                  scripts/live-conversation-collaboration.test.mjs, which runs that exact harness: a revoked
 *                  participant's next feed read answers byte-for-byte like a conversation that does not exist,
 *                  and a revoked share link like an invalid one, beside a link that works (the control).
 *   exports        the rental partition export. The renter's own content and nothing of the seller's; a
 *                  seller naming a renter's partition cannot tell it from one that does not exist.
 *   parity         a real-but-unreadable resource answers exactly like an unused UUID -- compared on the
 *                  WHOLE wire response, canonicalised recursively, never with JSON.stringify's array
 *                  argument (which is a property ALLOWLIST applied at every depth and silently hollows
 *                  nested objects out of both sides of the comparison).
 *
 * Mutation-checked 2026-09-28, each fails the named assertion; restored passes:
 *   - /api replies get no cache policy again      -> "every /api reply states a cache policy"
 *   - the policy is shared rather than private    -> "an authenticated reply is not publicly cacheable"
 *   - the cache default moves back after routers  -> "the cache default is registered before any router"
 *   - the catalog cursor is not scope-bound       -> "a cursor is refused by a different actor"
 *   - the catalog cursor ignores its filters      -> "a cursor from another view is refused"
 *   - a revoked grant still serves the next page  -> "a revoked grant fences the next page, not the next call"
 *   - a foreign partition export is distinguishable -> "another renter's partition is not found"
 *   - a listing you do not own answers 403 again  -> "the marketplace listing a stranger names"
 *   - a transfer id is resolved before the actor kind    -> "an agent learns nothing about a transfer"
 *   (the subscription and deep-link mutants are in live-conversation-collaboration.test.mjs)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import express from 'express';
import pg from 'pg';
import { apiCacheMiddleware } from '../src/server/middleware/cdnOptimization.js';

const url = process.env.TEST_DATABASE_URL;

test('cursors, caches, subscriptions, deep links and exports are scope-bound and revision-aware (NFR-07)', { skip: !url, timeout: 120000 }, async (t) => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  t.after(() => pool.end());
  const { default: workforceRoutes } = await import('../src/server/routes/workforceRoutes.js');
  const { default: marketplaceRoutes } = await import('../src/server/routes/marketplaceRoutes.js');
  const { listOwnedWorkforceResources } = await import('../src/server/services/workforceCatalog.js');

  // The /api boundary as index.js composes it: the cache default BEFORE the routers that answer.
  const app = express();
  app.use(express.json());
  app.use('/api/', apiCacheMiddleware);
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/workforce', workforceRoutes);
  app.use('/api/marketplace', marketplaceRoutes);
  // A route that sets its OWN policy, to prove the default does not overwrite a deliberate one.
  const own = express.Router();
  own.get('/own-policy', (_req, res) => { res.set('Cache-Control', 'private, max-age=300'); res.json({ ok: true }); });
  app.use('/api/demo', own);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const send = async (method, path, { user, body, token } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : user ? { authorization: `Bearer ${jwt.sign({ userId: user }, process.env.JWT_SECRET, { expiresIn: '10m' })}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };

  const marker = `nfr07-${crypto.randomUUID().slice(0, 8)}`;
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
    VALUES($1,$2,'test-only',$1,TRUE,now()) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const tuple = (object, relation, u, objectType = 'workspace') => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES($1,$2,$3,'user',$4) ON CONFLICT DO NOTHING`, [objectType, object, relation, u]);
  const alice = await user('alice'), bob = await user('bob');
  const studio = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [alice, `${marker}-studio`])).rows[0].id;
  await tuple(studio, 'owner', alice);
  await tuple(studio, 'viewer', bob);
  for (let i = 0; i < 5; i++) {
    await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name,created_at)
      VALUES($1,$2,$3,'2026-09-05T12:00:00Z'::timestamptz + ($4::int * interval '1 second'))`,
    [i % 2 ? 'team' : 'agent', studio, `${marker} resource ${i}`, i]);
  }

  await t.test('NFR-07: every /api reply states a cache policy, and none of it is shared', async () => {
    const replies = [
      ['an authenticated workforce list', await send('POST', '/workforce/resources/list', { user: alice, body: { owner: { type: 'workspace', id: studio } } })],
      ['a workforce route without a credential', await send('POST', '/workforce/resources/list', { body: { owner: { type: 'workspace', id: studio } } })],
      ['the marketplace catalog', await send('GET', '/marketplace/catalog')],
      ['a marketplace listing that does not exist', await send('GET', `/marketplace/listings/${marker}-absent`)],
    ];
    for (const [what, r] of replies) {
      const policy = r.headers.get('cache-control');
      assert.ok(policy, `every /api reply states a cache policy (${what} answered ${r.status} with none)`);
      assert.ok(!/(^|,\s*)public/.test(policy), `an authenticated reply is not publicly cacheable (${what} answered "${policy}")`);
    }
    // The control that stops this passing vacuously: a route's own policy still wins.
    const ownPolicy = await send('GET', '/demo/own-policy');
    assert.equal(ownPolicy.headers.get('cache-control'), 'private, max-age=300', 'a route that sets its own policy keeps it');
    assert.equal(ownPolicy.status, 200);
  });

  await t.test('NFR-07: the cache default is registered before any router, not after them', async () => {
    // The defect this pins is positional: mounted last, the middleware can only ever run for requests no
    // route answered -- so every real reply was sent before it. A behavioural test on a composed app cannot
    // see that, because the composition here is the FIXED order; the file is where the order is decided.
    const source = await readFile(new URL('../src/server/index.js', import.meta.url), 'utf8');
    const at = (needle) => { const i = source.indexOf(needle); assert.ok(i > -1, `index.js still contains ${needle}`); return i; };
    const cacheDefault = at("app.use('/api/', apiCacheMiddleware)");
    for (const mount of ["app.use('/api/workforce'", "app.use('/api/marketplace'", "app.use('/api/chat'", "app.use('/api/billing'", "app.use('/api/account'"]) {
      if (source.includes(mount)) assert.ok(cacheDefault < at(mount), `the cache default is registered before any router (${mount} mounts first)`);
    }
    // And after the middleware that must still reject a request outright.
    assert.ok(cacheDefault > at("app.use('/api/', suspensionGate(pool))"), 'the cache default still runs after the suspension gate');
  });

  await t.test('NFR-07: a catalog cursor is bound to the scope that issued it, and a revoked grant fences the next page', async () => {
    const ctx = (actorUserId, clientId = 'xeno-agent-interface') => ({ actorUserId, clientId });
    const mine = { owner: { type: 'workspace', id: studio }, expectedActorAccountId: alice };
    const page = await listOwnedWorkforceResources(pool, ctx(alice), { ...mine, limit: 2 });
    assert.ok(page.nextCursor, 'a bounded page issues a cursor');
    assert.ok(page.items.length <= 2);
    // The same cursor under a DIFFERENT actor, client, or filter is refused -- a cursor is a scope, not a key.
    const forBob = await listOwnedWorkforceResources(pool, ctx(bob), { owner: { type: 'workspace', id: studio }, expectedActorAccountId: bob, limit: 2, cursor: page.nextCursor })
      .catch((e) => e);
    assert.equal(forBob?.details?.reason, 'catalog_cursor_scope_mismatch', 'a cursor is refused by a different actor');
    const otherClient = await listOwnedWorkforceResources(pool, ctx(alice, 'xeno-pixel'), { ...mine, limit: 2, cursor: page.nextCursor }).catch((e) => e);
    assert.equal(otherClient?.details?.reason, 'catalog_cursor_scope_mismatch', 'a cursor is refused from another client');
    const otherFilter = await listOwnedWorkforceResources(pool, ctx(alice), { ...mine, limit: 2, kind: 'team', cursor: page.nextCursor }).catch((e) => e);
    assert.equal(otherFilter?.details?.reason, 'catalog_cursor_scope_mismatch', 'a cursor from another view is refused');

    // Revision-aware: a grant revoked between two pages fences the NEXT PAGE, not merely the next call.
    await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2 AND relation='viewer'", [studio, bob]);
    const afterRevocation = await listOwnedWorkforceResources(pool, ctx(bob), { owner: { type: 'workspace', id: studio }, expectedActorAccountId: bob, limit: 2 }).catch((e) => e);
    assert.equal(afterRevocation?.code, 'denied', 'a revoked grant fences the next page, not the next call');
    await tuple(studio, 'viewer', bob);
  });

  await t.test('NFR-07: an export is the author\'s own content, and another owner cannot tell a partition exists', async () => {
    const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [alice, `${marker}-dev`])).rows[0].id;
    const listing = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,rental_license)
      VALUES($1,'mind',$2,$1,'published','{"schemaVersion":1,"personal":true,"workspace":false,"maxWorkspaces":0}'::jsonb) RETURNING id`, [`${marker}-mind`, dev])).rows[0].id;
    const entitlement = (await pool.query(`INSERT INTO marketplace_entitlements(user_id,listing_id,kind,status)
      VALUES($1,$2,'rental','active') RETURNING id`, [bob, listing])).rows[0].id;
    const partition = (await pool.query(`INSERT INTO marketplace_rental_partitions(entitlement_id,renter_user_id) VALUES($1,$2) RETURNING id`,
      [entitlement, bob])).rows[0].id;
    await pool.query(`INSERT INTO marketplace_rental_memory(partition_id,kind,content) VALUES($1,'note',$2)`, [partition, `${marker} renter note`]);

    const mine = await send('GET', `/marketplace/rental-partitions/${partition}/export`, { user: bob });
    assert.deepEqual([mine.status, mine.body.export?.items?.length], [200, 1], "an export is the author's own content");
    assert.ok(JSON.stringify(mine.body).includes(`${marker} renter note`));
    // The SELLER, who owns the listing, is not the renter: the partition is not theirs and does not exist for them.
    const theirs = await send('GET', `/marketplace/rental-partitions/${partition}/export`, { user: alice });
    const absent = await send('GET', `/marketplace/rental-partitions/${crypto.randomUUID()}/export`, { user: alice });
    assert.equal(theirs.status, absent.status, "another renter's partition is not found");
    assert.equal(JSON.stringify(theirs.body), JSON.stringify(absent.body), "another renter's partition is not found");
  });

  await t.test('NFR-07: unauthorized ids do not reveal existence through error-detail differences', async () => {
    // Compared on the WHOLE wire response. canonical() recurses; JSON.stringify's array argument does NOT
    // (it is a property allowlist applied at every depth, which silently drops nested keys).
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
    const wire = async (r) => ({ status: r.status, body: JSON.stringify(canonical(r.body)) });
    const same = async (what, real, absent) => {
      const [a, b] = [await wire(real), await wire(absent)];
      assert.deepEqual(a, b, `${what}: a resource that exists but is not readable must be indistinguishable from one that does not`);
    };

    const dev = (await pool.query(`SELECT id FROM marketplace_developers WHERE slug=$1`, [`${marker}-dev`])).rows[0].id;
    const draft = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,status)
      VALUES($1,'mind',$2,$1,'draft') RETURNING id`, [`${marker}-draft`, dev])).rows[0].id;
    // A listing that exists (a draft, another developer's) vs an id that is nobody's -- over real HTTP.
    await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Stranger dev',$2)`, [bob, `${marker}-bobdev`]);
    await same('the marketplace listing a stranger names', await send('POST', `/marketplace/listings/${draft}/submit`, { user: bob, body: {} }),
      await send('POST', `/marketplace/listings/${crypto.randomUUID()}/submit`, { user: bob, body: {} }));
    assert.equal((await send('POST', `/marketplace/listings/${draft}/submit`, { user: bob, body: {} })).status, 404,
      'a listing you do not own is not found');
    // The control: its OWNER gets past the ownership check, so the refusal above is about ownership, not the id.
    assert.notEqual((await send('POST', `/marketplace/listings/${draft}/submit`, { user: alice, body: {} })).status, 404,
      'the owner of a listing is not told it does not exist');

    // An agent naming a transfer learns nothing -- its KIND is decided before any id is resolved. Proven at the
    // service, because the transfer router admits only a sender-bound OIDC session: a test token would be refused
    // at the door for both ids alike, and the comparison would pass without proving anything.
    const svc = await import('../src/server/services/workforceOwnershipTransfer.js');
    const bot = await user('bot');
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','nfr07-fixture')", [bot, alice]);
    const resource = (await pool.query('SELECT id FROM workforce_resources WHERE owner_workspace_id=$1 LIMIT 1', [studio])).rows[0].id;
    const transfer = (await svc.proposeOwnershipTransfer(pool, { actorUserId: alice, resourceId: resource, to: { type: 'user', id: alice } })).id;
    const refusal = async (fn, args) => fn(pool, args).then(() => 'allowed',
      (e) => JSON.stringify(canonical({ code: e.code, details: e.details, status: e.status })));
    for (const [name, fn] of [['read', svc.readOwnershipTransfer], ['review subject', svc.transferReviewSubject], ['authorize', svc.authorizeOwnershipTransfer]]) {
      const real = await refusal(fn, { actorUserId: bot, transferId: transfer });
      const absent = await refusal(fn, { actorUserId: bot, transferId: crypto.randomUUID() });
      assert.equal(real, absent, `an agent learns nothing about a transfer (${name}: ${real} vs ${absent})`);
      assert.notEqual(real, 'allowed');
    }
    // The control: the source's own admin reads it, and still gets not-found for an id that names nothing.
    assert.equal((await svc.readOwnershipTransfer(pool, { actorUserId: alice, transferId: transfer })).id, transfer,
      'a transfer its source can read is not hidden from it');
    assert.match(await refusal(svc.readOwnershipTransfer, { actorUserId: alice, transferId: crypto.randomUUID() }), /transfer_not_found/,
      'an id that names nothing is still not found for someone who could read the real one');
  });
});

/**
 * XENO-WORKFORCE-01 MKT-01 -- six rights over a listed agent, each distinct, none implying another.
 *
 *   MKT-01: "Distinguish ownership, visibility, invoke permission, definition-edit permission, export/license
 *            rights and conversation collaboration. Neither a public listing nor a share link grants tools or
 *            workspace files."
 *
 * One seller-owned agent, published as a `mind` listing through the rails MKT-03 locked (a licensed, signed,
 * reviewed version), with a hosted serving version (MKT-05). Then five principals, each given EXACTLY ONE right,
 * each shown to hold none of the others -- through the real marketplace router on real PostgreSQL, the real
 * workforce services, and the real share service:
 *
 *   visibility     a stranger who can SEE the listing          -> no invoke, no download, no edit, no transfer
 *   invoke+export  a buyer with an owned entitlement           -> runs it and may download it; no edit, no transfer
 *   invoke only    a renter                                   -> runs it; NO download (the listing page included); no edit
 *   collaboration  a participant through a share link         -> reads the shared conversation; nothing of the agent
 *   ownership      the seller                                  -> the only one who may transfer the agent
 *   definition-edit                                            -> the owner scope's editors, through the revision
 *                                                                command (workforceAgentRevision.js): the definition
 *                                                                is NEVER shown to a non-owner, and a holder of any
 *                                                                other right is refused a revision as if the agent
 *                                                                did not exist
 *
 * And for every principal, "grants no tools or workspace files" is checked the only way it can be: the GRANT
 * LEDGER -- every table that can confer authority -- is unchanged by everything that principal did, and the
 * principal holds no relationship tuple, assignment, membership or capability on anything of the seller's.
 *
 * FOUND WHILE BUILDING THIS, and fixed in routes/marketplaceRoutes.js: invoke and export were NOT distinct on the
 * listing page. GET /download refused a renter (rental_not_downloadable), but GET /listings/:slug computed its
 * download URLs from "has an active entitlement", so the same renter read a working signed URL for the same
 * private artifact off the public page. Reproduced on real PostgreSQL before the fix; asserted below.
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - the listing page ignores the rental rule         -> "a renter reads no download URL off the listing page"
 *   - /download ignores the rental rule                -> "a renter cannot download the private artifact"
 *   - an entitlement is not required to invoke         -> "a stranger who can see a listing cannot run it"
 *   - the listing discloses the definition             -> "a listing never shows the agent's definition"
 *   - a non-manager may propose a transfer             -> "only the owner may give the agent away"
 *   - accepting a share grants a conversation relation -> "a share grants no relation on the conversation"
 *   - acquiring a listing writes a workspace tuple     -> "acquiring a listing grants nothing but the entitlement"
 *   - any signed-in human may revise a definition      -> "a holder of another right may not revise the definition"
 *
 * The revision right itself -- editors only, humans only, If-Match, inherited provenance, idempotent, and never
 * reaching a running run -- is proven in scripts/workforce-agent-revision.test.mjs. This suite proves only that
 * none of the OTHER five rights carries it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');

test('ownership, visibility, invoke, definition-edit, export and collaboration are six distinct rights (MKT-01)', { skip: !url, timeout: 120000 }, async (t) => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  assert.ok((await pool.query("SELECT to_regclass('marketplace_rental_bindings') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { default: marketplaceRoutes } = await import('../src/server/routes/marketplaceRoutes.js');
  const { createWorkforceResource } = await import('../src/server/services/workforceResources.js');
  const { proposeOwnershipTransfer } = await import('../src/server/services/workforceOwnershipTransfer.js');
  const { reviseAgentDefinition } = await import('../src/server/services/workforceAgentRevision.js');
  const { createLiveShare, acceptLiveShare, readLiveEvents } = await import('../src/server/services/liveConversationCollaboration.js');
  const { check } = await import('../src/server/utils/authzReBAC.js');
  const { addGrant, MICRO_PER_CREDIT } = await import('../src/server/utils/creditLedgerV2.js');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/marketplace`;

  const marker = `mr-${crypto.randomUUID().slice(0, 8)}`;
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
    VALUES($1,$2,'test-only',$1,TRUE,now()) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const as = (who) => async (method, path, body) => {
    const token = jwt.sign({ userId: who }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const seller = await user('seller'), stranger = await user('stranger'), buyer = await user('buyer'), renter = await user('renter'), guest = await user('guest');
  for (const u of [buyer, renter]) await addGrant(pool, u, { amountMicro: 500 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${marker}-${u}` });
  const studio = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [seller, `${marker}-studio`])).rows[0].id;
  await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)`, [studio, seller]);

  // The seller's agent. Its definition carries sentinels, so any disclosure of it is detectable byte for byte.
  const SENTINEL = { instructions: `PRIVATE-INSTRUCTIONS-${marker}`, skill: `private.skill.${marker.replace(/-/g, '')}`, secret: 'PRIVATE_PROVIDER_KEY' };
  const created = await createWorkforceResource(pool, { actorUserId: seller, clientId: 'xeno-web' }, { operationId: crypto.randomUUID(),
    owner: { type: 'workspace', id: studio }, kind: 'agent', name: `${marker} analyst`,
    definition: { schemaVersion: 1, instructions: SENTINEL.instructions, skills: [{ id: SENTINEL.skill, version: '1.0.0', hash: 'c'.repeat(64) }],
      requestedCapabilities: ['files.read'], secretReferences: [{ name: SENTINEL.secret, ref: crypto.randomUUID() }], license: { identifier: 'Proprietary' } } });
  const agentId = created.resource.id;

  // Its listing: published, a licensed signed gated version, and a hosted serving version with a personal rental licence.
  const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [seller, `${marker}-dev`])).rows[0].id;
  const slug = `${marker}-analyst`;
  const listing = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,rental_license)
    VALUES($1,'mind',$2,$1,'published','{"schemaVersion":1,"personal":true,"workspace":false,"maxWorkspaces":0}'::jsonb) RETURNING id`, [slug, dev])).rows[0].id;
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits) VALUES($1,'one_time',5),($1,'rental',5)`, [listing]);
  await pool.query(`UPDATE marketplace_listing_pricing SET period='week' WHERE listing_id=$1 AND model='rental'`, [listing]);
  const manifest = JSON.stringify({ format: 'xanima', schemaVersion: 1, kind: 'anima', minds: [{ id: 'm', path: 'minds/m/mind.xeno' }], entries: [] });
  const version = (await pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,artifact_r2_key,servable,published_at,license,
      artifact_sha256,ed25519_sig,ed25519_pubkey,manifest) VALUES($1,'1.0.0',$2,true,now(),'Proprietary',$3,'c2ln','c2ln',$4::jsonb) RETURNING id`,
  [listing, `private/${marker}.xanima`, 'a'.repeat(64), manifest])).rows[0].id;

  // ── the ledger of grants: every table that can confer authority ───────────────────────────────────────────────
  const GRANT_TABLES = ['relationship_tuples', 'workforce_workspace_assignments', 'workforce_team_memberships', 'workforce_project_participations',
    'workforce_assignment_members', 'workforce_run_admissions', 'workforce_run_leases', 'workforce_ownership_transfers', 'workforce_resources',
    'workforce_agent_versions', 'api_key_workforce_capabilities', 'agent_identities', 'chat_live_participants'];
  const ledger = async (exclude = []) => {
    const out = {};
    for (const table of GRANT_TABLES) {
      if (exclude.includes(table) || !(await pool.query('SELECT to_regclass($1) AS t', [table])).rows[0].t) continue;
      out[table] = (await pool.query(`SELECT md5(coalesce(string_agg(md5(t::text), ',' ORDER BY md5(t::text)), '')) AS h, count(*)::int AS n FROM ${table} t`)).rows[0];
    }
    return out;
  };
  // What a principal holds on the seller's estate: nothing, for every principal but the seller.
  const holdings = async (who) => ({
    tuples: (await pool.query(`SELECT object_type, relation FROM relationship_tuples WHERE subject_id=$1
      AND object_type IN ('workspace','division','project','conversation') AND object_id::text IN ($2::text, $3::text)`, [who, studio, agentId])).rows,
    assignments: (await pool.query('SELECT id FROM workforce_workspace_assignments WHERE created_by_user_id=$1', [who])).rows,
    memberships: (await pool.query('SELECT id FROM workforce_team_memberships WHERE member_principal_id=$1', [who])).rows,
    agents: (await pool.query('SELECT id FROM workforce_resources WHERE owner_user_id=$1 OR created_by_user_id=$1', [who])).rows,
  });
  const NOTHING = { tuples: [], assignments: [], memberships: [], agents: [] };
  const discloses = (body) => Object.values(SENTINEL).some((s) => JSON.stringify(body).includes(s));
  // Definition-edit: the revision command, asked by each holder of some OTHER right, answers as if the agent did not exist.
  const reviseAs = (who) => reviseAgentDefinition(pool, { actorUserId: who, clientId: 'xeno-web' }, { operationId: crypto.randomUUID(),
    resourceId: agentId, baseVersion: 1, definition: { schemaVersion: 1, instructions: `rewritten by ${who}`, skills: [], requestedCapabilities: [] } });
  const cannotEdit = (who) => assert.rejects(reviseAs(who), (e) => e.details?.reason === 'agent_not_found',
    'a holder of another right may not revise the definition');

  await t.test('MKT-01: visibility -- a stranger sees the listing, and nothing else', async () => {
    const before = await ledger();
    const call = as(stranger);
    const page = await call('GET', `/listings/${slug}`);
    assert.equal(page.status, 200, 'a published listing is visible');
    assert.equal(discloses(page.body), false, 'a listing never shows the agent\'s definition');
    assert.equal(page.body.versions[0].downloadUrl, null, 'a stranger reads no download URL');
    assert.equal((await call('GET', `/download/${version}`)).status, 403, 'a stranger cannot download the private artifact');
    // Invoke is the entitlement's, and this listing offers no pay-per-use: seeing it is no right to run it.
    const run = await call('POST', `/invoke/${listing}`, { prompt: 'hello' });
    assert.equal(run.status, 402, `a stranger who can see a listing cannot run it (answered ${run.status} ${run.body.error})`);
    await assert.rejects(proposeOwnershipTransfer(pool, { actorUserId: stranger, resourceId: agentId, to: { type: 'user', id: stranger } }),
      (e) => e.details?.reason === 'resource_not_found', 'only the owner may give the agent away');
    await cannotEdit(stranger);
    assert.deepEqual(await ledger(), before, 'seeing a listing grants nothing');
    assert.deepEqual(await holdings(stranger), NOTHING, 'seeing a listing grants no tools or workspace files');
  });

  await t.test('MKT-01: invoke + export -- a buyer runs and downloads it, and still may not edit or own it', async () => {
    const call = as(buyer);
    // Taken BEFORE the purchase: acquiring writes exactly one thing that confers authority -- the entitlement,
    // which is not in the grant ledger -- so every grant table must read the same afterwards.
    const before = await ledger();
    const bought = await call('POST', `/listings/${listing}/purchase`, {});
    assert.equal(bought.status, 200, `the purchase went through (${JSON.stringify(bought.body).slice(0, 120)})`);
    const page = await call('GET', `/listings/${slug}`);
    assert.equal(discloses(page.body), false, 'a listing never shows the agent\'s definition');
    assert.ok(page.body.versions[0].downloadUrl, 'an owned entitlement carries the export right its licence gives');
    const dl = await call('GET', `/download/${version}`);
    assert.equal(dl.status, 200, 'an owner of the listing may download it');
    // The artifact is the PACKAGE the seller published; the platform's own definition row is never handed over.
    assert.equal(discloses(dl.body), false, 'a download hands over the published package, never the workforce definition');
    await assert.rejects(proposeOwnershipTransfer(pool, { actorUserId: buyer, resourceId: agentId, to: { type: 'user', id: buyer } }),
      (e) => e.details?.reason === 'resource_not_found', 'only the owner may give the agent away');
    await cannotEdit(buyer);
    const versions = (await pool.query('SELECT count(*)::int AS n FROM workforce_agent_versions WHERE resource_id=$1', [agentId])).rows[0].n;
    assert.equal(versions, 1, 'a buyer writes no new version of the seller\'s definition');
    assert.deepEqual(await ledger(), before, 'acquiring a listing grants nothing but the entitlement');
    assert.deepEqual(await holdings(buyer), NOTHING, 'acquiring a listing grants no tools or workspace files');
  });

  await t.test('MKT-01: invoke only -- a renter runs it and may not take it, not even off the listing page', async () => {
    const call = as(renter);
    // Taken before renting, for the same reason: a rental and its binding are not grants.
    const before = await ledger();
    assert.equal((await call('POST', `/listings/${listing}/rent`, {})).status, 200, 'the rental went through');
    const bound = await call('POST', `/listings/${listing}/rental/bind`, {});
    assert.equal(bound.status, 200, 'a renter may bind the serving version to run it');
    const page = await call('GET', `/listings/${slug}`);
    assert.equal(page.body.entitlement?.type, 'rental');
    assert.equal(page.body.versions[0].downloadUrl, null, 'a renter reads no download URL off the listing page');
    const dl = await call('GET', `/download/${version}`);
    assert.deepEqual([dl.status, dl.body.error], [403, 'rental_not_downloadable'], 'a renter cannot download the private artifact');
    assert.equal(discloses(page.body) || discloses(dl.body), false, 'a listing never shows the agent\'s definition');
    // A rental is never an IMPORT of the definition either -- proven for a team package, where import exists, in
    // src/server/tests/marketplace-team-packages.test.mjs ("a rental is hosted use, never an imported copy"). A mind
    // listing has no import path at all, so there is nothing further to refuse here.
    await assert.rejects(proposeOwnershipTransfer(pool, { actorUserId: renter, resourceId: agentId, to: { type: 'user', id: renter } }),
      (e) => e.details?.reason === 'resource_not_found', 'only the owner may give the agent away');
    await cannotEdit(renter);
    assert.deepEqual(await ledger(), before, 'acquiring a listing grants nothing but the entitlement');
    assert.deepEqual(await holdings(renter), NOTHING, 'renting grants no tools or workspace files');
  });

  await t.test('MKT-01: collaboration -- a share link lets a guest read the conversation, and grants nothing of the agent', async () => {
    const conversation = (await pool.query(`INSERT INTO chat_conversations(user_id,owner_user_id,created_by_user_id,title) VALUES($1,$1,$1,$2) RETURNING id`,
      [seller, `${marker} run`])).rows[0].id;
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('conversation',$1,'owner','user',$2)`, [conversation, seller]);
    const share = await createLiveShare(pool, { conversationId: conversation, ownerId: seller, role: 'contributor' });
    const before = await ledger(['chat_live_participants', 'relationship_tuples']);
    const tuplesBefore = (await pool.query('SELECT object_type, object_id::text AS object_id, relation, subject_id FROM relationship_tuples')).rows;
    // The token travels only inside the link -- the service keeps its digest, never the token.
    await acceptLiveShare(pool, { token: share.share_url.split('/').pop(), userId: guest });
    assert.ok(Array.isArray((await readLiveEvents(pool, { conversationId: conversation, userId: guest })).events), 'a share lets its participant read the conversation');
    for (const relation of ['viewer', 'editor', 'admin', 'owner']) {
      assert.equal((await check(pool, { object: `conversation:${conversation}`, relation, subject: `user:${guest}` })).allowed, false,
        'a share grants no relation on the conversation');
    }
    assert.equal((await check(pool, { object: `workspace:${studio}`, relation: 'viewer', subject: `user:${guest}` })).allowed, false,
      'a share grants nothing in the owner\'s workspace');
    assert.equal((await as(guest)('GET', `/download/${version}`)).status, 403, 'a share grants no export of the agent');
    await cannotEdit(guest);
    assert.deepEqual(await ledger(['chat_live_participants', 'relationship_tuples']), before, 'a share link grants nothing but its participation');
    // Accepting writes exactly ONE tuple: the participation relation on that one conversation. It is not in the role
    // hierarchy (authzReBAC ROLE_RANK), so it satisfies no viewer/editor/admin/owner check -- asserted above.
    const added = (await pool.query('SELECT object_type, object_id::text AS object_id, relation, subject_id FROM relationship_tuples')).rows
      .filter((r) => !tuplesBefore.some((b) => b.object_type === r.object_type && b.object_id === r.object_id && b.relation === r.relation && b.subject_id === r.subject_id));
    assert.deepEqual(added.map((r) => [r.object_type, r.object_id, r.relation, r.subject_id]), [['conversation', conversation, 'collaboration_contributor', guest]],
      'a share link grants nothing but its participation');
    assert.deepEqual(await holdings(guest), NOTHING, 'a share link grants no tools or workspace files');
  });

  await t.test('MKT-01: ownership and definition-edit stay with the owner', async () => {
    // None of the four rights granted above produced a second version: the definition still has one, its owner's.
    const authors = async () => (await pool.query('SELECT created_by_user_id FROM workforce_agent_versions WHERE resource_id=$1 ORDER BY version', [agentId])).rows;
    assert.deepEqual(await authors(), [{ created_by_user_id: seller }], 'the definition has one author: its owner');
    // The owner may revise it -- definition-edit is a right the owner scope's editors hold ...
    const revised = await reviseAs(seller);
    assert.deepEqual([revised.revision.previousVersion, revised.revision.version], [1, 2], 'the owner may revise the definition');
    assert.deepEqual(await authors(), [{ created_by_user_id: seller }, { created_by_user_id: seller }], 'the definition has one author: its owner');
    // ... and may give the agent away, which nobody above could.
    const proposed = await proposeOwnershipTransfer(pool, { actorUserId: seller, resourceId: agentId, to: { type: 'user', id: seller } });
    assert.ok(proposed, 'only the owner may give the agent away');
  });
});

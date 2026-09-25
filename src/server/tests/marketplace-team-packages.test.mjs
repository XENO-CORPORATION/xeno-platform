/**
 * XENO-WORKFORCE-01 MKT-04 -- a team is exported as a package of its configuration only, and imported as a
 * NEW licensed instance with provenance (listing kind `team`, decision D22).
 *
 *   "Exported team packages include authorized configuration and redistributable dependencies only.
 *    Exclude human corporate memberships, credentials, active sessions, private Soul and
 *    non-redistributable nested agents. Import creates a licensed instance with provenance, not the
 *    seller's corporate team identity."
 *
 * Driven through the REAL marketplace routes on the migrated PostgreSQL schema, on the rails that already
 * exist: a seller registers, creates a `team` listing, exports one of their canonical teams into a draft
 * version, submits it (automated checks), an admin approves it (review), a buyer purchases it
 * (entitlement) and imports it. The seller's team is built with everything a real company team carries --
 * a human member, an agent identity member, a secret with a vault reference, an accepted workspace
 * assignment with its approved member set, a project participation -- so that what stays behind is
 * observed, not assumed.
 *
 * Proved:
 *   1. the package holds the team's configuration and NOTHING else: no human membership, no principal or
 *      vault id, no assignment, member set, participation or session, and a secret by NAME only;
 *   2. a non-redistributable nested agent stays behind, and the seller's report says which and why;
 *   3. the platform builds the package -- a caller cannot supply one, and the database refuses to publish
 *      a package holding anything outside the allowlist, even when a reviewer approves it;
 *   4. import needs an active, non-rental entitlement to a PUBLISHED version and acceptance of its exact
 *      licence;
 *   5. import creates a NEW team and NEW agents owned by the importer, placed in no workspace, carrying
 *      the definitions as sold with every secret unbound and provenance `imported` -- and shares no id,
 *      creator or grant with the seller's team;
 *   6. provenance is recorded from the marketplace rows and is retained; a second import returns the same
 *      instance; a published package is immutable.
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the export copies a human member                   -> "a human membership never leaves the company"
 *   - the export carries the vault reference             -> "a secret travels by name, never by vault reference"
 *   - a non-redistributable imported agent is exported   -> "a non-redistributable nested agent stays behind"
 *   - the route accepts a caller-supplied package        -> "the platform builds the package, never the caller"
 *   - the database does not check a published package    -> "a reviewer cannot publish a package holding a principal"
 *   - export lets a workspace editor sell the team       -> "a workspace editor may build a team, not sell it"
 *   - import skips the entitlement                       -> "import needs an entitlement"
 *   - import ignores licence acceptance                  -> "the importer accepts this version's licence"
 *   - import accepts a rental entitlement                -> "a rental is hosted use, never an imported copy"
 *   - import ignores who may manage the owner            -> "a buyer imports only where they administer"
 *   - import attributes the instance to nobody           -> "the importer is the instance's creator"
 *   - import binds the declared secrets to a vault id    -> "every secret arrives unbound"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/marketplace-team-packages.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';

test('a team exports as configuration only and imports as a new licensed instance with provenance (MKT-04)', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required');
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  const { default: marketplaceRoutes } = await import('../routes/marketplaceRoutes.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/marketplace`;
  const jwt = (await import('jsonwebtoken')).default;

  const marker = `teampkg-${Date.now()}`;
  const mkUser = async (name, role = 'user') => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role)
     VALUES($1,$2,'test-only',$1,TRUE,NOW(),$3) RETURNING id`, [`${marker}-${name}`, `${marker}-${name}@example.test`, role])).rows[0].id;
  const seller = await mkUser('seller'), colleague = await mkUser('colleague'), buyer = await mkUser('buyer');
  const stranger = await mkUser('stranger'), admin = await mkUser('admin', 'admin'), renter = await mkUser('renter');
  const as = (userId) => {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    return async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };
  const sellerCall = as(seller), buyerCall = as(buyer), adminCall = as(admin), strangerCall = as(stranger), renterCall = as(renter);

  const workspace = async (owner, slug, extra = []) => {
    const id = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-${slug}`])).rows[0].id;
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)`, [id, owner]);
    for (const [relation, user] of extra) {
      await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`, [id, relation, user]);
    }
    return id;
  };
  const studio = await workspace(seller, 'studio', [['editor', colleague]]);
  const buyerWs = await workspace(buyer, 'buyer-ws');

  // ── a real company team, carrying everything a company team carries ──────────────────────────
  const vaultRef = crypto.randomUUID();
  const agentResource = async (name, owner, { license = 'Apache-2.0', provenance = { source: 'authored' }, secrets = [] } = {}) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name)
      VALUES($1,'agent',$2,$3,$4,$5)`, [id, owner.type === 'user' ? owner.id : null, owner.type === 'workspace' ? owner.id : null, seller, name]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance,license,created_by_user_id)
      VALUES($1,1,$2,$3,$4,$5,$6)`, [id, { instructions: `${name}: review the diff`, skills: [{ id: 'lint', version: '1', hash: 'c'.repeat(64) }],
      requestedCapabilities: ['files.read'], secretReferences: secrets }, 'a'.repeat(64), provenance, license ? { identifier: license } : {}, seller]);
    return id;
  };
  const studioOwner = { type: 'workspace', id: studio };
  const reviewer = await agentResource('Reviewer', studioOwner, { secrets: [{ name: 'GITHUB_TOKEN', ref: vaultRef }] });
  const planner = await agentResource('Planner', studioOwner, { license: null });
  const licensedIn = await agentResource('Vendor bot', studioOwner, { license: 'Proprietary - single seat',
    provenance: { source: 'imported', sourceVersion: '2.0.0' } });
  const foreign = await agentResource('Borrowed', { type: 'user', id: stranger });
  const identity = await mkUser('agent-identity');
  await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','teampkg-fixture')", [identity, seller]);

  const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,created_by_user_id,name,description)
    VALUES('team',$1,$2,'Review crew','Reviews every pull request') RETURNING id`, [studio, seller])).rows[0].id;
  const member = (values) => pool.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,member_principal_id,role,created_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [team, values.resource ?? null, values.resource ? 'agent' : null, values.principal ?? null, values.role, seller]);
  await member({ resource: reviewer, role: 'manager' });
  await member({ resource: planner, role: 'worker' });
  await member({ resource: licensedIn, role: 'worker' });
  await member({ resource: foreign, role: 'observer' });
  await member({ principal: colleague, role: 'manager' });     // a PERSON at the seller's company
  await member({ principal: identity, role: 'worker' });       // an agent PRINCIPAL, not a definition

  // An accepted assignment into the studio with its approved member set, and a project participation:
  // the grants a company gave this team. None of it is configuration, and none of it may travel.
  const { rows: [{ team_membership_revision: rev, revision: resRev }] } = await pool.query('SELECT team_membership_revision, revision FROM workforce_resources WHERE id=$1', [team]);
  const none = { schemaVersion: 1, mode: 'none', capabilities: [] };
  const assignment = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
    resource_revision,policy,member_set_revision) VALUES($1,'team',$2,$2,$3,$4,1) RETURNING id`, [team, studio, resRev, none])).rows[0].id;
  const members = (await pool.query("SELECT id, revision, role FROM workforce_team_memberships WHERE team_id=$1 AND state='active'", [team])).rows;
  await pool.query(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,team_membership_revision,member_count)
    VALUES($1,1,$2,$3,$4,$5)`, [assignment, team, studio, rev, members.length]);
  for (const m of members) {
    await pool.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
      VALUES($1,1,$2,$3,$4,$5)`, [assignment, team, m.id, m.revision, m.role]);
  }
  await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
    source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [assignment, seller]);
  const project = (await pool.query('INSERT INTO chat_projects(workspace_id,name) VALUES($1,$2) RETURNING id', [studio, `${marker}-proj`])).rows[0].id;
  await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy)
    VALUES($1,'team',$2,'workspace',$3,$4,'assigned team',$5)`, [team, project, studio, assignment, none]);

  const secretsOf = [colleague, identity, vaultRef, assignment, project, studio, seller, stranger, foreign, licensedIn];

  // ── the existing rails: developer, a `team` listing ─────────────────────────────────────────
  assert.equal((await sellerCall('POST', '/developer/register', { displayName: `${marker} Studio` })).status, 201);
  const created = await sellerCall('POST', '/listings', { kind: 'team', title: `${marker} Review crew`, license: 'Proprietary - team seat',
    pricing: [{ model: 'one_time', priceCredits: 0 }] });
  assert.equal(created.status, 201, `a team listing is created on the existing rails: ${JSON.stringify(created.body)}`);
  const listing = created.body.listing.id;

  // ── 3a. the platform builds the package ─────────────────────────────────────────────────────
  const supplied = await sellerCall('POST', `/listings/${listing}/versions`, { version: '0.9.0', teamId: team,
    teamPackage: { format: 'xeno-team-package', schemaVersion: 1, team: { name: 'x' }, members: [] } });
  assert.equal(supplied.status, 400, 'the platform builds the package, never the caller');
  assert.equal(supplied.body.error, 'team_package_is_built_by_the_platform', 'the platform builds the package, never the caller');

  // Authority: only a manager of the team's OWNER may give its configuration away.
  const colleagueCall = as(colleague);
  await colleagueCall('POST', '/developer/register', { displayName: `${marker} Colleague` });
  const colleagueListing = (await colleagueCall('POST', '/listings', { kind: 'team', title: `${marker} Colleague crew`, license: 'MIT',
    pricing: [{ model: 'free', priceCredits: 0 }] })).body.listing.id;
  const byEditor = await colleagueCall('POST', `/listings/${colleagueListing}/versions`, { version: '1.0.0', teamId: team });
  assert.equal(byEditor.status, 403, 'a workspace editor may build a team, not sell it');

  // ── 1 + 2. export ───────────────────────────────────────────────────────────────────────────
  const exported = await sellerCall('POST', `/listings/${listing}/versions`, { version: '1.0.0', teamId: team, releaseNotes: 'first' });
  assert.equal(exported.status, 201, `the owner's manager exports: ${JSON.stringify(exported.body)}`);
  assert.deepEqual(exported.body.excluded.agents.map((e) => [e.member, e.reason]).sort(),
    [['Borrowed', 'not_the_sellers_agent'], ['Vendor bot', 'not_redistributable']], 'a non-redistributable nested agent stays behind');
  const pkg = exported.body.package;
  const text = JSON.stringify(pkg);
  assert.ok(!text.includes(colleague) && !text.includes(identity), 'a human membership never leaves the company');
  assert.deepEqual(Object.keys(pkg).sort(), ['format', 'members', 'schemaVersion', 'team'], 'the package has exactly the allowlisted sections');
  assert.deepEqual(pkg.team, { name: 'Review crew', description: 'Reviews every pull request' }, 'the team section is its name and description only');
  assert.deepEqual(pkg.members.map((m) => [m.name, m.role]), [['Reviewer', 'manager'], ['Planner', 'worker']],
    'the package is the team\'s agent definitions and the function each serves');
  assert.equal(exported.body.excluded.memberships, 2, 'the seller is told how many memberships stayed behind');
  assert.ok(!text.includes(vaultRef), 'a secret travels by name, never by vault reference');
  assert.deepEqual(pkg.members[0].definition.secretNames, ['GITHUB_TOKEN'], 'a secret travels by name, never by vault reference');
  for (const id of secretsOf) assert.ok(!text.includes(id), `no principal, vault, grant or scope id is in the package (${id})`);
  for (const word of ['assignment', 'participation', 'policy', 'session', 'soul', 'Soul', 'owner', 'createdBy', 'ref']) {
    assert.ok(!Object.keys(pkg.members[0]).includes(word) && !Object.keys(pkg.members[0].definition).includes(word), `no ${word} field is in the package`);
  }
  assert.equal(pkg.members[0].license, 'Apache-2.0', 'an authored agent keeps its redistributable licence');
  assert.equal(pkg.members[1].license, null, 'an unlicensed authored agent is governed by the version licence');
  assert.equal(exported.body.license, 'Proprietary - team seat');
  const versionId = exported.body.versionId;

  // The draft is the seller's: not listed, not importable, not downloadable.
  const slug = (await pool.query('SELECT slug FROM marketplace_listings WHERE id=$1', [listing])).rows[0].slug;
  await pool.query("UPDATE marketplace_listings SET status='published' WHERE id=$1", [listing]);
  assert.ok(!(await buyerCall('GET', `/listings/${slug}`)).body.versions.some((v) => v.id === versionId), 'an unreviewed team version is not listed');
  assert.equal((await buyerCall('POST', `/listings/${listing}/purchase`, {})).status, 200);
  const early = await buyerCall('POST', `/listings/${listing}/import-team`, { versionId, owner: { type: 'user', id: buyer }, acceptLicense: 'Proprietary - team seat' });
  assert.equal(early.status, 404, 'an unreviewed team version cannot be imported');

  // ── review ──────────────────────────────────────────────────────────────────────────────────
  const submitted = await sellerCall('POST', `/listings/${listing}/submit`, { versionId });
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  assert.equal(submitted.body.submission.checks.teamPackage.pass, true, 'the automated checks include the team package');
  assert.equal((await adminCall('POST', `/submissions/${submitted.body.submission.id}/approve`, {})).status, 200);
  const detail = await buyerCall('GET', `/listings/${slug}`);
  const shown = detail.body.versions.find((v) => v.id === versionId);
  assert.deepEqual(shown.team.members.map((m) => [m.name, m.role, m.secretNames]), [['Reviewer', 'manager', ['GITHUB_TOKEN']], ['Planner', 'worker', []]],
    'a buyer sees who is in the team and which secrets they will provide, before buying');

  // ── 3b. the database holds the allowlist, even against a reviewer ───────────────────────────
  const smuggled = { ...pkg, members: [{ ...pkg.members[0], principalId: colleague }] };
  const sneaky = (await pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,license,team_package,team_package_hash)
    VALUES($1,'1.0.9','Proprietary - team seat',$2::jsonb,$3) RETURNING id`, [listing, JSON.stringify(smuggled), 'd'.repeat(64)])).rows[0].id;
  const sneakySub = (await pool.query(`INSERT INTO marketplace_submissions(listing_id,listing_version_id,state) VALUES($1,$2,'in_review') RETURNING id`, [listing, sneaky])).rows[0].id;
  const refused = await adminCall('POST', `/submissions/${sneakySub}/approve`, {});
  assert.equal(refused.status, 422, 'a reviewer cannot publish a package holding a principal');
  assert.equal(refused.body.error, 'team_package_not_publishable', 'a reviewer cannot publish a package holding a principal');
  const vaulted = { ...pkg, members: [{ ...pkg.members[0], definition: { ...pkg.members[0].definition, secretNames: [{ name: 'GITHUB_TOKEN', ref: vaultRef }] } }] };
  await assert.rejects(pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,license,team_package,team_package_hash,published_at)
    VALUES($1,'1.0.8','Proprietary - team seat',$2::jsonb,$3,now())`, [listing, JSON.stringify(vaulted), 'd'.repeat(64)]),
  (e) => e.code === '23514', 'a published package cannot carry a vault reference');

  // ── 4. import needs an entitlement, a published version and the exact licence ───────────────
  const importAs = (call, body) => call('POST', `/listings/${listing}/import-team`, { versionId, owner: { type: 'user', id: body.ownerId }, ...body.extra });
  const noEntitlement = await importAs(strangerCall, { ownerId: stranger, extra: { acceptLicense: 'Proprietary - team seat' } });
  assert.equal(noEntitlement.status, 403, 'import needs an entitlement');
  assert.equal(noEntitlement.body.error, 'denied', 'import needs an entitlement');
  assert.equal(noEntitlement.body.details.reason, 'no_active_entitlement', 'import needs an entitlement');
  const wrongLicence = await importAs(buyerCall, { ownerId: buyer, extra: { acceptLicense: 'MIT' } });
  assert.equal(wrongLicence.status, 409, 'the importer accepts this version\'s licence');
  assert.equal(wrongLicence.body.details.reason, 'license_not_accepted', 'the importer accepts this version\'s licence');
  const intoOthers = await buyerCall('POST', `/listings/${listing}/import-team`, { versionId, owner: { type: 'workspace', id: studio }, acceptLicense: 'Proprietary - team seat' });
  assert.equal(intoOthers.status, 403, 'a buyer imports only where they administer');
  // A rental entitlement to this listing (the rent route needs a hosted serving version; MKT-05 covers it).
  await pool.query("INSERT INTO marketplace_entitlements(user_id,listing_id,kind,expires_at) VALUES($1,$2,'rental',now()+interval '30 days')", [renter, listing]);
  const rentedImport = await importAs(renterCall, { ownerId: renter, extra: { acceptLicense: 'Proprietary - team seat' } });
  assert.equal(rentedImport.body.details?.reason, 'rental_is_not_an_import', 'a rental is hosted use, never an imported copy');

  // ── 5. a NEW instance, owned by the importer ────────────────────────────────────────────────
  const imported = await buyerCall('POST', `/listings/${listing}/import-team`, { versionId, owner: { type: 'workspace', id: buyerWs },
    acceptLicense: 'Proprietary - team seat', teamName: 'Our reviewers' });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const record = imported.body.import;
  assert.notEqual(record.teamId, team, 'the instance is a NEW team, not the seller\'s');
  const newTeam = (await pool.query('SELECT * FROM workforce_resources WHERE id=$1', [record.teamId])).rows[0];
  assert.equal(newTeam.owner_workspace_id, buyerWs, 'the instance is owned by the importer');
  assert.equal(newTeam.created_by_user_id, buyer, 'the importer is the instance\'s creator');
  assert.equal(newTeam.name, 'Our reviewers');
  assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_workspace_assignments WHERE resource_id=$1', [record.teamId])).rows[0].n, 0,
    'the instance is placed in no workspace until its owner assigns it');
  assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_project_participations WHERE resource_id=$1', [record.teamId])).rows[0].n, 0,
    'no participation travels');
  const newMembers = (await pool.query(`SELECT m.role, m.member_principal_id, r.id, r.name, r.owner_workspace_id, v.content, v.provenance, v.license
    FROM workforce_team_memberships m JOIN workforce_resources r ON r.id=m.member_resource_id
    JOIN workforce_agent_versions v ON v.resource_id=r.id WHERE m.team_id=$1 ORDER BY r.name`, [record.teamId])).rows;
  assert.deepEqual(newMembers.map((m) => [m.name, m.role]), [['Planner', 'worker'], ['Reviewer', 'manager']]);
  assert.ok(newMembers.every((m) => m.member_principal_id === null && m.owner_workspace_id === buyerWs), 'the agents are NEW resources owned by the importer');
  assert.ok(newMembers.every((m) => ![reviewer, planner].includes(m.id)), 'the agents are NEW resources owned by the importer');
  assert.ok(newMembers.every((m) => m.content.secretReferences.length === 0), 'every secret arrives unbound');
  assert.ok(!JSON.stringify(newMembers).includes(vaultRef), 'every secret arrives unbound');
  assert.deepEqual(record.requiredSecrets[newMembers.find((m) => m.name === 'Reviewer').id], ['GITHUB_TOKEN'], 'the buyer is told which secrets to bind');
  assert.ok(newMembers.every((m) => m.provenance.source === 'imported' && m.provenance.sourceVersion === '1.0.0'), 'each agent records it was imported');
  assert.equal(newMembers.find((m) => m.name === 'Reviewer').license.identifier, 'Apache-2.0');
  assert.equal(newMembers.find((m) => m.name === 'Planner').license.identifier, 'Proprietary - team seat', 'an agent sold under the version licence is licensed under it');
  assert.equal(newMembers.find((m) => m.name === 'Reviewer').content.instructions, 'Reviewer: review the diff', 'the definitions arrive as sold');

  // ── 6. provenance, idempotence, immutability ────────────────────────────────────────────────
  const prov = (await pool.query('SELECT * FROM marketplace_team_imports WHERE team_id=$1', [record.teamId])).rows[0];
  assert.equal(prov.listing_version_id, versionId);
  assert.equal(prov.license, 'Proprietary - team seat', 'the instance is licensed under what was accepted');
  assert.equal(prov.package_hash, exported.body.packageHash);
  assert.ok(!JSON.stringify(prov).includes(team), 'the provenance record carries no id of the seller\'s team');
  const again = await buyerCall('POST', `/listings/${listing}/import-team`, { versionId, owner: { type: 'workspace', id: buyerWs }, acceptLicense: 'Proprietary - team seat' });
  assert.equal(again.status, 200, 'importing the same purchase into the same place returns the same instance');
  assert.equal(again.body.import.teamId, record.teamId, 'importing the same purchase into the same place returns the same instance');
  const read = await buyerCall('GET', `/team-imports/${record.teamId}`);
  assert.equal(read.body.import.listingVersionId, versionId, 'the owner can read where their team came from');
  assert.equal((await strangerCall('GET', `/team-imports/${record.teamId}`)).status, 404, 'a stranger cannot learn an imported team exists');
  await assert.rejects(pool.query("UPDATE marketplace_team_imports SET license='MIT' WHERE team_id=$1", [record.teamId]),
    (e) => e.code === '23514', 'provenance is retained and immutable');
  await assert.rejects(pool.query('DELETE FROM marketplace_team_imports WHERE team_id=$1', [record.teamId]),
    (e) => e.code === '23514', 'provenance is retained and immutable');
  await assert.rejects(pool.query("UPDATE marketplace_listing_versions SET team_package = team_package || '{\"members\":[]}'::jsonb WHERE id=$1", [versionId]),
    (e) => e.code === '23514', 'a published team package is immutable');
  await assert.rejects(pool.query('DELETE FROM marketplace_listing_versions WHERE id=$1', [versionId]),
    (e) => e.code === '23514', 'a published team package is retained');

  // The seller's team is untouched by being sold.
  assert.equal((await pool.query("SELECT count(*)::int n FROM workforce_team_memberships WHERE team_id=$1 AND state='active'", [team])).rows[0].n, 6,
    'exporting takes nothing away from the seller\'s team');

  // Kind isolation: only a team listing carries a team package.
  const panel = (await sellerCall('POST', '/listings', { kind: 'panel', title: `${marker} panel`, pricing: [{ model: 'free', priceCredits: 0 }] })).body.listing.id;
  await assert.rejects(pool.query(`INSERT INTO marketplace_listing_versions(listing_id,version,team_package,team_package_hash) VALUES($1,'1.0.0',$2::jsonb,$3)`,
    [panel, JSON.stringify(pkg), 'e'.repeat(64)]), (e) => e.code === '23514', 'only a team listing carries a team package');
});

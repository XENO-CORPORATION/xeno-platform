/**
 * XENO-WORKFORCE-01 MKT-03 -- agent versions are published through the EXISTING marketplace rails, and a
 * published one holds still.
 *
 *   "Publish immutable licensed agent versions and coordinated-agent packages through existing marketplace
 *    review/signing/distribution rails. Keep `mind`/legacy `swarm` listing compatibility and canonical
 *    artifact naming. Do not change shipping trust roots to pass a gate."
 *
 * Driven through the REAL marketplace routes on PostgreSQL, end to end on the rails that already exist:
 * a developer registers, creates a listing, uploads a version signed with a REAL Ed25519 key over the
 * artifact's SHA-256, submits it (automated checks), an admin approves it (review), and a buyer downloads
 * it (entitlement-gated distribution). Nothing here is a new publishing path.
 *
 * Proved:
 *   1. an agent version is LICENSED -- an unlicensed listing cannot upload one, the version carries the
 *      licence it was published under, and a later change to the listing's label does not change it;
 *   2. its artifact is a SIGNED canonical `.xanima`: a forged signature, an unsigned artifact, a
 *      non-.xanima artifact and a manifest of the wrong kind are each refused at upload;
 *   3. a `mind` carries one Mind, a `swarm` (the legacy listing kind for a coordinated package) carries
 *      a wiring graph, and neither may embed the private Soul;
 *   4. it reaches buyers only through REVIEW -- unreviewed, it is not listed and not downloadable, and a
 *      reviewer cannot approve one that breaks the rules (the database refuses it);
 *   5. once published it is IMMUTABLE and RETAINED -- artifact, hash, signature, manifest, capabilities
 *      and licence cannot change and it cannot be deleted; a change is a NEW version;
 *   6. the rails were not bent to pass: no trust root changed (the route verifies the signature against
 *      the key the version declares; nothing here registers a key anywhere).
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - upload skips the agent-version rules              -> "an unlicensed agent listing cannot upload a version"
 *   - the version does not snapshot the licence         -> "the version keeps the licence it was published under"
 *   - the manifest kind is not checked                  -> "a manifest of the wrong kind is refused"
 *   - an embedded Soul is not checked                   -> "a published package never carries the private Soul"
 *   - swarm wiring is not required                      -> "a swarm is a coordinated package: it needs its wiring"
 *   - download ignores review                           -> "an unreviewed agent version is not distributed"
 *   - published versions are not frozen                 -> "a published agent version is immutable"
 *   - the database does not re-check at publication     -> "a reviewer cannot publish an unsigned agent"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/marketplace-agent-versions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';

test('agent versions are licensed, signed .xanima, published through review and then immutable (MKT-03)', { timeout: 60000 }, async (t) => {
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

  const marker = `agentver-${Date.now()}`;
  const mkUser = async (name, role = 'user') => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role)
     VALUES($1,$2,'test-only',$1,TRUE,NOW(),$3) RETURNING id`, [name, `${name}@example.test`, role])).rows[0].id;
  const seller = await mkUser(`${marker}-seller`), buyer = await mkUser(`${marker}-buyer`), admin = await mkUser(`${marker}-admin`, 'admin');
  const as = (userId) => {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    return async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };
  const sellerCall = as(seller), buyerCall = as(buyer), adminCall = as(admin);

  // A real Ed25519 key, used exactly as the ecosystem convention says: the signature is over the
  // artifact's SHA-256 hex string, and the raw 32-byte public key travels with the version.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  const signed = (content) => {
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    return { sha256, ed25519Sig: crypto.sign(null, Buffer.from(sha256, 'utf8'), privateKey).toString('base64'), ed25519PubKey: pubB64 };
  };
  const manifest = (kind, extra = {}) => ({
    format: 'xanima', schemaVersion: 1, kind, createdAt: '2026-09-25T00:00:00Z',
    minds: [{ id: 'mira', path: 'minds/mira/mind.xeno', soul: { mindId: 'mira', embedded: false } }],
    entries: [{ path: 'minds/mira/mind.xeno', sha256: 'b'.repeat(64) }], ...extra,
  });
  const upload = (listingId, version, body) => sellerCall('POST', `/listings/${listingId}/versions`,
    { version, artifactR2Key: `agents/${marker}/${version}.xanima`, ...signed(`artifact ${version}`), manifest: manifest('anima'), ...body });

  // ── the existing rails: developer, listings ─────────────────────────────────────────────────
  assert.equal((await sellerCall('POST', '/developer/register', { displayName: `${marker} Studio` })).status, 201);
  const mkListing = async (kind, license) => {
    const r = await sellerCall('POST', '/listings', { kind, title: `${marker} ${kind} ${license ?? 'unlicensed'}`,
      ...(license ? { license } : {}), pricing: [{ model: 'one_time', priceCredits: 0 }] });
    assert.equal(r.status, 201, `create ${kind} listing answered ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.listing.id;
  };
  const mind = await mkListing('mind', 'Proprietary - single seat');
  const swarm = await mkListing('swarm', 'Proprietary - team');
  const unlicensed = await mkListing('mind', null);

  // ── 1. licensed ─────────────────────────────────────────────────────────────────────────────
  const noLicence = await upload(unlicensed, '1.0.0', {});
  assert.equal(noLicence.status, 400, 'an unlicensed agent listing cannot upload a version');
  assert.ok(noLicence.body.problems.includes('license_required'), 'an unlicensed agent listing cannot upload a version');

  // ── 2. signed canonical .xanima ─────────────────────────────────────────────────────────────
  const forged = await upload(mind, '0.9.0', { ...signed('artifact 0.9.0'), ed25519Sig: signed('something else').ed25519Sig });
  assert.equal(forged.status, 400, 'a forged signature is refused against the key the version declares');
  const unsigned = await upload(mind, '0.9.1', { ed25519Sig: undefined, ed25519PubKey: undefined });
  assert.ok(unsigned.body.problems?.includes('artifact_unsigned'), 'an unsigned agent artifact is refused');
  const notXanima = await upload(mind, '0.9.2', { artifactR2Key: `agents/${marker}/0.9.2.zip` });
  assert.ok(notXanima.body.problems?.includes('artifact_not_canonical'), 'a non-.xanima agent artifact is refused');
  const wrongKind = await upload(mind, '0.9.3', { manifest: manifest('swarm', { wiring: { path: 'wiring.json' } }) });
  assert.ok(wrongKind.body.problems?.includes('manifest_kind_mismatch'), 'a manifest of the wrong kind is refused');

  // ── 3. mind / swarm packages, and the private Soul stays behind ─────────────────────────────
  const soulEmbedded = await upload(mind, '0.9.4', { manifest: manifest('anima', {
    minds: [{ id: 'mira', path: 'minds/mira/mind.xeno', soul: { mindId: 'mira', embedded: true, paths: ['minds/mira/soul/episodes.jsonl'] } }] }) });
  assert.ok(soulEmbedded.body.problems?.includes('private_soul_embedded'), 'a published package never carries the private Soul');
  const twoMinds = await upload(mind, '0.9.5', { manifest: manifest('anima', {
    minds: [{ id: 'a', path: 'minds/a/mind.xeno' }, { id: 'b', path: 'minds/b/mind.xeno' }] }) });
  assert.ok(twoMinds.body.problems?.includes('mind_carries_one_mind'), 'a mind listing carries exactly one Mind');
  const noWiring = await upload(swarm, '1.0.0', { manifest: manifest('swarm') });
  assert.ok(noWiring.body.problems?.includes('swarm_requires_wiring'), 'a swarm is a coordinated package: it needs its wiring');
  const swarmOk = await upload(swarm, '1.0.1', { manifest: manifest('swarm', {
    minds: [{ id: 'lead', path: 'minds/lead/mind.xeno' }, { id: 'scout', path: 'minds/scout/mind.xeno' }], wiring: { path: 'wiring.json' } }) });
  assert.equal(swarmOk.status, 201, `a legacy swarm listing still publishes a coordinated package: ${JSON.stringify(swarmOk.body)}`);

  const good = await upload(mind, '1.0.0', {});
  assert.equal(good.status, 201, `a licensed, signed .xanima uploads: ${JSON.stringify(good.body)}`);
  assert.equal(good.body.version.license, 'Proprietary - single seat', 'the version keeps the licence it was published under');
  const versionId = good.body.version.id;

  // ── 4. only through review ──────────────────────────────────────────────────────────────────
  assert.equal((await buyerCall('POST', `/listings/${mind}/purchase`, {})).status, 404, 'a draft listing is not for sale');
  const slug = (await pool.query('SELECT slug FROM marketplace_listings WHERE id=$1', [mind])).rows[0].slug;
  await pool.query("UPDATE marketplace_listings SET status='published' WHERE id=$1", [mind]);   // an older version was live
  assert.equal((await buyerCall('POST', `/listings/${mind}/purchase`, {})).status, 200);
  const draftDownload = await buyerCall('GET', `/download/${versionId}`);
  assert.equal(draftDownload.status, 404, 'an unreviewed agent version is not distributed');
  const draftDetail = await buyerCall('GET', `/listings/${slug}`);
  assert.ok(!draftDetail.body.versions.some((v) => v.id === versionId), 'an unreviewed agent version is not listed');

  const submitted = await sellerCall('POST', `/listings/${mind}/submit`, { versionId });
  assert.equal(submitted.status, 202, `submit answered ${submitted.status} ${JSON.stringify(submitted.body)}`);
  assert.equal(submitted.body.submission.checks.agentPackage.pass, true, 'the automated checks include the agent-package rules');
  const approved = await adminCall('POST', `/submissions/${submitted.body.submission.id}/approve`, {});
  assert.equal(approved.status, 200, `approve answered ${approved.status} ${JSON.stringify(approved.body)}`);
  const downloaded = await buyerCall('GET', `/download/${versionId}`);
  assert.equal(downloaded.status, 200, 'a reviewed agent version is distributed to an entitled buyer');
  assert.equal(downloaded.body.sha256, signed('artifact 1.0.0').sha256);
  assert.equal(downloaded.body.signed, true);

  // A reviewer cannot publish a version that breaks the rules: the database refuses it at publication.
  const sneaky = (await pool.query(
    `INSERT INTO marketplace_listing_versions(listing_id,version,artifact_r2_key,artifact_sha256,license,manifest)
     VALUES($1,'1.0.9',$2,$3,'Proprietary - single seat',$4::jsonb) RETURNING id`,
    [mind, `agents/${marker}/1.0.9.xanima`, 'd'.repeat(64), JSON.stringify(manifest('anima'))])).rows[0].id;
  const sneakySub = (await pool.query(
    `INSERT INTO marketplace_submissions(listing_id,listing_version_id,state) VALUES($1,$2,'in_review') RETURNING id`, [mind, sneaky])).rows[0].id;
  const refused = await adminCall('POST', `/submissions/${sneakySub}/approve`, {});
  assert.equal(refused.status, 422, 'a reviewer cannot publish an unsigned agent');
  assert.equal(refused.body.error, 'agent_version_not_publishable');
  assert.equal((await pool.query('SELECT published_at FROM marketplace_listing_versions WHERE id=$1', [sneaky])).rows[0].published_at, null);

  // ── 5. immutable and retained; a change is a new version ────────────────────────────────────
  await pool.query("UPDATE marketplace_listings SET license = 'Relicensed - enterprise' WHERE id = $1", [mind]);
  assert.equal((await pool.query('SELECT license FROM marketplace_listing_versions WHERE id=$1', [versionId])).rows[0].license,
    'Proprietary - single seat', 'the version keeps the licence it was published under');
  for (const [column, value] of [['artifact_r2_key', `agents/${marker}/swapped.xanima`], ['artifact_sha256', 'e'.repeat(64)],
    ['ed25519_sig', 'Zm9yZ2Vk'], ['license', 'MIT'], ['manifest', JSON.stringify(manifest('anima', { generator: 'rewritten' }))],
    ['declared_capabilities', '["files.write"]'], ['published_at', new Date(Date.now() + 3600e3).toISOString()]]) {
    const cast = ['manifest', 'declared_capabilities'].includes(column) ? '::jsonb' : '';
    await assert.rejects(pool.query(`UPDATE marketplace_listing_versions SET ${column} = $2${cast} WHERE id = $1`, [versionId, value]),
      (e) => e.code === '23514', `a published agent version is immutable (${column})`);
  }
  await assert.rejects(pool.query('DELETE FROM marketplace_listing_versions WHERE id=$1', [versionId]),
    (e) => e.code === '23514', 'a published agent version is retained');
  await assert.rejects(pool.query('TRUNCATE marketplace_listing_versions CASCADE'),
    (e) => e.code === '23514', 'published agent versions survive a truncate');
  // Serving state is review state about how the platform RUNS a version, not part of what was published.
  await pool.query('UPDATE marketplace_listing_versions SET servable = true WHERE id = $1', [versionId]);
  const next = await upload(mind, '1.1.0', {});
  assert.equal(next.status, 201, 'a change is a new version');
  assert.equal(next.body.version.license, 'Relicensed - enterprise', 'and the new version takes the licence in force when it was made');
  const reApproveOld = await adminCall('POST', `/submissions/${submitted.body.submission.id}/approve`, {});
  assert.equal(reApproveOld.status, 409, 'an approved submission is not re-approved');

  // Other kinds are untouched: a panel version stays editable, unlicensed and unsigned as before.
  const panel = await mkListing('panel', null);
  const panelVersion = await sellerCall('POST', `/listings/${panel}/versions`, { version: '1.0.0', manifest: { panel: true } });
  assert.equal(panelVersion.status, 201, 'non-agent kinds keep their existing rules');
  await pool.query('UPDATE marketplace_listing_versions SET published_at = now() WHERE id = $1', [panelVersion.body.version.id]);
  await pool.query("UPDATE marketplace_listing_versions SET release_notes = 'edited' WHERE id = $1", [panelVersion.body.version.id]);

  // ── 6. no trust root was changed to pass ────────────────────────────────────────────────────
  // The only key in play is the one this test generated and the version declares; the route verified the
  // signature against it and refused a forged one above. Nothing was registered as trusted anywhere.
  const stored = (await pool.query('SELECT ed25519_pubkey FROM marketplace_listing_versions WHERE id=$1', [versionId])).rows[0];
  assert.equal(stored.ed25519_pubkey, pubB64, 'the version carries the key that signed it');
});

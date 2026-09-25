/**
 * XENO-WORKFORCE-01 MKT-05 -- a rental is hosted use of a serving version, bound where its licence allows.
 *
 *   "Rental assignment references an active entitlement and hosted serving version, not a downloadable
 *    private agent. Binding to workspace/project must be allowed by the license. Expiry and revocation
 *    block new dispatch; consumed work remains accountable."
 *
 * Driven through the REAL marketplace routes on PostgreSQL: the rental is bought through the existing
 * /listings/:id/rent, bound through /listings/:id/rental/bind, invoked through /invoke. The hosted run
 * itself is marketplace-broker.test.mjs's subject (MKT-06); here xeno-agents-api is a recording stub
 * that admits every run, because what this suite proves is WHETHER a dispatch is allowed and WHAT it
 * is pinned to, not how a run executes.
 *
 * Proved:
 *   1. a binding pins the listing's hosted SERVING version, and a listing with none cannot be rented;
 *   2. a rental never unlocks the seller's private, gated artifact;
 *   3. the licence decides where a rental may run: personal use, workspace use, the workspace limit, and
 *      only in a workspace the renter belongs to;
 *   4. an EXPIRED rental, a REVOKED rental and a REVOKED binding each refuse new dispatch -- and a retry
 *      of an earlier invocation is refused the same way;
 *   5. consumed work stays accountable: invocations keep their binding and serving version after the
 *      rental ends, and revoking the entitlement revokes its bindings without deleting anything.
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - dispatch does not re-check the entitlement           -> "an expired rental refuses new dispatch"
 *   - dispatch does not re-check the binding               -> "a revoked binding refuses new dispatch"
 *   - a rental may download the gated artifact              -> "a rental never unlocks the private artifact"
 *   - the licence's workspace flag is ignored               -> "a licence without workspace use refuses a workspace binding"
 *   - the workspace limit is ignored                        -> "the licence's workspace limit is enforced"
 *   - membership is not checked                             -> "a rental binds only to a workspace the renter belongs to"
 *   - a non-servable version may be bound                   -> "only a hosted serving version can be rented"
 *   - revoking the entitlement leaves its bindings live     -> "revoking a rental revokes its bindings"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/marketplace-rentals.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { addGrant, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { optInUsageCredits } from './usage-credit-fixture.mjs';

test('a rental runs a serving version where its licence allows, and stops when it ends (MKT-05)', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required');
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  // A recording stand-in for xeno-agents-api: admits every run and remembers the requests.
  const runsCreated = [];
  const agents = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/runs') {
        const key = req.headers['idempotency-key'];
        let run = runsCreated.find((r) => r.key === key);
        if (!run) { run = { key, runId: `run_${runsCreated.length + 1}`, body: JSON.parse(body) }; runsCreated.push(run); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ run: { runId: run.runId, status: 'queued' } }));
      }
      const m = /^\/runs\/(.+)$/.exec(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run: { runId: m?.[1], status: 'completed', creditsSettled: 1 } }));
    });
  });
  await new Promise((r) => agents.listen(0, '127.0.0.1', r));
  process.env.AGENTS_API_BASE_URL = `http://127.0.0.1:${agents.address().port}`;

  const { default: marketplaceRoutes } = await import('../routes/marketplaceRoutes.js');
  const { revokeRentalEntitlement } = await import('../services/marketplaceRentals.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); agents.close(); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/marketplace`;
  const jwt = (await import('jsonwebtoken')).default;

  // ── people, workspaces, a rentable mind ─────────────────────────────────────────────────────
  const marker = `rent-${Date.now()}`;
  const mkUser = async (name) => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [name, `${name}@example.test`])).rows[0].id;
  const renter = await mkUser(marker);
  const seller = await mkUser(`${marker}-s`);
  await optInUsageCredits(pool, renter);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'internal','active') ON CONFLICT (user_id) DO NOTHING", [renter]);
  await addGrant(pool, renter, { amountMicro: 500 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${marker}-grant` });
  const token = jwt.sign({ userId: renter }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const mkWorkspace = async (member) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO workspaces (id, name, slug, owner_user_id) VALUES ($1, $2, $2, $3)`, [id, `${marker}-${id.slice(0, 8)}`, seller]);
    if (member) await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('workspace',$1,'member','user',$2)`, [id, renter]);
    return id;
  };
  const wsA = await mkWorkspace(true), wsB = await mkWorkspace(true), wsOther = await mkWorkspace(false);

  const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [seller, `${marker}-dev`])).rows[0].id;
  const mkListing = async (slug, license) => (await pool.query(
    `INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,rental_license) VALUES($1,'mind',$2,$1,'published',$3::jsonb) RETURNING id`,
    [`${marker}-${slug}`, dev, JSON.stringify({ schemaVersion: 1, ...license })])).rows[0].id;
  // A published agent version is licensed and, when it ships an artifact, a signed canonical .xanima
  // (MKT-03, 20260925100000). The signature material is shape-only here: this suite is about rentals.
  const mkVersion = async (listing, version, { servable, gated }) => (await pool.query(
    `INSERT INTO marketplace_listing_versions(listing_id,version,artifact_r2_key,servable,published_at,license,
       artifact_sha256,ed25519_sig,ed25519_pubkey,manifest)
     VALUES($1,$2,$3,$4,now(),'Proprietary',$5,$6,$6,$7::jsonb) RETURNING id`,
    [listing, version, gated ? `private/${listing}/${version}.xanima` : null, servable,
     gated ? 'a'.repeat(64) : null, gated ? 'c2ln' : null,
     JSON.stringify(gated ? { format: 'xanima', schemaVersion: 1, kind: 'anima', minds: [{ id: 'm', path: 'minds/m/mind.xeno' }], entries: [] } : {})])).rows[0].id;
  const rentable = await mkListing('mind', { personal: true, workspace: true, maxWorkspaces: 1 });
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',10,'week')`, [rentable]);
  const privateArtifact = await mkVersion(rentable, '1.0.0', { servable: false, gated: true });
  await new Promise((r) => setTimeout(r, 20));
  const serving = await mkVersion(rentable, '1.1.0', { servable: true, gated: true });

  // ── acquire the rental through the real route ───────────────────────────────────────────────
  const rented = await call('POST', `/listings/${rentable}/rent`, {});
  assert.equal(rented.status, 200, `rent answered ${rented.status} ${JSON.stringify(rented.body).slice(0, 160)}`);
  const entitlementId = (await pool.query("SELECT id FROM marketplace_entitlements WHERE user_id=$1 AND listing_id=$2 AND kind='rental'", [renter, rentable])).rows[0].id;

  // ── 1. a binding pins the serving version ───────────────────────────────────────────────────
  const personal = await call('POST', `/listings/${rentable}/rental/bind`, {});
  assert.equal(personal.status, 200);
  assert.equal(personal.body.binding.servingVersionId, serving, 'only a hosted serving version can be rented: the binding pins it');
  assert.notEqual(personal.body.binding.servingVersionId, privateArtifact);
  const noServing = await mkListing('noserve', { personal: true, workspace: false, maxWorkspaces: 0 });
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',1,'week')`, [noServing]);
  await mkVersion(noServing, '1.0.0', { servable: false, gated: true });
  assert.equal((await call('POST', `/listings/${noServing}/rent`, {})).status, 200);
  const noServingBind = await call('POST', `/listings/${noServing}/rental/bind`, {});
  assert.equal(noServingBind.body.error, 'no_serving_version', 'only a hosted serving version can be rented');

  // ── 2. a rental never unlocks the private artifact ──────────────────────────────────────────
  for (const v of [privateArtifact, serving]) {
    const dl = await call('GET', `/download/${v}`);
    assert.equal(dl.status, 403, 'a rental never unlocks the private artifact');
    assert.equal(dl.body.error, 'rental_not_downloadable');
  }

  // ── 3. the licence decides where a rental may run ───────────────────────────────────────────
  const inA = await call('POST', `/listings/${rentable}/rental/bind`, { workspaceId: wsA });
  assert.equal(inA.status, 200);
  assert.deepEqual(inA.body.binding.target, { kind: 'workspace', workspaceId: wsA });
  const again = await call('POST', `/listings/${rentable}/rental/bind`, { workspaceId: wsA });
  assert.equal(again.body.binding.id, inA.body.binding.id, 'binding the same target twice is the same binding');
  const inB = await call('POST', `/listings/${rentable}/rental/bind`, { workspaceId: wsB });
  assert.equal(inB.body.error, 'license_workspace_limit', "the licence's workspace limit is enforced (1 at once)");
  const outside = await call('POST', `/listings/${rentable}/rental/bind`, { workspaceId: wsOther });
  assert.equal(outside.body.error, 'not_a_member', 'a rental binds only to a workspace the renter belongs to');
  const personalOnly = await mkListing('personal', { personal: true, workspace: false, maxWorkspaces: 0 });
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',1,'week')`, [personalOnly]);
  await mkVersion(personalOnly, '1.0.0', { servable: true, gated: false });
  assert.equal((await call('POST', `/listings/${personalOnly}/rent`, {})).status, 200);
  const personalOnlyWs = await call('POST', `/listings/${personalOnly}/rental/bind`, { workspaceId: wsA });
  assert.equal(personalOnlyWs.body.error, 'license_forbids_workspace', 'a licence without workspace use refuses a workspace binding');

  // ── dispatch under a binding: pinned to the serving version ─────────────────────────────────
  // The seller publishes a NEWER, non-servable version after the binding was made. The binding is pinned,
  // so a rental must keep running 1.1.0 -- running "the newest version" would run 2.0.0 instead.
  await new Promise((r) => setTimeout(r, 20));
  await mkVersion(rentable, '2.0.0', { servable: false, gated: true });
  const unbound = await call('POST', `/invoke/${rentable}`, { prompt: 'no binding named' });
  assert.equal(unbound.body.error, 'binding_required', 'a rental is invoked through a binding');
  const ran = await call('POST', `/invoke/${rentable}`, { prompt: 'work in workspace A', bindingId: inA.body.binding.id });
  assert.ok([200, 202].includes(ran.status), `invoke under a binding answered ${ran.status} ${JSON.stringify(ran.body).slice(0, 160)}`);
  assert.equal(ran.body.invocation.access, 'rental');
  assert.equal(ran.body.invocation.bindingId, inA.body.binding.id);
  assert.equal(ran.body.invocation.servingVersionId, serving, 'the run is pinned to the serving version');
  assert.match(runsCreated.at(-1).body.agent.description, /v1\.1\.0/, 'the hosted run was asked for the serving version');

  // ── 4a. a revoked binding refuses new dispatch; others are untouched ────────────────────────
  const revokedB = await call('POST', `/rental-bindings/${inA.body.binding.id}/revoke`, { reason: 'moved to another team' });
  assert.equal(revokedB.body.binding.state, 'revoked');
  const afterBindingRevoke = await call('POST', `/invoke/${rentable}`, { prompt: 'again', bindingId: inA.body.binding.id });
  assert.equal(afterBindingRevoke.body.error, 'binding_revoked', 'a revoked binding refuses new dispatch');
  const retryAfterRevoke = await call('POST', `/invoke/${rentable}`, { invocationId: ran.body.invocation.id });
  assert.equal(retryAfterRevoke.body.error, 'binding_revoked', 'a retry of an earlier invocation is refused the same way');
  const stillPersonal = await call('POST', `/invoke/${rentable}`, { prompt: 'personal', bindingId: personal.body.binding.id });
  assert.ok([200, 202].includes(stillPersonal.status), 'revoking one binding leaves the others working');

  // ── 4b. an expired rental refuses new dispatch ──────────────────────────────────────────────
  await pool.query("UPDATE marketplace_entitlements SET expires_at = now() - interval '1 second' WHERE id = $1", [entitlementId]);
  const afterExpiry = await call('POST', `/invoke/${rentable}`, { prompt: 'after expiry', bindingId: personal.body.binding.id });
  assert.equal(afterExpiry.body.error, 'rental_expired', 'an expired rental refuses new dispatch');
  const bindAfterExpiry = await call('POST', `/listings/${rentable}/rental/bind`, { workspaceId: wsB });
  assert.equal(bindAfterExpiry.body.error, 'rental_expired', 'and cannot be bound anywhere new');
  await pool.query("UPDATE marketplace_entitlements SET expires_at = now() + interval '7 days' WHERE id = $1", [entitlementId]);

  // ── 4c + 5. revoking the rental revokes its bindings; consumed work stays accountable ───────
  const runsBefore = runsCreated.length;
  await revokeRentalEntitlement(pool, { entitlementId, reason: 'seller withdrew the serving version' });
  const bindings = (await pool.query('SELECT state, revoked_reason FROM marketplace_rental_bindings WHERE entitlement_id=$1', [entitlementId])).rows;
  assert.ok(bindings.length >= 2 && bindings.every((b) => b.state === 'revoked'), 'revoking a rental revokes its bindings');
  const afterRevoke = await call('POST', `/invoke/${rentable}`, { prompt: 'after revoke', bindingId: personal.body.binding.id });
  assert.ok(['binding_revoked', 'rental_revoked'].includes(afterRevoke.body.error), `a revoked rental refuses new dispatch (${afterRevoke.body.error})`);
  assert.equal(runsCreated.length, runsBefore, 'no run was created after the rental ended');
  const kept = (await pool.query(
    `SELECT access, binding_id, serving_version_id FROM marketplace_invocations WHERE user_id=$1 AND listing_id=$2`, [renter, rentable])).rows;
  assert.ok(kept.length >= 2 && kept.every((i) => i.access === 'rental' && i.binding_id && i.serving_version_id === serving),
    'consumed work remains accountable: every invocation keeps its binding and serving version');
  await assert.rejects(pool.query(`INSERT INTO marketplace_invocations (user_id, listing_id, access, prompt) VALUES ($1,$2,'rental','x')`, [renter, rentable]),
    /marketplace_invocations_rental_bound/, 'the table refuses a rental invocation with no binding');
});

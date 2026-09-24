/**
 * XENO-WORKFORCE-01 MKT-07 / MKT-08 / MKT-09 -- rental memory is partitioned, renter-owned, and never
 * reaches the seller except by the renter's explicit disclosure. This is the spec's T23-T25 "sentinel
 * isolation" check: distinctive strings are planted in the seller's private material and in each
 * renter's work, and every boundary is asserted by looking for them where they must not be.
 *
 * Driven through the REAL marketplace routes on PostgreSQL. xeno-agents-api is a recording stand-in that
 * captures the EXACT prompt each run receives (the context the platform assembled) and replays an
 * outcome; the question here is what the platform puts into and takes out of a rental, not how a model
 * runs it. MKT-06 (marketplace-broker.test.mjs) proves the hosted run itself.
 *
 * Sentinels:
 *   SELLER_PRIVATE -- in the artifact key and the manifest: must NEVER appear in any rental context
 *   SELLER_SERVING -- in the reviewed serving material: must appear in every rental context
 *   UNREVIEWED     -- serving material that was never reviewed: must never appear
 *   WS_A / WS_B    -- each workspace's own work under ONE entitlement: must never appear in the other's
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - context load reads the manifest                    -> "MKT-07: seller-private material is physically excluded"
 *   - context load ignores the review gate               -> "MKT-07: unreviewed serving material is excluded"
 *   - one partition per entitlement (target ignored)     -> "MKT-07: one entitlement never merges two workspaces"
 *   - outcomes are recorded into every partition         -> "MKT-08: learning stays in its own partition"
 *   - the seller may read partitions without disclosure   -> "MKT-08: the seller sees nothing without a disclosure"
 *   - disclosure snapshots the live partition             -> "MKT-08: a disclosure is exactly the chosen items"
 *   - disclosure reads are not audited                    -> "MKT-08: every seller read is audited"
 *   - export includes the serving material                -> "MKT-09: export is the renter's content only"
 *   - deletion ignores retention                          -> "MKT-09: deletion respects retention"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/marketplace-rental-partitions.test.mjs
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

const SELLER_PRIVATE = 'SENTINEL-SELLER-PRIVATE-7f3a';
const SELLER_SERVING = 'SENTINEL-SELLER-SERVING-2b9c';
const UNREVIEWED = 'SENTINEL-UNREVIEWED-5d1e';
const WS_A = 'SENTINEL-WORKSPACE-A-9e44';
const WS_B = 'SENTINEL-WORKSPACE-B-1c07';

test('rental memory is partitioned, renter-owned and disclosed only by the renter (MKT-07, MKT-08, MKT-09)', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required');
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  // Stand-in xeno-agents-api: records each run's prompt; each run "completes" echoing a marker from it.
  const runs = [];
  const agents = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST' && req.url === '/runs') {
        const key = req.headers['idempotency-key'];
        let run = runs.find((r) => r.key === key);
        if (!run) { run = { key, runId: `run_${runs.length + 1}`, prompt: JSON.parse(body).prompt }; runs.push(run); }
        return res.end(JSON.stringify({ run: { runId: run.runId, status: 'queued' } }));
      }
      const ev = /^\/runs\/([^/]+)\/events/.exec(req.url);
      if (ev) {
        const run = runs.find((r) => r.runId === ev[1]);
        const marker = (run?.prompt.match(/## Request\n([\s\S]*)$/) || [])[1] || '';
        return res.end(JSON.stringify({ events: [{ type: 'turn.completed', outputPreview: `done: ${marker}` }] }));
      }
      const m = /^\/runs\/(.+)$/.exec(req.url);
      return res.end(JSON.stringify({ run: { runId: m?.[1], status: 'completed', creditsSettled: 1 } }));
    });
  });
  await new Promise((r) => agents.listen(0, '127.0.0.1', r));
  process.env.AGENTS_API_BASE_URL = `http://127.0.0.1:${agents.address().port}`;

  const { default: marketplaceRoutes } = await import('../routes/marketplaceRoutes.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.close(); agents.close(); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/marketplace`;
  const jwt = (await import('jsonwebtoken')).default;

  const marker = `part-${Date.now()}`;
  const mkUser = async (name) => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [name, `${name}@example.test`])).rows[0].id;
  const renter = await mkUser(marker), seller = await mkUser(`${marker}-s`);
  await optInUsageCredits(pool, renter);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'internal','active') ON CONFLICT (user_id) DO NOTHING", [renter]);
  await addGrant(pool, renter, { amountMicro: 500 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${marker}-grant` });
  const as = (userId) => {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    return async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };
  const renterCall = as(renter), sellerCall = as(seller);
  const mkWorkspace = async () => {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO workspaces (id, name, slug, owner_user_id) VALUES ($1,$2,$2,$3)', [id, `${marker}-${id.slice(0, 8)}`, seller]);
    await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('workspace',$1,'member','user',$2)`, [id, renter]);
    return id;
  };
  const wsA = await mkWorkspace(), wsB = await mkWorkspace();

  const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [seller, `${marker}-dev`])).rows[0].id;
  const listing = (await pool.query(
    `INSERT INTO marketplace_listings(slug,kind,developer_id,title,status,rental_license)
     VALUES($1,'mind',$2,$1,'published','{"schemaVersion":1,"personal":true,"workspace":true,"maxWorkspaces":2}'::jsonb) RETURNING id`,
    [`${marker}-mind`, dev])).rows[0].id;
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',10,'week')`, [listing]);
  const version = (await pool.query(
    `INSERT INTO marketplace_listing_versions
       (listing_id, version, artifact_r2_key, manifest, servable, published_at, serving_material, serving_material_reviewed_at, serving_material_reviewed_by)
     VALUES ($1, '1.0.0', $2, $3::jsonb, true, now(), $4, now(), $5) RETURNING id`,
    [listing, `private/${SELLER_PRIVATE}.xanima`, JSON.stringify({ privateMemory: SELLER_PRIVATE }),
     `You are a careful reviewer. ${SELLER_SERVING}`, seller])).rows[0].id;
  assert.equal((await renterCall('POST', `/listings/${listing}/rent`, {})).status, 200);

  const bindA = (await renterCall('POST', `/listings/${listing}/rental/bind`, { workspaceId: wsA })).body.binding;
  const bindB = (await renterCall('POST', `/listings/${listing}/rental/bind`, { workspaceId: wsB })).body.binding;
  const invoke = async (binding, text) => {
    const r = await renterCall('POST', `/invoke/${listing}`, { prompt: text, bindingId: binding.id });
    assert.ok([200, 202].includes(r.status), `invoke answered ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    await renterCall('GET', `/invocations/${r.body.invocation.id}`);   // completes it and records the outcome
    return runs.at(-1).prompt;
  };

  // ── MKT-07: context load ────────────────────────────────────────────────────────────────────
  assert.notEqual(bindA.partitionId, bindB.partitionId, 'MKT-07: one entitlement never merges two workspaces');
  const firstA = await invoke(bindA, `plan the migration ${WS_A}`);
  assert.ok(firstA.includes(SELLER_SERVING), 'rental context includes the reviewed serving material');
  assert.ok(!firstA.includes(SELLER_PRIVATE), 'MKT-07: seller-private material is physically excluded');
  const firstB = await invoke(bindB, `audit the ledger ${WS_B}`);
  const secondA = await invoke(bindA, 'continue where we left off');
  assert.ok(secondA.includes(WS_A), "a partition's own earlier work is in its context");
  assert.ok(!secondA.includes(WS_B) && !firstB.includes(WS_A), 'MKT-07: one entitlement never merges two workspaces');

  await pool.query(`UPDATE marketplace_listing_versions SET serving_material = $2, serving_material_reviewed_at = NULL WHERE id = $1`,
    [version, `Revised, not yet reviewed. ${UNREVIEWED}`]);
  const afterUnreview = await invoke(bindB, 'one more pass');
  assert.ok(!afterUnreview.includes(UNREVIEWED) && !afterUnreview.includes(SELLER_SERVING), 'MKT-07: unreviewed serving material is excluded');

  // ── MKT-08: learning stays local; the seller sees nothing without a disclosure ──────────────
  const memA = (await pool.query('SELECT content FROM marketplace_rental_memory WHERE partition_id = $1', [bindA.partitionId])).rows.map((r) => r.content).join('\n');
  const memB = (await pool.query('SELECT content FROM marketplace_rental_memory WHERE partition_id = $1', [bindB.partitionId])).rows.map((r) => r.content).join('\n');
  assert.ok(memA.includes(WS_A) && !memA.includes(WS_B) && memB.includes(WS_B) && !memB.includes(WS_A),
    'MKT-08: learning stays in its own partition');
  const before = await sellerCall('GET', `/developer/listings/${listing}/rental-disclosures`);
  assert.equal(before.status, 200);
  assert.equal(JSON.stringify(before.body).includes(WS_A) || JSON.stringify(before.body).includes(WS_B), false,
    'MKT-08: the seller sees nothing without a disclosure');
  assert.equal((await sellerCall('GET', `/rental-partitions/${bindA.partitionId}/export`)).status, 404,
    "MKT-08: the seller cannot read the renter's partition directly");

  // An item that exists BEFORE the disclosure but is not chosen: a snapshot of the whole partition would
  // carry it, a snapshot of the chosen items must not.
  await pool.query("INSERT INTO marketplace_rental_memory (partition_id, kind, content) VALUES ($1, 'note', 'unchosen private note SENTINEL-UNCHOSEN-3f3f')", [bindA.partitionId]);
  const itemsA = (await pool.query('SELECT id, content FROM marketplace_rental_memory WHERE partition_id = $1 ORDER BY created_at', [bindA.partitionId])).rows;
  const chosen = itemsA.find((i) => i.content.includes(WS_A));
  assert.equal((await renterCall('POST', `/rental-partitions/${bindA.partitionId}/disclosures`, { itemIds: [chosen.id] })).body.error,
    'reason_required', 'a disclosure needs the renter to say why');
  const disclosed = await renterCall('POST', `/rental-partitions/${bindA.partitionId}/disclosures`, { itemIds: [chosen.id], reason: 'help improve the planner' });
  assert.equal(disclosed.status, 200);
  await pool.query("INSERT INTO marketplace_rental_memory (partition_id, kind, content) VALUES ($1, 'note', 'later private note SENTINEL-LATER-8a8a')", [bindA.partitionId]);
  const seen = await sellerCall('GET', `/developer/listings/${listing}/rental-disclosures`);
  const seenText = JSON.stringify(seen.body);
  assert.ok(seenText.includes(WS_A) && !seenText.includes('SENTINEL-UNCHOSEN-3f3f')
    && !seenText.includes('SENTINEL-LATER-8a8a') && !seenText.includes(WS_B),
    'MKT-08: a disclosure is exactly the chosen items');
  const audits = Number((await pool.query('SELECT count(*) FROM marketplace_rental_disclosure_access WHERE accessed_by = $1', [seller])).rows[0].count);
  assert.ok(audits >= 1, 'MKT-08: every seller read is audited');
  assert.equal((await as(renter)('GET', `/developer/listings/${listing}/rental-disclosures`)).status, 403, 'only the seller reads disclosures');

  // ── MKT-09: export and deletion ─────────────────────────────────────────────────────────────
  const exported = await renterCall('GET', `/rental-partitions/${bindA.partitionId}/export`);
  const exportText = JSON.stringify(exported.body);
  assert.ok(exported.status === 200 && exportText.includes(WS_A), 'the renter exports their content');
  assert.ok(!exportText.includes(SELLER_SERVING) && !exportText.includes(UNREVIEWED)
    && !exportText.includes(SELLER_PRIVATE) && !exportText.includes(WS_B),
    "MKT-09: export is the renter's content only");
  const heldItem = itemsA[0].id;
  await pool.query(`UPDATE marketplace_rental_memory SET retain_until = now() + interval '30 days', retain_reason = 'dispute #41' WHERE id = $1`, [heldItem]);
  const deleted = await renterCall('DELETE', `/rental-partitions/${bindA.partitionId}/content`);
  assert.equal(deleted.status, 200);
  assert.ok(deleted.body.deleted >= 1, 'the renter deletes their content');
  assert.deepEqual(deleted.body.retained.map((r) => r.id), [heldItem], 'MKT-09: deletion respects retention');
  assert.equal(deleted.body.retained[0].reason, 'dispute #41', 'and says why it kept it');
  assert.equal(deleted.body.priorExportsRecalled, false, 'MKT-09: revocation does not claim to recall an export');
  assert.equal(Number((await pool.query('SELECT count(*) FROM marketplace_rental_exports WHERE partition_id = $1', [bindA.partitionId])).rows[0].count), 1,
    'the export is recorded and survives deletion');
  const leftB = (await pool.query('SELECT count(*) FROM marketplace_rental_memory WHERE partition_id = $1', [bindB.partitionId])).rows[0].count;
  assert.ok(Number(leftB) >= 1, "deleting one partition's content leaves the other untouched");
});

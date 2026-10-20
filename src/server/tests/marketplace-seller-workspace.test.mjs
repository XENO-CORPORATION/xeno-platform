/**
 * D-6 (XENO-WORKFORCE-01 §8.11.1, DECIDED 2026-10-20): the Marketplace seller is a WORKSPACE with an accountable
 * human per listing. Real Postgres. Proves, on a migrated copy:
 *   - the backfill: rows that existed BEFORE the migration get their seller workspace (DOWN, seed, UP);
 *   - every insert path fills it (developer, listing, payout), through the real register route too;
 *   - the seller survives the accountable person (OWN-05 keys on the workspace);
 *   - DOWN removes it exactly and UP restores it.
 *
 * Run: DATABASE_URL=postgresql://… node tests/marketplace-seller-workspace.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import marketplaceRoutes from '../routes/marketplaceRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UP, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261020100000-marketplace-seller-workspace.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const tag = `msw${process.pid}`;
const cols = async () => (await pool.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
  WHERE table_schema = current_schema() AND column_name IN ('seller_workspace_id','accountable_user_id') ORDER BY 1`)).rows.map((r) => r.c);

async function main() {
  await runAllMigrations(pool);
  const after = await cols();
  assert.deepEqual(after, ['marketplace_developers.seller_workspace_id', 'marketplace_listings.accountable_user_id', 'marketplace_listings.seller_workspace_id', 'marketplace_payouts.seller_workspace_id']);

  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`])).rows[0].id;

  // ── DOWN, seed rows the way they existed before, UP: the backfill ──
  await pool.query(DOWN);
  assert.deepEqual(await cols(), [], 'DOWN removes every column');
  const old = await user('old'); const oldWs = (await ensurePersonalWorkspace(pool, old)).id;
  const oldDev = (await pool.query(`INSERT INTO marketplace_developers (user_id, display_name, slug) VALUES ($1, 'Old', $2) RETURNING id`, [old, `${tag}-old`])).rows[0].id;
  const oldListing = (await pool.query(`INSERT INTO marketplace_listings (slug, kind, developer_id, title) VALUES ($1, 'mcp', $2, 'Old listing') RETURNING id`, [`${tag}-old-l`, oldDev])).rows[0].id;
  const oldPayout = (await pool.query(`INSERT INTO marketplace_payouts (developer_id, amount_credits) VALUES ($1, 10) RETURNING id`, [oldDev])).rows[0].id;
  await pool.query(UP.replace(/^-- UP\s*$/m, ''));
  assert.deepEqual(await cols(), after, 'UP restores every column');
  assert.equal((await pool.query('SELECT seller_workspace_id FROM marketplace_developers WHERE id = $1', [oldDev])).rows[0].seller_workspace_id, oldWs, 'backfill: a developer sells as its person\'s personal workspace');
  const l = (await pool.query('SELECT seller_workspace_id, accountable_user_id FROM marketplace_listings WHERE id = $1', [oldListing])).rows[0];
  assert.deepEqual([l.seller_workspace_id, l.accountable_user_id], [oldWs, old], 'backfill: a listing takes its developer\'s seller and names the accountable human');
  assert.equal((await pool.query('SELECT seller_workspace_id FROM marketplace_payouts WHERE id = $1', [oldPayout])).rows[0].seller_workspace_id, oldWs, 'backfill: a payout belongs to the seller workspace');

  // ── every insert path fills it: the real register route, then a listing and a payout written without the column ──
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const fresh = await user('fresh');
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/marketplace/developer/register`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: fresh, email: 'f@xeno.test', username: 'f' }, JWT_SECRET, { expiresIn: '1h' })}` }, body: JSON.stringify({ displayName: 'Fresh Seller', slug: `${tag}-fresh` }) });
    assert.equal(r.status, 201);
    const dev = (await r.json()).developer;
    const freshWs = (await ensurePersonalWorkspace(pool, fresh)).id;
    assert.equal(dev.seller_workspace_id, freshWs, 'registering makes the person\'s workspace the seller');
    const listing = (await pool.query(`INSERT INTO marketplace_listings (slug, kind, developer_id, title) VALUES ($1, 'mcp', $2, 'New') RETURNING seller_workspace_id, accountable_user_id`, [`${tag}-new-l`, dev.id])).rows[0];
    assert.deepEqual([listing.seller_workspace_id, listing.accountable_user_id], [freshWs, fresh], 'a listing insert that names no seller gets one');
    const payout = (await pool.query('INSERT INTO marketplace_payouts (developer_id, amount_credits) VALUES ($1, 5) RETURNING seller_workspace_id', [dev.id])).rows[0];
    assert.equal(payout.seller_workspace_id, freshWs, 'a payout insert gets the seller workspace');
    // OWN-05: the accountable human goes, the seller does not
    await pool.query('UPDATE marketplace_listings SET accountable_user_id = NULL WHERE slug = $1', [`${tag}-new-l`]);
    assert.equal((await pool.query('SELECT seller_workspace_id FROM marketplace_listings WHERE slug = $1', [`${tag}-new-l`])).rows[0].seller_workspace_id, freshWs, 'the seller of record is the workspace, independent of the person');
  } finally { server.close(); }
  console.log('marketplace-seller-workspace: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });

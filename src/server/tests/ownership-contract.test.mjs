/**
 * D-1/D-6 CONTRACT step (migration 20261020140000). Real Postgres, a production-shaped seed written in the
 * expand-step shape (DOWN first): people with and without a personal workspace holding legacy workspace-less files,
 * agents' files, a team workspace's files, 34 first-party listings, third-party developers / listings / payouts.
 * Proves:
 *   - the dry run (scripts/ownership-contract-dryrun.mjs) predicts exactly what UP does;
 *   - UP moves every legacy file to its person's personal workspace (an agent's to its human's), creates the missing
 *     personal workspaces, fills sellers, keeps first-party listings NULL, and is idempotent;
 *   - after UP: a legacy writer's file is filled by the trigger; a third-party listing without a seller is refused;
 *     the storage meter counts personal files through the personal workspace;
 *   - DOWN restores the expand-step state EXACTLY (byte-for-byte snapshot);
 *   - UP REFUSES, naming counts, when a file has no person behind it (a service principal's).
 *
 * Run: DATABASE_URL=postgresql://… node tests/ownership-contract.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import { storageUsage } from '../services/storageAllowance.js';
import { dryRun } from '../../../scripts/ownership-contract-dryrun.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261020140000-ownership-contract.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `oc${process.pid}`;
let seq = 0;

const snapshot = async () => JSON.stringify({
  files: (await pool.query('SELECT id, workspace_id FROM user_files ORDER BY id')).rows,
  ws: (await pool.query('SELECT id, owner_user_id, workspace_type FROM workspaces ORDER BY id')).rows,
  tuples: Number((await pool.query(`SELECT count(*) n FROM relationship_tuples WHERE object_type = 'workspace'`)).rows[0].n),
  dev: (await pool.query('SELECT id, seller_workspace_id FROM marketplace_developers ORDER BY id')).rows,
  list: (await pool.query('SELECT id, seller_workspace_id FROM marketplace_listings ORDER BY id')).rows,
  pay: (await pool.query('SELECT id, seller_workspace_id FROM marketplace_payouts ORDER BY id')).rows,
  notNull: (await pool.query(`SELECT table_name || '.' || column_name || '=' || is_nullable AS c FROM information_schema.columns
     WHERE table_schema = current_schema() AND ((table_name = 'user_files' AND column_name = 'workspace_id')
        OR (table_name IN ('marketplace_developers','marketplace_payouts','marketplace_listings') AND column_name = 'seller_workspace_id')) ORDER BY 1`)).rows,
});

async function main() {
  await runAllMigrations(pool);
  await pool.query(DOWN);

  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, role) VALUES ($1, $2, $1, true, true, 'x', $3) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, role])).rows[0].id;
  const file = (owner, ws = null, size = 100) => pool.query(
    `INSERT INTO user_files (user_id, owner_user_id, created_by_user_id, workspace_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, metadata)
     VALUES ($1, CASE WHEN $2::uuid IS NULL THEN $1::uuid END, $1, $2, $3, $3, 'text/plain', 'text/plain', $4, '/nowhere', 'platform-upload', '{}') RETURNING id`, [owner, ws, `f${seq += 1}.txt`, size]).then((r) => r.rows[0].id);

  // ── production-shaped seed, expand-step shape ──
  const withWs = []; for (let i = 0; i < 30; i++) { const u = await user(`w${i}`); await ensurePersonalWorkspace(pool, u); withWs.push(u); }
  const noWs = []; for (let i = 0; i < 10; i++) noWs.push(await user(`n${i}`));
  for (const u of [...withWs, ...noWs]) for (let k = 0; k < 3; k++) await file(u);
  const agents = [];
  for (let i = 0; i < 5; i++) { const a = await user(`a${i}`); await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1, $2)', [a, noWs[i]]); agents.push(a); await file(a); }
  await user('svc', 'service'); // a service principal with nothing to own: must not block
  const team = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'OC Co', $2) RETURNING id`, [withWs[0], `${tag}-co`])).rows[0].id;
  for (let k = 0; k < 4; k++) await file(withWs[0], team);
  for (let i = 0; i < 34; i++) await pool.query(`INSERT INTO marketplace_listings (slug, kind, title) VALUES ($1, 'mcp', 'XENO first-party') `, [`${tag}-fp-${i}`]);
  const devs = [];
  for (const [i, u] of [withWs[1], noWs[5], noWs[6]].entries()) {
    const d = (await pool.query(`INSERT INTO marketplace_developers (user_id, display_name, slug) VALUES ($1, 'Dev', $2) RETURNING id, seller_workspace_id`, [u, `${tag}-dev-${i}`])).rows[0];
    devs.push(d);
    await pool.query(`INSERT INTO marketplace_listings (slug, kind, developer_id, title) VALUES ($1, 'mcp', $2, 'Third party')`, [`${tag}-tp-${i}`, d.id]);
    await pool.query('INSERT INTO marketplace_payouts (developer_id, amount_credits) VALUES ($1, 10)', [d.id]);
  }
  assert.ok(devs[0].seller_workspace_id && !devs[1].seller_workspace_id, 'seed: a developer without a personal workspace has no seller in the expand shape');
  const before = await snapshot();

  // ── dry run predicts UP ──
  const plan = await dryRun(pool);
  console.log('dry run (production-shaped seed):', JSON.stringify(plan));
  assert.equal(plan.userFiles.refused + plan.developers.refused + plan.listings.refused + plan.payouts.refused, 0);
  assert.equal(plan.personalWorkspacesToCreate, 10, '10 people hold rows and have no personal workspace');
  assert.equal(plan.listings.firstPartyKeptNull, 34);
  const nullFiles = Number((await pool.query('SELECT count(*) n FROM user_files WHERE workspace_id IS NULL')).rows[0].n);
  assert.equal(plan.userFiles.toMove, nullFiles);

  // ── UP ──
  await pool.query(UP);
  const rec = Object.fromEntries((await pool.query('SELECT kind, count(*)::int n FROM ownership_contract_backfill GROUP BY kind')).rows.map((r) => [r.kind, r.n]));
  assert.equal(rec.user_file, plan.userFiles.toMove, 'every predicted file moved');
  assert.equal(rec.workspace, plan.personalWorkspacesToCreate, 'every predicted personal workspace created');
  assert.equal(rec.developer, plan.developers.toFill);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM user_files WHERE workspace_id IS NULL')).rows[0].n), 0);
  const agentFile = (await pool.query('SELECT f.workspace_id, w.owner_user_id, w.workspace_type FROM user_files f JOIN workspaces w ON w.id = f.workspace_id WHERE f.user_id = $1', [agents[0]])).rows[0];
  assert.deepEqual([agentFile.owner_user_id, agentFile.workspace_type], [noWs[0], 'personal'], 'an agent\'s file belongs to its human\'s personal workspace');
  assert.equal(Number((await pool.query('SELECT count(*) n FROM user_files WHERE workspace_id = $1', [team])).rows[0].n), 4, 'team files untouched');
  assert.equal(Number((await pool.query('SELECT count(*) n FROM marketplace_listings WHERE developer_id IS NULL AND seller_workspace_id IS NULL')).rows[0].n), 34, 'first-party listings stay NULL = XENO');
  const created = (await pool.query(`SELECT 1 FROM relationship_tuples WHERE object_type = 'workspace' AND relation = 'owner' AND subject_id = $1`, [String(noWs[3])])).rows.length;
  assert.equal(created, 1, 'a created personal workspace has its owner tuple');
  const midState = await snapshot();
  await pool.query(UP);
  assert.equal(await snapshot(), midState, 'UP is idempotent');

  // ── after UP ──
  const later = await user('later');
  const legacy = await file(later);
  const lw = (await pool.query('SELECT w.owner_user_id, w.workspace_type FROM user_files f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = $1', [legacy])).rows[0];
  assert.deepEqual([lw.owner_user_id, lw.workspace_type], [later, 'personal'], 'a legacy writer that names no workspace gets its person\'s personal workspace');
  await assert.rejects(pool.query('UPDATE user_files SET workspace_id = $1 WHERE id = $2', [team, legacy]), /personal file \(owner set\) belongs/, 'the scope rule holds: a personal file cannot sit in a shared workspace');
  await assert.rejects(pool.query(`INSERT INTO marketplace_listings (slug, kind, developer_id, seller_workspace_id, title) VALUES ($1, 'mcp', $2, NULL, 'x')`, [`${tag}-bad`, devs[0].id]).then(() => pool.query(`UPDATE marketplace_listings SET seller_workspace_id = NULL WHERE slug = $1`, [`${tag}-bad`])), /marketplace_listings_seller_named/, 'a third-party listing cannot lose its seller');
  await assert.rejects(file(await user('svc2', 'service')), /null value in column "workspace_id"/, 'a service principal has no personal scope: its file is refused');
  const usage = await storageUsage(pool, withWs[2]);
  assert.equal(usage.usedBytes, 300, 'the meter counts the person\'s files through their personal workspace');
  await pool.query('DELETE FROM marketplace_listings WHERE slug = $1', [`${tag}-bad`]);
  await pool.query('DELETE FROM user_files WHERE id = $1', [legacy]);
  await pool.query('DELETE FROM workspaces WHERE owner_user_id = $1', [later]).catch(() => {});

  // ── DOWN restores exactly ──
  await pool.query(DOWN);
  await pool.query(`DELETE FROM relationship_tuples WHERE object_type = 'workspace' AND subject_id = $1`, [String(later)]);
  await pool.query('DELETE FROM workspace_audit WHERE actor_user_id = $1', [later]).catch(() => {});
  await pool.query('DELETE FROM workspaces WHERE owner_user_id = $1', [later]);
  const after = JSON.parse(await snapshot()), was = JSON.parse(before);
  for (const k of Object.keys(was)) assert.deepEqual(after[k], was[k], `DOWN restores ${k} exactly`);

  // ── UP refuses a row with no person ──
  const svc = await user('svc3', 'service');
  const orphan = await file(svc);
  await assert.rejects(pool.query(UP), /ownership contract refused: 1 file\(s\)/, 'UP names what it refuses');
  const plan2 = await dryRun(pool);
  assert.equal(plan2.userFiles.refused, 1, 'the dry run predicts the refusal');
  await pool.query('DELETE FROM user_files WHERE id = $1', [orphan]);
  await pool.query(UP);
  console.log('ownership-contract: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });

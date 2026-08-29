/**
 * Database Migration Runner
 *
 * Proper up/down migration pattern with version tracking.
 * Migrations are tracked in a `schema_migrations` table so each
 * migration runs exactly once, in order.
 *
 * Usage:
 *   import { runAllMigrations } from './services/migrationRunner.js';
 *   await runAllMigrations(pool);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '../database/migrations');

// --------------------------------------------------------------------------
// Ensure the tracking table exists
// --------------------------------------------------------------------------
async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id            SERIAL PRIMARY KEY,
      version       VARCHAR(255) NOT NULL UNIQUE,
      name          VARCHAR(255) NOT NULL,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum      VARCHAR(64)
    );
  `);
}

// --------------------------------------------------------------------------
// Get list of applied migration versions
// --------------------------------------------------------------------------
async function getAppliedVersions(pool) {
  const { rows } = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return new Set(rows.map(r => r.version));
}

// --------------------------------------------------------------------------
// Discover migration files on disk
// --------------------------------------------------------------------------
function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Lexicographic sort — use YYYYMMDDHHMMSS prefix

  return files.map(f => {
    const match = f.match(/^(\d{14})[-_](.+)\.sql$/);
    if (!match) return null;
    return {
      version: match[1],
      name: match[2],
      filename: f,
      filepath: path.join(MIGRATIONS_DIR, f),
      requirement: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
        .match(/^--\s*REQUIRES:\s*(.+)$/im)?.[1]?.trim() || null,
    };
  }).filter(Boolean);
}

async function requirementSatisfied(pool, requirement) {
  if (!requirement) return true;
  const pgvector = /^pgvector>=(\d+)\.(\d+)\.(\d+)$/.exec(requirement);
  if (!pgvector) throw new Error(`Unknown migration requirement: ${requirement}`);
  const { rows } = await pool.query(
    `SELECT default_version FROM pg_available_extensions WHERE name='vector'`,
  );
  const available = rows[0]?.default_version?.split('.').map(Number);
  if (!available || available.length < 3) return false;
  const required = pgvector.slice(1).map(Number);
  return available[0] > required[0]
    || (available[0] === required[0] && available[1] > required[1])
    || (available[0] === required[0] && available[1] === required[1] && available[2] >= required[2]);
}

// --------------------------------------------------------------------------
// Parse UP and DOWN sections from a migration file
// --------------------------------------------------------------------------
function parseMigration(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');

  // Split by -- DOWN marker
  const downMarker = /^--\s*DOWN\b/im;
  const parts = content.split(downMarker);

  let up = parts[0];
  let down = parts.length > 1 ? parts[1] : null;

  // Remove -- UP marker if present
  up = up.replace(/^--\s*UP\b.*$/im, '').trim();
  if (down) down = down.trim();

  return { up, down };
}

// --------------------------------------------------------------------------
// Run all pending migrations (UP)
// --------------------------------------------------------------------------
export async function runAllMigrations(pool) {
  await ensureMigrationsTable(pool);

  const applied = await getAppliedVersions(pool);
  const migrations = discoverMigrations();
  const pending = migrations.filter(m => !applied.has(m.version));

  if (pending.length === 0) {
    console.log('[Migrations] All migrations are up to date.');
    return { applied: 0, total: migrations.length };
  }

  console.log(`[Migrations] ${pending.length} pending migration(s) to apply...`);

  let appliedCount = 0;
  const skipped = [];
  for (const migration of pending) {
    if (!await requirementSatisfied(pool, migration.requirement)) {
      skipped.push({ version: migration.version, requirement: migration.requirement });
      console.warn(`[Migrations] Deferred: ${migration.version} requires ${migration.requirement}`);
      continue;
    }
    const { up } = parseMigration(migration.filepath);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(up);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      );
      await client.query('COMMIT');
      appliedCount++;
      console.log(`[Migrations] Applied: ${migration.version} — ${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[Migrations] FAILED: ${migration.version} — ${migration.name}`);
      console.error(`[Migrations] Error: ${error.message}`);
      throw error; // Stop on first failure
    } finally {
      client.release();
    }
  }

  console.log(`[Migrations] ${appliedCount} migration(s) applied successfully.`);
  return { applied: appliedCount, total: migrations.length, skipped };
}

// --------------------------------------------------------------------------
// Rollback the last N migrations (DOWN)
// --------------------------------------------------------------------------
export async function rollbackMigrations(pool, count = 1) {
  await ensureMigrationsTable(pool);

  const { rows } = await pool.query(
    'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT $1',
    [count]
  );

  if (rows.length === 0) {
    console.log('[Migrations] Nothing to rollback.');
    return { rolledBack: 0 };
  }

  const migrations = discoverMigrations();
  let rolledBack = 0;

  for (const row of rows) {
    const migration = migrations.find(m => m.version === row.version);
    if (!migration) {
      console.warn(`[Migrations] File not found for version ${row.version}, skipping rollback.`);
      continue;
    }

    const { down } = parseMigration(migration.filepath);
    if (!down) {
      console.warn(`[Migrations] No DOWN section in ${migration.filename}, skipping.`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(down);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [row.version]);
      await client.query('COMMIT');
      rolledBack++;
      console.log(`[Migrations] Rolled back: ${row.version} — ${row.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[Migrations] Rollback FAILED: ${row.version} — ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  return { rolledBack };
}

// --------------------------------------------------------------------------
// Show migration status
// --------------------------------------------------------------------------
export async function migrationStatus(pool) {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedVersions(pool);
  const migrations = discoverMigrations();

  return migrations.map(m => ({
    version: m.version,
    name: m.name,
    status: applied.has(m.version) ? 'applied' : 'pending',
  }));
}

export default { runAllMigrations, rollbackMigrations, migrationStatus };

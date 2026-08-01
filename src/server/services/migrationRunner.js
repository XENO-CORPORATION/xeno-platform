/**
 * Database Migration Runner
 *
 * Proper up/down migration pattern with version tracking.
 * Migrations are tracked in a `schema_migrations` table so each
 * migration runs exactly once, in order.
 *
 * Usage (library):
 *   import { runAllMigrations } from './services/migrationRunner.js';
 *   await runAllMigrations(pool);
 *
 * Usage (CLI — see the bottom of this file):
 *   npm run migrate            # apply all pending migrations (UP)
 *   npm run migrate:status     # list applied/pending + checksum state
 *   npm run migrate:down       # roll back the LAST migration (DOWN)
 *   npm run migrate:down -- 3  # roll back the last 3
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '../database/migrations');

// --------------------------------------------------------------------------
// Migration file checksum
// --------------------------------------------------------------------------
/**
 * SHA-256 of a migration file's contents, so a file edited AFTER it was applied
 * becomes detectable instead of silently diverging from what the database ran.
 *
 * Line endings are NORMALISED to LF before hashing. The repo is checked out with
 * CRLF on Windows dev boxes and LF on the Linux server; hashing raw bytes would
 * make the same migration hash differently per environment and report permanent
 * false drift.
 */
export function migrationChecksum(filepath) {
  const content = fs.readFileSync(filepath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

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
// Get applied migrations (version → recorded checksum, which may be NULL)
// --------------------------------------------------------------------------
async function getAppliedMap(pool) {
  const { rows } = await pool.query(
    'SELECT version, checksum FROM schema_migrations ORDER BY version'
  );
  return new Map(rows.map(r => [r.version, r.checksum]));
}

async function getAppliedVersions(pool) {
  return new Set((await getAppliedMap(pool)).keys());
}

/**
 * Compare every APPLIED migration's file against the checksum recorded when it ran.
 *
 * NULL checksum = "unknown, skip". Rows applied before checksums were recorded have
 * no baseline, and a NULL must never read as a mismatch or those migrations would
 * report drift (or, worse, be treated as un-applied) on every boot.
 *
 * Deliberately NOT backfilled: stamping today's file contents onto an old NULL row
 * would launder any edit that already happened into a "verified" state. A NULL stays
 * NULL — honestly unknown — until that migration is applied on a fresh database.
 *
 * Returns the drifted entries; it does not throw. This runs at server boot
 * (index.js), and refusing to start over a checksum change would turn a bookkeeping
 * signal into an outage. The drift is logged loudly and returned to the caller.
 */
export async function verifyChecksums(pool) {
  const applied = await getAppliedMap(pool);
  const migrations = discoverMigrations();
  const drifted = [];
  const unknown = [];

  for (const m of migrations) {
    if (!applied.has(m.version)) continue;          // pending — nothing to verify
    const recorded = applied.get(m.version);
    if (!recorded) { unknown.push(m.version); continue; } // NULL → unknown, skip
    const actual = migrationChecksum(m.filepath);
    if (actual !== recorded) {
      drifted.push({ version: m.version, name: m.name, recorded, actual });
    }
  }

  for (const d of drifted) {
    console.error(
      `[Migrations] CHECKSUM DRIFT: ${d.version} — ${d.name} was EDITED after it was applied `
      + `(recorded ${d.recorded.slice(0, 12)}…, file is now ${d.actual.slice(0, 12)}…). `
      + 'The database does NOT contain what this file now says; write a NEW migration instead.'
    );
  }

  return { drifted, unknownCount: unknown.length, checked: applied.size };
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
    };
  }).filter(Boolean);
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

  // Report (never fail on) migration files edited after they were applied.
  const { drifted } = await verifyChecksums(pool);

  if (pending.length === 0) {
    console.log('[Migrations] All migrations are up to date.');
    return { applied: 0, total: migrations.length, drifted };
  }

  console.log(`[Migrations] ${pending.length} pending migration(s) to apply...`);

  let appliedCount = 0;
  for (const migration of pending) {
    const { up } = parseMigration(migration.filepath);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(up);
      // Record the checksum IN THE SAME TRANSACTION as the DDL, so the stored hash
      // always describes exactly the file contents the database actually ran.
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migrationChecksum(migration.filepath)]
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
  return { applied: appliedCount, total: migrations.length, drifted };
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
  const applied = await getAppliedMap(pool);
  const migrations = discoverMigrations();

  return migrations.map(m => {
    const isApplied = applied.has(m.version);
    const recorded = isApplied ? applied.get(m.version) : null;
    // 'unknown' = applied before checksums were recorded (NULL) — not a mismatch.
    let checksum = 'n/a';
    if (isApplied) {
      if (!recorded) checksum = 'unknown';
      else checksum = migrationChecksum(m.filepath) === recorded ? 'ok' : 'DRIFTED';
    }
    return {
      version: m.version,
      name: m.name,
      status: isApplied ? 'applied' : 'pending',
      checksum,
    };
  });
}

export default { runAllMigrations, rollbackMigrations, migrationStatus, verifyChecksums, migrationChecksum };

// --------------------------------------------------------------------------
// CLI  (npm run migrate | migrate:status | migrate:down [n])
// --------------------------------------------------------------------------
// Wires up the rollback path, which previously existed as an exported function
// that nothing could invoke. Connection config mirrors the other standalone
// migration scripts (database/migrate-account-v2.js).
//
//   npm run migrate              apply every pending migration (UP)
//   npm run migrate:status       print applied/pending + checksum state
//   npm run migrate:down         roll back the LAST applied migration (DOWN)
//   npm run migrate:down -- 3    roll back the last 3
//
// `migrate:down` runs each migration's `-- DOWN` section and is DESTRUCTIVE — it
// drops whatever the UP section created. It always requires an explicit invocation
// and is never called from server boot.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { default: pg } = await import('pg');
  const command = process.argv[2] || 'up';
  const countArg = Number(process.argv[3]);

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    database: process.env.DB_NAME || process.env.POSTGRES_DB,
    user: process.env.DB_USER || process.env.POSTGRES_USER,
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  });

  try {
    if (command === 'up') {
      await runAllMigrations(pool);
    } else if (command === 'status') {
      const rows = await migrationStatus(pool);
      for (const r of rows) {
        console.log(`  ${r.status.padEnd(8)} ${r.checksum.padEnd(8)} ${r.version}  ${r.name}`);
      }
    } else if (command === 'down') {
      const count = Number.isFinite(countArg) && countArg > 0 ? countArg : 1;
      console.log(`[Migrations] Rolling back the last ${count} migration(s)…`);
      const r = await rollbackMigrations(pool, count);
      console.log(`[Migrations] Rolled back ${r.rolledBack}.`);
    } else {
      console.error(`Unknown command '${command}'. Use: up | status | down [count]`);
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`[Migrations] ${command} FAILED:`, err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

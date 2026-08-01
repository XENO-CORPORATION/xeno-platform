/**
 * migrationRunner test — checksum recording + the newly-wired rollback path.
 *
 * Two gaps this pins shut:
 *
 *  1. CHECKSUMS. `schema_migrations` declared a `checksum` column but the runner
 *     inserted only (version, name), so a migration file edited AFTER it was applied
 *     was undetectable — the database and the file could say different things forever.
 *     The delicate part is EXISTING rows, which have NULL checksums: NULL must read as
 *     "unknown, skip verification", never as a mismatch, or every already-applied
 *     migration would report drift (or re-run) on the next boot.
 *
 *  2. ROLLBACK. `rollbackMigrations` was exported and wired to nothing. It is now
 *     reachable via `npm run migrate:down`; this exercises the function itself.
 *
 * DESTRUCTIVE — runs real migrations, then rolls one back. Point it ONLY at a
 * throwaway database, NEVER at production.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55499/t node tests/migration-runner.test.mjs
 */
import pg from 'pg';
import {
  runAllMigrations, rollbackMigrations, migrationStatus, verifyChecksums, migrationChecksum,
} from '../services/migrationRunner.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const rows = async () => (await pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')).rows;

async function main() {
  // A migration run needs a pristine schema (the baseline creates everything).
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('✓ schema reset\n');

  // ── apply: every row gets a checksum, computed from the file it ran ─────────
  console.log('applying migrations');
  const first = await runAllMigrations(pool);
  ok(first.applied > 0, `applied ${first.applied} migration(s)`);
  ok(Array.isArray(first.drifted) && first.drifted.length === 0, 'no drift reported on a fresh apply');

  const applied = await rows();
  ok(applied.length === first.applied, `schema_migrations has ${applied.length} rows`);
  ok(applied.every(r => typeof r.checksum === 'string' && r.checksum.length === 64),
    'every applied row recorded a 64-char sha256 checksum');

  const status = await migrationStatus(pool);
  ok(status.length > 0 && status.every(s => s.status === 'applied'), 'status: all migrations applied');
  ok(status.every(s => s.checksum === 'ok'), 'status: every checksum verifies against its file');

  const verified = await verifyChecksums(pool);
  ok(verified.drifted.length === 0 && verified.unknownCount === 0, 'verifyChecksums: clean');

  // ── re-run is a no-op (the critical "must not re-run" property) ─────────────
  const second = await runAllMigrations(pool);
  ok(second.applied === 0, 'a second run applies nothing');
  ok((await rows()).length === applied.length, 'no duplicate schema_migrations rows');

  // ── NULL checksum = unknown, NOT a mismatch (the pre-existing-rows case) ────
  console.log('\nlegacy rows with NULL checksums');
  const victim = applied[0].version;
  await pool.query('UPDATE schema_migrations SET checksum = NULL WHERE version = $1', [victim]);

  const nulled = await verifyChecksums(pool);
  ok(nulled.drifted.length === 0, 'a NULL checksum is NOT reported as drift');
  ok(nulled.unknownCount === 1, 'a NULL checksum is counted as unknown');
  ok((await migrationStatus(pool)).find(s => s.version === victim).checksum === 'unknown',
    "status reports the NULL row as 'unknown'");

  const afterNull = await runAllMigrations(pool);
  ok(afterNull.applied === 0, 'a NULL checksum does NOT cause the migration to re-run');
  ok(afterNull.drifted.length === 0, 'a NULL checksum does NOT fail the run');
  // And it stays NULL: backfilling would stamp today's file as "verified" and launder
  // any edit that already happened.
  ok((await pool.query('SELECT checksum FROM schema_migrations WHERE version=$1', [victim])).rows[0].checksum === null,
    'the NULL is left NULL (never silently backfilled)');

  // ── a REAL mismatch is detected, loudly, without failing the run ────────────
  console.log('\ndrift detection');
  await pool.query("UPDATE schema_migrations SET checksum = repeat('a', 64) WHERE version = $1", [victim]);
  const drifted = await verifyChecksums(pool);
  ok(drifted.drifted.length === 1 && drifted.drifted[0].version === victim, 'an edited-after-apply migration IS detected');
  ok((await migrationStatus(pool)).find(s => s.version === victim).checksum === 'DRIFTED', "status reports 'DRIFTED'");

  const afterDrift = await runAllMigrations(pool);
  ok(afterDrift.applied === 0, 'drift does not cause a re-run');
  ok(afterDrift.drifted.length === 1, 'drift is surfaced on the run result (boot stays up)');

  // Restore the true checksum so the rollback section starts from a clean state.
  const victimRow = status.find(s => s.version === victim);
  await pool.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1',
    [victim, migrationChecksum(`${process.cwd()}/database/migrations/${victim}-${victimRow.name}.sql`)]);
  ok((await verifyChecksums(pool)).drifted.length === 0, 'checksum restored → clean again');

  // ── rollback (the path that was wired to nothing) ───────────────────────────
  console.log('\nrollback');
  const before = await rows();
  const last = before[before.length - 1];
  const rb = await rollbackMigrations(pool, 1);
  ok(rb.rolledBack === 1, `rolled back 1 migration (${last.version})`);
  const after = await rows();
  ok(after.length === before.length - 1, 'the schema_migrations row was removed');
  ok(!after.some(r => r.version === last.version), `${last.version} is no longer recorded as applied`);

  // …and the runner re-applies it, re-recording a checksum.
  const reapplied = await runAllMigrations(pool);
  ok(reapplied.applied === 1, 'the rolled-back migration is pending again and re-applies');
  const back = (await rows()).find(r => r.version === last.version);
  ok(back && back.checksum && back.checksum.length === 64, 're-applied migration recorded a fresh checksum');

  console.log(`\n${fail === 0 ? '✅' : '❌'} migration-runner: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });

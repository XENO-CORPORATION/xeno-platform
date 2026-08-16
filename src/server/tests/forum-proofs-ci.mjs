#!/usr/bin/env node
/**
 * Run the Forum's end-to-end proofs against a throwaway database.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Seven proofs verify the Forum end to end — the webhook push, the report
 * intake, the throttles, the moderation chain, erasure, the agent surface, the
 * notification return path. Each drives the real services against a real
 * Postgres inside a transaction that is always rolled back, and each has caught
 * a defect that unit tests could not:
 *
 *   getDigest threw on every call        resolveFlag threw on every call
 *   the delivery engine had no producer  a locked thread recorded no locker
 *
 * And they ran ONLY when somebody typed the command. That is the same defect
 * this codebase has shipped five times — a check that exists and does not run —
 * applied to the strongest verification the Forum has.
 *
 * ── WHAT RUNS HERE, AND WHAT DOES NOT ───────────────────────────────────────
 *
 * Six of the seven build every row they need. `forum-report-proof` is excluded
 * on purpose: its preflight assertion reads the SEEDED corpus, so it verifies
 * dedup against real content and would prove nothing against a synthetic one.
 * It stays operator-run against production, where the corpus is real.
 *
 * ⚠️ These are the CI copies of proofs whose whole value is running against a
 * real system. Green here means the code is correct against the schema; it does
 * NOT replace running them against production before a release, where the
 * corpus, the data volume and the deployed build are the things under test.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(__dirname, '..', 'database', 'migrations');
const SCRIPTS = join(__dirname, '..', '..', '..', 'scripts');

const PROOFS = [
  'forum-throttle-proof.mjs',
  'forum-moderation-proof.mjs',
  'forum-erasure-proof.mjs',
  'forum-agent-surface-proof.mjs',
  'forum-notify-email-proof.mjs',
  'forum-push-proof.mjs',
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * The migrations the Forum needs, in filename order.
 *
 * ⚠️ NOT "every migration". The first version applied all 24 and died on
 * `20260621123000-remote-run-workspace.sql`, which ALTERs `xeno_remote_runs` —
 * a table created by a JavaScript migration, not a SQL one. Applying the SQL
 * files alone is not a faithful reconstruction of production, and pretending
 * otherwise would make this job fail for reasons that have nothing to do with
 * the Forum.
 *
 * So: the baseline (users, api_keys), the infrastructure tables the push half
 * delivers through (webhooks, webhook_deliveries), agent identities, and every
 * forum migration. Anything else is another feature's problem.
 *
 * A file named here that does not exist is a hard error — a renamed migration
 * must break this loudly rather than silently drop a table.
 */
const REQUIRED = [
  '00000000000000-baseline.sql',
  '20260318000001-infrastructure-tables.sql',
  '20260811130000-agent-identities.sql',
];

async function applySchema() {
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of REQUIRED) {
    if (!all.includes(f)) throw new Error(`required migration ${f} is missing — was it renamed?`);
  }
  const files = [...new Set([...REQUIRED, ...all.filter((f) => f.includes('forum'))])].sort();

  for (const f of files) {
    try {
      await pool.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
      console.log(`  applied ${f}`);
    } catch (err) {
      // Say what DOES exist. "relation X does not exist" while applying
      // migrations in order means either the creating migration was skipped or
      // it did not create what its name suggests — and those need opposite
      // fixes, so guessing costs a CI round each time.
      const { rows } = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'forum_%' ORDER BY 1",
      ).catch(() => ({ rows: [] }));
      throw new Error(
        `migration ${f} failed: ${err.message}
`
        + `  forum tables present: ${rows.map((r) => r.table_name).join(', ') || '(none)'}`,
      );
    }
  }
  return files.length;
}

async function main() {
  const applied = await applySchema();
  console.log(`schema: ${applied} migrations applied\n`);

  // The proofs all resolve an admin as their acting principal, and every one of
  // them clones that row to build the users it needs — so this is the only seed
  // required beyond the schema itself.
  await pool.query(
    `INSERT INTO users (email, username, display_name, role, is_active, email_verified, created_at)
     VALUES ('ci-admin@example.invalid', 'ci_admin', 'CI Admin', 'admin', true, true, NOW() - INTERVAL '90 days')
     ON CONFLICT DO NOTHING`,
  );

  const { seedForum } = await import('../database/seeds/forum-seed.js');
  await seedForum(pool);
  const spaces = (await pool.query('SELECT COUNT(*)::int n FROM forum_spaces')).rows[0].n;
  if (!spaces) throw new Error('no forum spaces after seeding — the proofs post into help/feedback');
  console.log(`seed: 1 admin, ${spaces} spaces\n`);
  await pool.end();

  let failed = 0;
  for (const proof of PROOFS) {
    console.log(`──────── ${proof} ────────`);
    try {
      execFileSync(process.execPath, [join(SCRIPTS, proof), '--confirm'], {
        stdio: 'inherit',
        env: { ...process.env, FORUM_SERVICE_DIR: join(__dirname, '..', 'services') },
      });
    } catch {
      console.error(`::error::forum proof failed: ${proof}`);
      failed += 1;
    }
  }

  console.log('');
  if (failed) {
    console.log(`${failed} of ${PROOFS.length} proofs failed.`);
    process.exit(1);
  }
  console.log(`All ${PROOFS.length} Forum proofs passed against a fresh database.`);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

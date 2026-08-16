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
  // GDPR erasure touches the email opt-out table on its way through. It is not
  // a forum table, but the erasure proof cannot run without it — and a missing
  // one aborts the transaction, so every assertion after it fails for a reason
  // that has nothing to do with erasure.
  '20260814120000-email-opt-outs.sql',
];

async function applySchema() {
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of REQUIRED) {
    if (!all.includes(f)) throw new Error(`required migration ${f} is missing — was it renamed?`);
  }
  const files = [...new Set([...REQUIRED, ...all.filter((f) => f.includes('forum'))])].sort();

  for (const f of files) {
    try {
      // 🔴 ONLY THE UP SECTION. These files carry `-- UP` and `-- DOWN`, and
      // running the whole file creates every table and then DROPS them —
      // succeeding, silently, with nothing to show for it. That is exactly what
      // happened: `forum-tables.sql` "applied" and left zero forum tables, and
      // the next migration failed on a relation the previous one had just
      // deleted.
      //
      // Split the same way `services/migrationRunner.js` does, because a second
      // interpretation of the migration format is a second thing to keep in
      // sync — which is the whole lesson of the fixtures this job exists beside.
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
        .split(/^--\s*DOWN\b/im)[0]
        .replace(/^--\s*UP\b.*$/im, '');
      await pool.query(sql);
      // Count after EVERY file. "applied X" followed later by "(none)" told me
      // tables were disappearing but not which file removed them, and each
      // guess costs a CI round.
      const { rows: t } = await pool.query(
        "SELECT to_regclass('users') AS users, to_regclass('forum_spaces') AS spaces, to_regclass('webhooks') AS hooks",
      );
      console.log(`  applied ${f}  bytes=${sql.length} creates=${(sql.match(/CREATE TABLE/gi) || []).length}`
        + `  users=${t[0].users} spaces=${t[0].spaces} webhooks=${t[0].hooks}`);
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

  // `oauth_refresh_tokens` and the rest of the account-v2 surface come from a
  // JAVASCRIPT migration, not a .sql file — which is also why "apply every .sql"
  // was never a faithful reconstruction. Every other DB suite in this repo calls
  // this for the same reason.
  const { migrateAccountV2 } = await import('../database/migrate-account-v2.js');
  await migrateAccountV2(pool);
  console.log(`schema: ${applied} migrations + account-v2 applied\n`);

  // The proofs all resolve an admin as their acting principal, and every one of
  // them clones that row to build the users it needs — so this is the only seed
  // required beyond the schema itself.
  // `password_hash` is NOT NULL and this account never logs in — the proofs
  // resolve it as a principal and clone it. A placeholder that is obviously not
  // a usable credential is the honest choice: leaving it null fails the
  // constraint, and putting a real hash there would imply the account can sign in.
  await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, role, is_active, email_verified, created_at)
     VALUES ('ci-admin@example.invalid', 'ci_admin', 'CI Admin',
             'NOT-A-CREDENTIAL-ci-fixture-only', 'admin', true, true, NOW() - INTERVAL '90 days')
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

/*
 * ⚠️ UNFINISHED — DO NOT MERGE WITHOUT READING THIS.
 *
 * Nine CI rounds in, the job does not work and I stopped rather than keep
 * spending on it. Recording the state so the next attempt starts from the
 * evidence rather than from scratch.
 *
 * ── THE SYMPTOM, NARROWED ───────────────────────────────────────────────────
 *
 *   applied 00000000000000-baseline.sql        users=users spaces=null hooks=null
 *   applied 20260318000001-infrastructure...   users=users spaces=null hooks=null
 *   applied 20260809120000-forum-tables.sql    users=users spaces=null hooks=null
 *   FATAL   ...forum-participation.sql: relation "forum_tags" does not exist
 *
 * The BASELINE applies and its tables exist. The two hand-written migrations
 * after it send real SQL — 5,261 bytes / 6 CREATEs, and 10,322 bytes / 5
 * CREATEs, verified by printing what is passed to `pool.query` — return without
 * error, and create NOTHING. Same database, same schema (`forum_proofs`,
 * `public`), checked with `to_regclass` rather than `information_schema` so a
 * privilege or catalog quirk is not the explanation.
 *
 * ── RULED OUT ───────────────────────────────────────────────────────────────
 *
 *   • The UP/DOWN split. Verified locally: the UP half of forum-tables.sql is
 *     205 lines with 5 CREATE TABLE and 0 DROP TABLE, split the same way
 *     `services/migrationRunner.js` does.
 *   • Truncation. The byte counts above are of the string actually sent.
 *   • Wrong database or schema. Printed; both correct.
 *   • A false-negative count. `to_regclass` agrees with
 *     `information_schema.tables`.
 *   • An error being swallowed. `await pool.query(sql)` sits inside the try that
 *     reports the failure for the NEXT file.
 *
 * ── WHAT I WOULD CHECK NEXT ─────────────────────────────────────────────────
 *
 * The difference between the file that works and the ones that do not is that
 * the baseline is a pg_dump of plain statements, while both failures are
 * hand-written migrations. So: an implicit-transaction interaction with node-pg's
 * simple-query protocol, something in those files that opens a transaction the
 * split then leaves unterminated, or a `SET` that changes where objects land.
 * Print `SELECT txid_current_if_assigned(), current_setting('search_path')`
 * immediately after the query, and try applying ONE statement at a time.
 *
 * ── STATUS ──────────────────────────────────────────────────────────────────
 *
 * The `gates` job (npm test, 26 steps) IS merged and green on main — that half
 * works and is the one that matters day to day. This job is branch-only and
 * main is unaffected.
 */

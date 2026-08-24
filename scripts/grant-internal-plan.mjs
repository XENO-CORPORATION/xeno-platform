#!/usr/bin/env node
/**
 * Put a NAMED operator account on the `internal` plan, so the download gate can
 * be walked end to end before Stripe can take a euro.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Downloading now requires an active paid plan (`canDownload`, added
 * 2026-08-24 by owner override). No plan is purchasable until Stripe products
 * exist, so without this nobody — including us — can obtain an installer, and
 * the gate could not be tested against anything but a refusal.
 *
 * This is NOT a promo code and must never become one:
 *   - Accounts are named on the command line. There is no default list.
 *   - It writes `plan=internal`, which is the STAFF plan and is deliberately
 *     absent from the upgrade ladder, so it can never be sold or suggested.
 *   - It is DRY-RUN by default (ABSOLUTE RULE 2b). `--confirm` writes.
 *   - It REFUSES to overwrite an account that already holds a paid plan,
 *     because that row may be a real Stripe subscription and this script has
 *     no way to put it back.
 *
 * Usage (on xeno-platform-001, inside the backend container):
 *   node scripts/grant-internal-plan.mjs someone@example.com            # dry run
 *   node scripts/grant-internal-plan.mjs someone@example.com --confirm  # write
 *   node scripts/grant-internal-plan.mjs someone@example.com --revoke --confirm
 */
import pg from 'pg';

const PAID = new Set(['pro', 'team', 'studio']);
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const revoke = args.includes('--revoke');
const emails = args.filter((a) => !a.startsWith('--'));

if (!emails.length) {
  console.error('Refusing to run: name at least one account.\n'
    + '  node scripts/grant-internal-plan.mjs someone@example.com [--confirm] [--revoke]');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let exitCode = 0;

try {
  for (const email of emails) {
    const u = await pool.query('SELECT id, email FROM users WHERE lower(email) = lower($1)', [email]);
    if (!u.rows.length) {
      console.error(`✖ ${email} — no such account`);
      exitCode = 1;
      continue;
    }
    const userId = String(u.rows[0].id);

    const cur = await pool.query(
      'SELECT plan, status FROM xeno_account_plans WHERE user_id = $1', [userId],
    );
    const row = cur.rows[0];
    const held = row ? `${row.plan}/${row.status}` : 'none';

    // Never clobber a real subscription — this script cannot restore one.
    if (row && PAID.has(row.plan) && ACTIVE.has(row.status)) {
      console.error(`✖ ${email} — already on a PAID plan (${held}); refusing to overwrite`);
      exitCode = 1;
      continue;
    }

    const target = revoke ? 'free' : 'internal';
    const status = revoke ? 'canceled' : 'active';

    if (!confirm) {
      console.log(`DRY RUN  ${email}  ${held} -> ${target}/${status}   (pass --confirm to write)`);
      continue;
    }

    await pool.query(
      `INSERT INTO xeno_account_plans (user_id, plan, status, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET
         plan = EXCLUDED.plan, status = EXCLUDED.status, updated_at = now()`,
      [userId, target, status],
    );

    // Read back rather than trusting the write — verify outcomes, not exit paths.
    const after = await pool.query(
      'SELECT plan, status FROM xeno_account_plans WHERE user_id = $1', [userId],
    );
    const now = after.rows[0];
    const good = now && now.plan === target && now.status === status;
    console.log(`${good ? '✔' : '✖'} ${email}  ${held} -> ${now?.plan}/${now?.status}`);
    if (!good) exitCode = 1;
  }
} finally {
  await pool.end();
}

process.exit(exitCode);

/**
 * CONTRACT TEST — the legacy `users.credits` mirror must never drift from the
 * canonical v2 ledger (`credit_accounts.balance`).
 *
 * This is the guardrail for the "ledger is authoritative" invariant. If it fails,
 * some debit/grant path is bypassing the ledger again — the exact class of bug
 * behind the false "insufficient credits" 402s (api-proxy gate + welcome credits).
 *
 * For every account that HAS a v2 ledger row it asserts:
 *   1. |round(balance/1e6) − users.credits| < 1   → no ≥1-credit drift
 *   2. NOT (balance > 0 AND users.credits ≤ 0)     → no false lock-out
 *
 * Run:  DATABASE_URL=postgres://… node src/server/tests/credit-mirror-drift.test.mjs
 * Exit: 0 = pass, 1 = invariant violated, 2 = harness error.
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';

const url = process.env.DATABASE_URL || process.env.PLATFORM_DATABASE_URL;
if (!url) { console.error('SKIP: DATABASE_URL not set'); process.exit(process.env.CI ? 2 : 0); }

const MICRO_PER_CREDIT = 1_000_000;
const pool = new pg.Pool({ connectionString: url });
let exitCode = 0;

const AUDIT = `
    SELECT u.id, left(u.email, 4) AS em, u.credits AS mirror, ca.balance AS ledger_micro
      FROM users u JOIN credit_accounts ca ON ca.user_id = u.id`;

/*
 * Self-check, for the case this suite spent its whole life in: an EMPTY
 * database. Zero joined accounts means zero drift, so the audit would report a
 * pass having examined nothing -- a gate that cannot fail. On an empty database
 * we therefore seed one consistent and one drifted account inside a transaction
 * that is always rolled back, and require the audit to flag exactly the drifted
 * one. On a populated database this never runs: real rows are never touched.
 */
async function selfCheck() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seed = async (email, credits, micro) => {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (username, email, password_hash, display_name, credits)
         VALUES ($1, $1, 'x', 'Mirror self-check', $2) RETURNING id`, [email, credits]);
      await client.query(
        `INSERT INTO credit_accounts (user_id, balance) VALUES ($1, $2)`, [user.id, micro]);
    };
    await seed('mirror-selfcheck-consistent@xeno.invalid', 5, 5_000_000);
    await seed('mirror-selfcheck-drifted@xeno.invalid', 0, 9_000_000);
    const { rows } = await client.query(AUDIT);
    const flagged = rows.filter((r) => {
      const ledgerWhole = Math.round(Number(r.ledger_micro) / MICRO_PER_CREDIT);
      return Math.abs(ledgerWhole - Number(r.mirror)) >= 1
        || (Number(r.ledger_micro) > 0 && Number(r.mirror) <= 0);
    });
    if (rows.length !== 2 || flagged.length !== 1) {
      throw new Error(`self-check: audited ${rows.length} seeded accounts and flagged `
        + `${flagged.length}; expected 2 and 1. The audit cannot detect drift.`);
    }
    console.log('SELF-CHECK: the audit detects a seeded 9-credit drift and clears a consistent account.');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

try {
  // The suite is pointed at throwaway databases by the local qualifier as well
  // as at real ones, so bring the schema up rather than reporting a harness
  // error on a database that simply has not been migrated yet.
  const { rows: [schema] } = await pool.query(
    `SELECT to_regclass('public.credit_accounts') IS NOT NULL AS ready`);
  if (!schema.ready) await runAllMigrations(pool);

  const { rows } = await pool.query(AUDIT);
  if (rows.length === 0) await selfCheck();

  let drift = 0, locked = 0;
  for (const r of rows) {
    const ledgerWhole = Math.round(Number(r.ledger_micro) / MICRO_PER_CREDIT);
    const mirror = Number(r.mirror);
    if (Math.abs(ledgerWhole - mirror) >= 1) {
      drift++;
      console.error(`  DRIFT  ${r.em}…  mirror=${mirror}  ledger=${ledgerWhole}  (Δ=${mirror - ledgerWhole})`);
    }
    if (Number(r.ledger_micro) > 0 && mirror <= 0) {
      locked++;
      console.error(`  LOCKED ${r.em}…  ledger>0 but mirror<=0 (false 402 risk)`);
    }
  }

  console.log(`checked ${rows.length} ledger accounts | drift(>=1cr)=${drift} | false-locked=${locked}`);
  if (rows.length === 0) console.log('No real ledger accounts on this database; the self-check above is the evidence.');
  if (drift > 0 || locked > 0) {
    console.error('FAIL: users.credits mirror has diverged from the canonical ledger — a debit/grant path is bypassing the ledger.');
    exitCode = 1;
  } else {
    console.log('PASS: users.credits == round(credit_accounts.balance) for every account; no false lock-outs.');
  }
} catch (e) {
  console.error('test harness error:', e.message);
  exitCode = 2;
} finally {
  await pool.end();
}

process.exit(exitCode);

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

const url = process.env.DATABASE_URL || process.env.PLATFORM_DATABASE_URL;
if (!url) { console.error('SKIP: DATABASE_URL not set'); process.exit(process.env.CI ? 2 : 0); }

const MICRO_PER_CREDIT = 1_000_000;
const pool = new pg.Pool({ connectionString: url });
let exitCode = 0;

try {
  const { rows } = await pool.query(`
    SELECT u.id, left(u.email, 4) AS em, u.credits AS mirror, ca.balance AS ledger_micro
      FROM users u JOIN credit_accounts ca ON ca.user_id = u.id`);

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

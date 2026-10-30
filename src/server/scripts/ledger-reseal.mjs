/**
 * Re-seal one account's chain after rows were written with the chain trigger off (a rollback window).
 *
 * A person's act: it needs the migrate job's credential, a named person and a reason, and it leaves a permanent
 * `resealed` attestation. It cannot hide an altered entry: earlier epochs are still verified.
 *
 *   docker compose run --rm --no-deps migrate node scripts/ledger-reseal.mjs \
 *     --account <uuid> --actor "<name>" --reason "<why>"            # dry run: says what it would seal
 *   ... --confirm                                                    # does it
 *
 * Procedure: docs/LEDGER-OPERATIONS.md.
 */
import pg from 'pg';
import { verifyAccountChain } from '../utils/creditLedgerV2.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const account = arg('account'); const actor = arg('actor'); const reason = arg('reason');
const confirm = process.argv.includes('--confirm');
if (!account || !actor?.trim() || !reason?.trim()) {
  console.error('needs --account <uuid> --actor "<name>" --reason "<why>" [--confirm]');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 2 });
let code = 0;
try {
  const before = await verifyAccountChain(pool, account);
  console.log('before:', JSON.stringify({ ok: before.ok, reason: before.reason, unchained: before.unchained, entries: before.entries }));
  if (before.reason !== 'unchained-entries') {
    console.error(before.ok ? 'nothing to re-seal: the chain verifies.' : `refused: the chain is broken by ${before.reason}, which a re-seal must not cover.`);
    code = 1;
  } else if (!confirm) {
    console.log(`dry run: would accept ${before.unchained} unchained row(s) on ${account}. Pass --confirm to do it.`);
  } else {
    const r = await pool.query('SELECT ledger_chain_reseal($1, $2, $3) AS epoch', [account, reason, actor]);
    const after = await verifyAccountChain(pool, account);
    console.log('resealed: epoch', r.rows[0].epoch, JSON.stringify({ ok: after.ok, reason: after.reason, resealedRows: after.resealedRows }));
    if (!after.ok) code = 1;
  }
} finally {
  await pool.end();
}
process.exit(code);

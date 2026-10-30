/**
 * Check the ledger from outside the running app: every checkpoint in the R2 bucket (signature, chain between them),
 * then every account's chain in the database, then the database against the latest checkpoint.
 *
 *   docker exec <backend> node scripts/verify-ledger-anchors.mjs
 *
 * Read-only. Exits non-zero on any disagreement. Procedure: docs/LEDGER-OPERATIONS.md.
 */
import pg from 'pg';
import { anchorFromEnv, verifyAllCheckpoints } from '../services/ledgerChainAnchor.js';
import { verifyAccountChain } from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let failed = false;
try {
  const anchor = anchorFromEnv();
  if (!anchor) {
    console.log('anchor: NOT CONFIGURED (LEDGER_ANCHOR_R2_BUCKET / LEDGER_ANCHOR_PRIVATE_KEY)');
    failed = true;
  } else {
    const r = await verifyAllCheckpoints(pool, anchor);
    console.log('anchor:', JSON.stringify(r));
    if (!r.ok) failed = true;
  }
  const accounts = (await pool.query('SELECT account_id FROM ledger_chain_heads ORDER BY account_id')).rows;
  let good = 0;
  for (const { account_id: id } of accounts) {
    const v = await verifyAccountChain(pool, id);
    if (v.ok) good += 1;
    else { failed = true; console.log('BROKEN', JSON.stringify({ account: id, reason: v.reason, seq: v.seq, brokenAt: v.brokenAt })); }
  }
  console.log(`chains: ${good}/${accounts.length} verified`);
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);

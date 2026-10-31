/**
 * A person accepts that anchored ledger heads are gone, after a real event such as a restore from backup.
 *
 * Writes a checkpoint carrying who, why and what differed. It erases nothing: older checkpoints stay in the bucket, and
 * every outside check (scripts/verify-ledger-anchors.mjs) prints every acknowledgement, forever.
 *
 *   docker exec <backend> node scripts/ledger-anchor-acknowledge.mjs --actor "<name>" --reason "<why>"   # dry run
 *   ... --confirm                                                                                        # does it
 *
 * Procedure: docs/LEDGER-OPERATIONS.md.
 */
import pg from 'pg';
import { anchorFromEnv, acknowledgeAnchors, verifyAllCheckpoints } from '../services/ledgerChainAnchor.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const actor = arg('actor'); const reason = arg('reason');
if (!actor?.trim() || !reason?.trim()) {
  console.error('needs --actor "<name>" --reason "<why>" [--confirm]');
  process.exit(2);
}
const anchor = anchorFromEnv();
if (!anchor) {
  console.error('the anchor is not configured');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let code = 0;
try {
  const before = await verifyAllCheckpoints(pool, anchor);
  console.log('differs:', JSON.stringify(before.mismatches));
  if (!process.argv.includes('--confirm')) {
    console.log('dry run: pass --confirm to record this permanently.');
  } else {
    console.log('acknowledged:', JSON.stringify(await acknowledgeAnchors(pool, anchor, { actor, reason })));
  }
} catch (e) {
  console.error(e.message);
  code = 1;
} finally {
  await pool.end();
}
process.exit(code);

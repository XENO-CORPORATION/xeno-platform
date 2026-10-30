import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';
import { tablesDDL } from './fixtures/schema.mjs';
/**
 * Self-contained integration test for the ledger hash chain (Arch §5).
 * Creates the minimal live-shaped base tables, then exercises debit + hold/settle
 * and verifies the per-account chain detects tampering.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55471/t node tests/ledger-chain.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { recordUsageV2, holdV2, settleHoldV2, verifyChainV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import crypto from 'node:crypto';
import { runLedgerChainAudit } from '../services/ledgerChainAudit.js';
import { signerFromPrivateKey, checkpointKey, checkCheckpoint, verifyAllCheckpoints, acknowledgeAnchors } from '../services/ledgerChainAnchor.js';
import { applyRuntimeGrants, RUNTIME_ROLE } from '../database/runtime-role.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const assertRejects = async (fn, re, m) => { let msg = ''; try { await fn(); } catch (e) { msg = e.message; } ok(re.test(msg), m); };

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) DEFAULT 'user', balance bigint DEFAULT 0,
  lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32),
  amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128),
  description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  // api_usage_logs from the MIGRATIONS (fixtures/schema.mjs): its shape is production's, incl. `dimensions`.
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  const u = await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id');
  const userId = u.rows[0].id;
  await optInUsageCredits(pool, userId);

  // 1. two debits + a hold/settle → 4 chained entries
  await recordUsageV2(pool, userId, { transactionId: 'txn-1', surface: 'xeno_post', operation: 'ai.caption', costMicro: 5 * MICRO_PER_CREDIT });
  await recordUsageV2(pool, userId, { transactionId: 'txn-2', surface: 'xeno_post', operation: 'ai.image', costMicro: 3 * MICRO_PER_CREDIT });
  const h = await holdV2(pool, userId, { surface: 'xeno_post', holdId: 'hold-1', amountMicro: 4 * MICRO_PER_CREDIT, operation: 'ai.video' });
  ok(h.state === 'held', 'hold created');
  await settleHoldV2(pool, userId, 'hold-1', 2 * MICRO_PER_CREDIT);

  // 2. every journal row carries entry_hash + prev_hash
  const rows = await pool.query('SELECT entry_hash, prev_hash FROM credit_transactions WHERE user_id=$1 AND entry_hash IS NOT NULL', [userId]);
  ok(rows.rows.length === 3 && rows.rows.every(r => r.entry_hash && r.prev_hash), `3 chained entries, all hashed (${rows.rows.length})`);

  // 3. chain verifies intact
  const v1 = await verifyChainV2(pool, userId);
  ok(v1.ok && v1.entries === 3, `chain intact: ok=${v1.ok}, entries=${v1.entries}`);

  // 4a. DB-level append-only (§4.2): a normal UPDATE is blocked by the trigger.
  let blocked = null;
  try { await pool.query("UPDATE credit_transactions SET amount = amount - 1 WHERE user_id=$1 AND reference_id='txn-1'", [userId]); }
  catch (e) { blocked = e.message; }
  ok(/append-only/.test(blocked || ''), 'DB trigger BLOCKS update on credit_transactions (append-only)');

  // 4b. Defense in depth: even if the trigger is bypassed, the hash chain catches it.
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query("UPDATE credit_transactions SET amount = amount - 1000000 WHERE user_id=$1 AND reference_id='txn-1'", [userId]);
  await pool.query("SET session_replication_role = 'origin'");
  const v2 = await verifyChainV2(pool, userId);
  ok(!v2.ok && v2.transactionId === 'txn-1', `tamper (trigger bypassed) DETECTED by hash chain at txn-1`);

  // ── v2: the DATABASE is the sequencer (2026-10-30) ────────────────────────────────────────────────────
  const newUser = async () => {
    const id = (await pool.query('INSERT INTO users (credits) VALUES (100) RETURNING id')).rows[0].id;
    await optInUsageCredits(pool, id);
    return id;
  };
  const accountOf = async (id) => (await pool.query('SELECT id FROM credit_accounts WHERE user_id=$1', [id])).rows[0].id;

  // 5. Concurrency: v1 forked (290 forks on one production account, 2026-09) because each writer read "the
  //    newest row" itself. Twenty writers at once must still produce ONE chain, 1..n with no gap.
  const c = await newUser();
  await Promise.all(Array.from({ length: 20 }, (_, i) => recordUsageV2(pool, c, {
    transactionId: `conc-${i}`, surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT,
  })));
  const vc = await verifyChainV2(pool, c);
  const seqs = (await pool.query('SELECT chain_seq FROM credit_transactions WHERE account_id=$1 AND chain_seq IS NOT NULL ORDER BY chain_seq', [await accountOf(c)])).rows.map((r) => Number(r.chain_seq));
  ok(vc.ok && seqs.join(',') === Array.from({ length: seqs.length }, (_, i) => i + 1).join(','),
    `20 concurrent writers → one contiguous chain (ok=${vc.ok}, seq 1..${seqs.length}, reason=${vc.reason || '-'})`);
  const forks = (await pool.query('SELECT count(*)::int n FROM (SELECT prev_hash FROM credit_transactions WHERE account_id=$1 GROUP BY prev_hash HAVING count(*)>1) f', [await accountOf(c)])).rows[0].n;
  ok(forks === 0, 'no two entries claim the same predecessor');

  // 6. Every writer is chained, not only insertLedgerEntry: the portal and the old gateway INSERTed directly.
  const d = await newUser();
  await recordUsageV2(pool, d, { transactionId: 'd-1', surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT });
  await pool.query(
    `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
     SELECT $1, ca.id, 'opening_balance', 0, ca.balance, 'portal_runtime', 'portal-1', 'direct insert', now() - interval '1 day'
       FROM credit_accounts ca WHERE ca.user_id=$1`, [d]);
  const direct = (await pool.query("SELECT hash_version, chain_seq, entry_hash, created_at > now() - interval '1 hour' AS fresh FROM credit_transactions WHERE reference_id='portal-1'")).rows[0];
  ok(direct.hash_version === 2 && Number(direct.chain_seq) === 2 && direct.entry_hash, 'a direct INSERT from another writer is chained by the database (seq 2)');
  ok(direct.fresh === true, "a writer cannot backdate an entry: the database sets the journal's time");
  ok((await verifyChainV2(pool, d)).ok, 'chain verifies across application + direct writers');

  // 7. Completeness: a row slipped in with the trigger disabled carries no hash — the verifier still finds it.
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query(
    `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id)
     SELECT $1, ca.id, 'manual_credit_grant', 999000000, ca.balance + 999000000, 'manual', 'sneak-1' FROM credit_accounts ca WHERE ca.user_id=$1`, [d]);
  await pool.query("SET session_replication_role = 'origin'");
  const vd = await verifyChainV2(pool, d);
  ok(!vd.ok && vd.reason === 'unchained-entries' && vd.unchained === 1, `an unchained row (trigger bypassed) is DETECTED (reason=${vd.reason})`);

  // 8. History is SEALED, never rewritten: rows from before v2 (some v1-hashed, some never hashed) are bound
  //    into epoch 1; the chain starts after them and verifies; the legacy report says what was found.
  const h0 = await newUser();
  await pool.query('INSERT INTO credit_accounts (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [h0, String(100 * MICRO_PER_CREDIT)]);
  const hAcct = await accountOf(h0);
  await pool.query("SET session_replication_role = 'replica'");
  for (let i = 0; i < 3; i += 1) {
    await pool.query(
      `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id, prev_hash, entry_hash, created_at)
       VALUES ($1,$2,'usage_debit',-1,0,'api_usage',$3,$4,$5, now() - interval '30 days' + ($6 || ' seconds')::interval)`,
      [h0, hAcct, `old-${i}`, i === 0 ? null : 'x', i === 0 ? null : `v1-${i}`, String(i)]);
  }
  await pool.query("SET session_replication_role = 'origin'");
  await recordUsageV2(pool, h0, { transactionId: 'h-new', surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT });
  const epoch = (await pool.query('SELECT prior_entries, prior_head FROM ledger_chain_epochs WHERE account_id=$1', [hAcct])).rows[0];
  ok(Number(epoch.prior_entries) === 3 && epoch.prior_head === 'v1-2', `epoch 1 seals the 3 earlier rows and the last v1 hash (prior=${epoch.prior_entries}, head=${epoch.prior_head})`);
  const vh = await verifyChainV2(pool, h0, { includeLegacy: true });
  ok(vh.ok && vh.entries === 1 && vh.sealedHistory === 3, `the v2 chain verifies on top of sealed history (ok=${vh.ok}, entries=${vh.entries})`);
  ok(vh.legacy && vh.legacy.unhashed === 1 && vh.legacy.ok === false, 'the legacy report states what was found (1 row never hashed) instead of hiding it');

  // 9. The chain's own records cannot be moved by hand.
  let headBlocked = null;
  try { await pool.query('UPDATE ledger_chain_heads SET seq = seq + 1 WHERE account_id=$1', [hAcct]); } catch (e) { headBlocked = e.message; }
  ok(/moves only by appending/.test(headBlocked || ''), 'a chain head cannot be moved by an UPDATE');
  let epochBlocked = null;
  try { await pool.query('DELETE FROM ledger_chain_epochs WHERE account_id=$1', [hAcct]); } catch (e) { epochBlocked = e.message; }
  ok(/append-only/.test(epochBlocked || ''), 'an epoch cannot be deleted');

  // 10. A sequence hole (a deleted chained row) is found, not just an altered one.
  const g = await newUser();
  for (let i = 0; i < 3; i += 1) await recordUsageV2(pool, g, { transactionId: `g-${i}`, surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT });
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query("DELETE FROM credit_transactions WHERE reference_id='g-1'");
  await pool.query("SET session_replication_role = 'origin'");
  const vg = await verifyChainV2(pool, g);
  ok(!vg.ok && vg.reason === 'sequence-gap', `a deleted entry is DETECTED as a sequence gap (reason=${vg.reason})`);

  // 11. The hourly audit finds exactly the broken chains (the tampered first user, the sneaked row, the hole),
  //     records history-sealed once per account, and writes nothing on a pass where nothing moved.
  const quiet = { error: () => {} };
  const a1 = await runLedgerChainAudit(pool, { log: quiet });
  const brokenAccounts = new Set(a1.failures.map((f) => f.accountId));
  ok(a1.broken === 3 && brokenAccounts.has(await accountOf(userId)) && brokenAccounts.has(await accountOf(d)) && brokenAccounts.has(await accountOf(g)),
    `audit: 3 broken chains found, the right ones (broken=${a1.broken}, verified=${a1.verified})`);
  ok(a1.verified === a1.accounts - 3 && a1.sealed === a1.accounts, `audit: the rest verify, and each account's history is sealed once (sealed=${a1.sealed})`);
  const sealedH = (await pool.query("SELECT report FROM ledger_chain_attestations WHERE account_id=$1 AND kind='history-sealed'", [hAcct])).rows[0].report;
  ok(sealedH.priorEntries === 3 && sealedH.legacy.unhashed === 1, 'audit: the sealed history report records what v1 left (3 rows, 1 never hashed)');
  const a2 = await runLedgerChainAudit(pool, { log: quiet });
  ok(a2.attested === 0 && a2.sealed === 0 && a2.broken === 3, 'audit: a second pass with nothing moved writes nothing, and still reports the breaks');
  let attBlocked = null;
  try { await pool.query("DELETE FROM ledger_chain_attestations WHERE kind='broken'"); } catch (e) { attBlocked = e.message; }
  ok(/append-only/.test(attBlocked || ''), 'a broken verdict cannot be deleted');

  // 12. Re-seal: a person accepts rows written with the trigger off. It names who and why, and it can never hide an
  //     altered entry, because earlier epochs are still verified.
  let noReason = null;
  try { await pool.query("SELECT ledger_chain_reseal($1, '', 'Owner')", [await accountOf(d)]); } catch (e) { noReason = e.message; }
  ok(/names who and why/.test(noReason || ''), 'a re-seal without a reason is refused');
  const sealedEpoch = (await pool.query("SELECT ledger_chain_reseal($1, 'trigger was off during a rollback', 'Owner') AS e", [await accountOf(d)])).rows[0].e;
  const vs = await verifyChainV2(pool, d);
  ok(sealedEpoch === 2 && vs.ok && vs.epochs === 2 && vs.resealedRows === 1, `re-seal opens epoch 2 and the chain verifies (ok=${vs.ok}, resealed=${vs.resealedRows}, reason=${vs.reason || '-'})`);
  const att = (await pool.query("SELECT report FROM ledger_chain_attestations WHERE account_id=$1 AND kind='resealed'", [await accountOf(d)])).rows[0].report;
  ok(att.actor === 'Owner' && att.rows === 1 && /rollback/.test(att.reason), 'the re-seal records who, why and how many rows');
  await recordUsageV2(pool, d, { transactionId: 'd-after', surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT });
  ok((await verifyChainV2(pool, d)).ok, 'the chain carries on after a re-seal');
  let nothing = null;
  try { await pool.query("SELECT ledger_chain_reseal($1, 'x', 'y')", [await accountOf(d)]); } catch (e) { nothing = e.message; }
  ok(/nothing to re-seal/.test(nothing || ''), 'a re-seal with nothing unchained is refused');
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query(
    `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id)
     SELECT $1, ca.id, 'manual_credit_grant', 1, ca.balance, 'manual', 'sneak-2' FROM credit_accounts ca WHERE ca.user_id=$1`, [userId]);
  await pool.query("SET session_replication_role = 'origin'");
  await pool.query("SELECT ledger_chain_reseal($1, 'cover the tampering', 'Attacker')", [await accountOf(userId)]);
  const vt = await verifyChainV2(pool, userId);
  ok(!vt.ok && vt.reason === 'entry-hash', `a re-seal cannot hide an altered entry (reason=${vt.reason})`);

  // 13. The role the app runs as: writes the journal, and nothing that could undo the chain.
  await applyRuntimeGrants(pool);
  const asApp = await pool.connect();
  const refused = async (sql, params) => {
    await asApp.query('SAVEPOINT s');
    try { await asApp.query(sql, params); await asApp.query('RELEASE SAVEPOINT s'); return null; }
    catch (e) { await asApp.query('ROLLBACK TO SAVEPOINT s'); return e.message; }
  };
  try {
    await asApp.query('BEGIN');
    await asApp.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    const roleAcct = await accountOf(g);
    const appended = (await asApp.query(
      `INSERT INTO credit_transactions (user_id, account_id, type, amount, balance_after, reference_type, reference_id)
       VALUES ($1,$2,'debit',0,0,'probe','role-1') RETURNING hash_version, chain_seq`, [g, roleAcct])).rows[0];
    ok(appended.hash_version === 2 && Number(appended.chain_seq) > 0, 'xeno_app can append to the journal, and the entry is chained');
    ok(/permission denied/.test(await refused('UPDATE credit_transactions SET amount = 0') || ''), 'xeno_app cannot update the journal');
    ok(/permission denied/.test(await refused('DELETE FROM credit_transactions') || ''), 'xeno_app cannot delete from the journal');
    ok(/owner|permission denied/.test(await refused('ALTER TABLE credit_transactions DISABLE TRIGGER trg_credit_txn_chain_append') || ''), 'xeno_app cannot disable the chain trigger');
    ok(/permission denied/.test(await refused("SET session_replication_role = 'replica'") || ''), 'xeno_app cannot switch triggers off for its session');
    ok(/permission denied/.test(await refused('UPDATE ledger_chain_heads SET seq = 0') || ''), 'xeno_app cannot move a chain head');
    ok(/permission denied/.test(await refused('DELETE FROM ledger_chain_epochs') || ''), 'xeno_app cannot remove an epoch');
    ok(/permission denied/.test(await refused("SELECT ledger_chain_reseal($1, 'r', 'a')", [roleAcct]) || ''), 'xeno_app cannot re-seal');
    ok(/permission denied/.test(await refused('CREATE TABLE app_made_this (id int)') || ''), 'xeno_app cannot create a table');
    await asApp.query('ROLLBACK');
  } finally { asApp.release(); }

  // 14. The anchor outside the database. A whole chain rewritten with every hash recomputed VERIFIES: that is exactly
  //     what a chain inside the database cannot catch, and what the anchored checkpoint must.
  const objects = new Map();
  const store = {
    get: async (key) => objects.get(key) ?? null,
    putNew: async (key, bytes) => { if (objects.has(key)) return false; objects.set(key, bytes); return true; },
  };
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const signer = signerFromPrivateKey(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
  const anchor = { store, signer, trustedKeys: { [signer.keyId]: signer.publicKey } };
  const anchorQuiet = { log: quiet, anchor };
  const c1 = await runLedgerChainAudit(pool, anchorQuiet);
  ok(c1.anchor.configured && c1.anchor.wrote && c1.anchor.checkpoint === 1, `the first pass writes checkpoint 1 (${JSON.stringify(c1.anchor)})`);
  const c2 = await runLedgerChainAudit(pool, anchorQuiet);
  ok(!c2.anchor.wrote && c2.anchor.checkpoint === 1, 'nothing moved: no new checkpoint');
  await recordUsageV2(pool, c, { transactionId: 'c-more', surface: 'xeno_post', operation: 'ai.caption', costMicro: MICRO_PER_CREDIT });
  const c3 = await runLedgerChainAudit(pool, anchorQuiet);
  const stored = (n) => JSON.parse(objects.get(checkpointKey(n)).toString('utf8'));
  ok(c3.anchor.wrote && stored(2).body.prev === stored(1).bodyHash, 'a moved head writes checkpoint 2, bound to checkpoint 1');
  ok(checkCheckpoint(stored(2), anchor.trustedKeys, 2) === null, 'the checkpoint verifies against the trusted key');
  const forged = { ...stored(2), body: { ...stored(2).body, at: 'forged' } };
  ok(checkCheckpoint(forged, anchor.trustedKeys, 2) === 'body-hash', 'an edited checkpoint is refused');
  ok(checkCheckpoint(stored(2), {}, 2) === 'signature', 'a checkpoint from an unknown key is refused');
  ok((await store.putNew(checkpointKey(1), Buffer.from('replaced'))) === false && stored(1).body.no === 1, 'a written checkpoint is never replaced');
  const vAll = await verifyAllCheckpoints(pool, anchor);
  ok(vAll.ok && vAll.checkpoints === 2, `the outside check walks every checkpoint and agrees (${JSON.stringify({ ok: vAll.ok, n: vAll.checkpoints })})`);

  // The rewrite: change an amount, recompute every later hash and the head. Only someone with full database access can.
  const victim = await accountOf(c);
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query("UPDATE credit_transactions SET amount = amount - 5 WHERE account_id=$1 AND chain_seq=3", [victim]);
  const chainRows = (await pool.query('SELECT id, chain_epoch, chain_seq, user_id, type, amount, balance_after, reference_type, reference_id, created_at FROM credit_transactions WHERE account_id=$1 AND chain_seq IS NOT NULL ORDER BY chain_seq', [victim])).rows;
  let rewritten = (await pool.query('SELECT epoch_hash FROM ledger_chain_epochs WHERE account_id=$1 AND epoch=1', [victim])).rows[0].epoch_hash;
  for (const r of chainRows) {
    const next = (await pool.query(
      `SELECT ledger_entry_hash_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,created_at::timestamp) AS h FROM credit_transactions WHERE id=$11`,
      [victim, r.chain_epoch, r.chain_seq, rewritten, r.user_id, r.type, r.amount, r.balance_after, r.reference_type, r.reference_id, r.id])).rows[0].h;
    await pool.query('UPDATE credit_transactions SET prev_hash=$1, entry_hash=$2 WHERE id=$3', [rewritten, next, r.id]);
    rewritten = next;
  }
  await pool.query('UPDATE ledger_chain_heads SET head_hash=$1 WHERE account_id=$2', [rewritten, victim]);
  await pool.query("SET session_replication_role = 'origin'");
  ok((await verifyChainV2(pool, c)).ok, 'the rewritten chain VERIFIES on its own: this is the gap the anchor closes');
  const c4 = await runLedgerChainAudit(pool, anchorQuiet);
  const caught = c4.failures.find((f) => f.accountId === victim);
  ok(caught?.reason === 'anchor-mismatch', `the anchor catches the rewrite (${JSON.stringify(caught)})`);
  ok(!c4.anchor.wrote && !objects.has(checkpointKey(c4.anchor.checkpoint + 1)), 'a disagreement blocks new checkpoints: the rewrite is not laundered');
  const again = await runLedgerChainAudit(pool, anchorQuiet);
  ok(again.failures.some((f) => f.accountId === victim && f.reason === 'anchor-mismatch'), 'the alarm stays up on the next pass');
  ok(!(await verifyAllCheckpoints(pool, anchor)).ok, 'the outside check catches it too');
  // Someone holding the signing key AND the database writes a newer checkpoint over the forged head: the full walk still finds it.
  const forgedNo = c4.anchor.checkpoint + 1;
  const forgedHeads = (await pool.query('SELECT account_id::text AS a, epoch, seq, head_hash FROM ledger_chain_heads ORDER BY account_id')).rows.map((h) => [h.a, h.epoch, Number(h.seq), h.head_hash]);
  const fBody = { v: 1, no: forgedNo, prev: stored(forgedNo - 1).bodyHash, at: 'forged', heads: forgedHeads };
  const fHash = crypto.createHash('sha256').update(JSON.stringify(fBody), 'utf8').digest('hex');
  objects.set(checkpointKey(forgedNo), Buffer.from(JSON.stringify({ body: fBody, bodyHash: fHash, keyId: signer.keyId, signature: signer.sign(fHash) })));
  const walked = await verifyAllCheckpoints(pool, anchor);
  ok(!walked.ok && walked.mismatches.some((m) => m.accountId === victim), 'a forged newer checkpoint does not hide it from the full walk');
  const daily = await runLedgerChainAudit(pool, { ...anchorQuiet, fullWalk: true });
  ok(daily.failures.some((f) => f.accountId === victim), 'the daily full walk in the audit finds it too');
  objects.delete(checkpointKey(forgedNo));
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query('DELETE FROM ledger_chain_checkpoints WHERE no=$1', [forgedNo]);
  await pool.query("SET session_replication_role = 'origin'");
  // A person accepts a real loss (a restore from backup): the record is permanent, and the check then carries on from there.
  let noWho = null;
  try { await acknowledgeAnchors(pool, anchor, { actor: '', reason: 'x' }); } catch (e) { noWho = e.message; }
  ok(/names who and why/.test(noWho || ''), 'an acknowledgement without a name is refused');
  const acked = await acknowledgeAnchors(pool, anchor, { actor: 'Owner', reason: 'restored from backup' });
  const afterAck = await verifyAllCheckpoints(pool, anchor);
  ok(afterAck.ok && afterAck.acks.length === 1 && afterAck.acks[0].actor === 'Owner', `after an acknowledgement the check agrees and still prints it (${JSON.stringify({ ok: afterAck.ok, acks: afterAck.acks.length })})`);
  ok(objects.has(checkpointKey(1)) && acked.no > 1, 'the older checkpoints stay in the bucket');
  await assertRejects(() => acknowledgeAnchors(pool, anchor, { actor: 'Owner', reason: 'again' }), /nothing to acknowledge/, 'with nothing differing there is nothing to acknowledge');
  const brokenRow = (await pool.query("SELECT report FROM ledger_chain_attestations WHERE account_id=$1 AND kind='broken' AND report->>'reason'='anchor-mismatch' LIMIT 1", [victim])).rows[0];
  ok(brokenRow?.report?.reason === 'anchor-mismatch', 'the verdict is recorded');

  // A crash between the upload and the row: the bucket is the authority.
  const lastNo = acked.no;
  await pool.query("SET session_replication_role = 'replica'");
  await pool.query('DELETE FROM ledger_chain_checkpoints WHERE no=$1', [lastNo]);
  await pool.query("SET session_replication_role = 'origin'");
  const c5 = await runLedgerChainAudit(pool, anchorQuiet);
  const readopted = (await pool.query('SELECT count(*)::int n FROM ledger_chain_checkpoints WHERE no=$1', [lastNo])).rows[0].n;
  ok(readopted === 1 && c5.anchor.checkpoint >= lastNo, 'a checkpoint missing from the table is taken back from the bucket');
  objects.delete(checkpointKey(lastNo));
  const c6 = await runLedgerChainAudit(pool, anchorQuiet);
  ok(c6.anchor.error === 'checkpoint-missing-from-bucket', `a checkpoint gone from the bucket is an alarm (${c6.anchor.error})`);
  const c7 = await runLedgerChainAudit(pool, { log: quiet, anchor: null });
  ok(c7.anchor.configured === false, 'with nothing configured the audit says so, and anchors nothing');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-chain: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });

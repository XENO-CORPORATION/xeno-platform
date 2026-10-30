/**
 * Ledger chain audit (leader only — index.js backgroundLeader.whenLeader).
 *
 * The chain is only worth something if someone checks it. Every pass verifies EVERY account's v2 chain
 * (utils/creditLedgerV2.js verifyAccountChain: epoch hash, contiguous sequence, every entry hash recomputed
 * here rather than by the database's own functions, the head record, and completeness), and appends an
 * attestation when the head moved or the verdict changed. A break is logged loudly and recorded as `broken`
 * so it is never silently re-verified away.
 *
 * The first time it sees an account's epoch it also records `history-sealed`: what the retired v1 chain held
 * before the epoch (rows, never-hashed rows, forks, links), as found. History is reported, never rewritten.
 */
import { verifyAccountChain } from '../utils/creditLedgerV2.js';

async function lastAttestation(db, accountId, kinds) {
  return (await db.query(
    `SELECT kind, epoch, seq, head_hash FROM ledger_chain_attestations
      WHERE account_id=$1 AND kind = ANY($2) ORDER BY created_at DESC, id DESC LIMIT 1`, [accountId, kinds])).rows[0] || null;
}

export async function runLedgerChainAudit(db, { log = console } = {}) {
  const heads = (await db.query('SELECT account_id, epoch, seq, head_hash FROM ledger_chain_heads ORDER BY account_id')).rows;
  const summary = { accounts: heads.length, verified: 0, broken: 0, attested: 0, sealed: 0, failures: [] };
  for (const h of heads) {
    const accountId = h.account_id;
    if (!(await lastAttestation(db, accountId, ['history-sealed']))) {
      const legacy = (await verifyAccountChain(db, accountId, { includeLegacy: true })).legacy;
      const epoch = (await db.query('SELECT prior_entries, prior_head FROM ledger_chain_epochs WHERE account_id=$1 AND epoch=1', [accountId])).rows[0];
      await db.query(
        `INSERT INTO ledger_chain_attestations (account_id, epoch, seq, head_hash, kind, report) VALUES ($1, 1, 0, $2, 'history-sealed', $3::jsonb)`,
        [accountId, epoch?.prior_head ?? null, JSON.stringify({ priorEntries: Number(epoch?.prior_entries ?? 0), legacy: legacy ?? null })]);
      summary.sealed += 1;
    }
    const v = await verifyAccountChain(db, accountId);
    const kind = v.ok ? 'verified' : 'broken';
    if (v.ok) summary.verified += 1;
    else {
      summary.broken += 1;
      summary.failures.push({ accountId, reason: v.reason, seq: v.seq ?? null });
      log.error?.(`[LedgerChain] BROKEN account=${accountId} reason=${v.reason} ${JSON.stringify(v)}`);
    }
    const last = await lastAttestation(db, accountId, ['verified', 'broken']);
    const moved = !last || last.kind !== kind || String(last.seq) !== String(h.seq) || last.head_hash !== h.head_hash;
    if (moved) {
      const report = v.ok
        ? { entries: v.entries, sealedHistory: v.sealedHistory, balanceMatches: v.balanceMatches }
        : { reason: v.reason, brokenAt: v.brokenAt ?? null, seq: v.seq ?? null, unchained: v.unchained ?? null, transactionId: v.transactionId ?? null };
      await db.query(
        `INSERT INTO ledger_chain_attestations (account_id, epoch, seq, head_hash, kind, report) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [accountId, h.epoch, h.seq, h.head_hash, kind, JSON.stringify(report)]);
      summary.attested += 1;
    }
  }
  return summary;
}

export function startLedgerChainAudit(db, { intervalMs = 60 * 60 * 1000, firstRunMs = 60 * 1000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await runLedgerChainAudit(db);
      console.log(`[LedgerChain] audit: ${r.verified}/${r.accounts} verified, ${r.broken} broken, ${r.attested} attested, ${r.sealed} sealed`);
    } catch (e) { console.error('[LedgerChain] audit failed:', e.message); }
    finally { busy = false; }
  };
  const first = setTimeout(tick, firstRunMs);
  first.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

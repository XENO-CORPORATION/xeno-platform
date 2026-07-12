/**
 * Credit transaction helpers.
 *
 * HISTORY: these used to debit the legacy integer `users.credits` column directly
 * (SELECT ... FOR UPDATE; UPDATE users SET credits = credits - n). That is what made
 * `users.credits` drift BELOW the canonical v2 ledger (credit_accounts) — every spend
 * here bypassed the ledger, so the ledger (read by the Hub, the api-proxy gate, and
 * the chat meter) went stale and produced false "insufficient credits" 402s.
 *
 * NOW: these are a thin, signature-compatible bridge onto the authoritative v2 ledger
 * (utils/creditLedgerV2.js). `recordUsageV2` is idempotent, checks sufficiency, draws
 * down grant lots, writes the hash-chained journal entry, AND mirrors `users.credits =
 * floor(balance/1e6)`. `ensureAccount` seeds a missing ledger row FROM `users.credits`
 * then debits, so a first spend for a legacy-only account migrates it exactly once with
 * no double-count. Result: `users.credits` is a pure derived mirror on every path.
 *
 * Callers are unchanged: deductCredits/refundCredits keep { success, newBalance,
 * currentCredits? } and treat whole-credit `amount`. Pass an optional `meta`
 * ({ transactionId, surface, operation, model, provider, dimensions }) for richer
 * ledger attribution + idempotency; without it a per-call id is generated (matching
 * the legacy no-idempotency behaviour — no double-charge regression, no dedupe gain).
 */
import crypto from 'crypto';
import { recordUsageV2, addGrant, getBalanceV2, MICRO_PER_CREDIT } from './creditLedgerV2.js';

const wholeFromMicro = (micro) => Math.floor(Number(micro || 0) / MICRO_PER_CREDIT);

async function currentWholeCredits(db, userId) {
  try {
    const bal = await getBalanceV2(db, userId);
    return wholeFromMicro(bal.availableMicro ?? bal.postedMicro ?? 0);
  } catch { return null; }
}

export async function deductCredits(db, userId, amount, meta = {}) {
  const credits = Number(amount) || 0;
  if (credits <= 0) {
    return { success: true, newBalance: await currentWholeCredits(db, userId) };
  }
  const costMicro = Math.round(credits * MICRO_PER_CREDIT);
  const transactionId = meta.transactionId || meta.requestId || `legacy-debit:${crypto.randomUUID()}`;
  try {
    const r = await recordUsageV2(db, userId, {
      surface: meta.surface || 'legacy',
      operation: meta.operation || 'debit',
      model: meta.model ?? null,
      provider: meta.provider ?? null,
      transactionId,
      costMicro,
      dimensions: meta.dimensions || {},
    });
    return {
      success: true,
      ledger: true,
      newBalance: wholeFromMicro(r.balance?.postedMicro ?? r.balance?.availableMicro ?? 0),
    };
  } catch (e) {
    if (e.code === 'INSUFFICIENT_CREDITS') {
      return { success: false, currentCredits: (await currentWholeCredits(db, userId)) ?? 0 };
    }
    if (e.code === 'ACCOUNT_FROZEN') return { success: false, frozen: true, error: 'Account frozen' };
    if (e.code === 'SPEND_CAP_EXCEEDED') return { success: false, capExceeded: true, error: 'Spend cap exceeded' };
    throw e;
  }
}

export async function refundCredits(db, userId, amount, meta = {}) {
  const credits = Number(amount) || 0;
  if (credits <= 0) return { success: true, newBalance: await currentWholeCredits(db, userId) };
  // Restore balance on the ledger (mirrors users.credits). A refund reverses a
  // just-failed debit; kind:'promo' keeps it ahead of paid credits in drawdown.
  try {
    const g = await addGrant(db, userId, {
      amountMicro: Math.round(credits * MICRO_PER_CREDIT),
      kind: 'promo',
      sourceRef: meta.sourceRef || `refund:${meta.transactionId || crypto.randomUUID()}`,
    });
    return { success: true, newBalance: wholeFromMicro(g.balance?.postedMicro ?? g.balance?.availableMicro ?? 0) };
  } catch (e) {
    // Never let a refund failure crash the caller's error path.
    console.warn('[credits] refund failed:', e.message);
    return { success: false, error: e.message };
  }
}

export async function logUsage(db, userId, feature, amount, metadata = {}) {
  await db.query(
    `INSERT INTO credit_usage (user_id, feature, credits_used, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, feature, amount, JSON.stringify(metadata || {})],
  );
}

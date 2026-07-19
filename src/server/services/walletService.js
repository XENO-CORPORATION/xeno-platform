/**
 * Workspace billing (Phase 4) — workspace-owned wallets + pooled credits + budgets.
 *
 * A workspace wallet is a `credit_accounts` row keyed by the WORKSPACE uuid (in the
 * user_id column; owner_kind='workspace'). Because the v2 ledger API is parameterized
 * by that id, EVERY primitive (getBalanceV2/addGrant/recordUsageV2/holdV2/settle/
 * setSpendCap/drawdown) works on a workspace wallet with zero changes — we just pass
 * the workspace id where a user id would go. `mirrorLegacy(wsId)` is a harmless no-op
 * (no users row has that id). Budgets are enforced for free: recordUsageV2 already
 * calls assertWithinCaps, so a spend_cap on the workspace wallet caps its spend.
 */
import crypto from 'crypto';
import {
  getBalanceV2, addGrant, recordUsageV2, reverseUsage, setSpendCap, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';
import { check } from '../utils/authzReBAC.js';

export const wholeFromMicro = (m) => Math.floor(Number(m || 0) / MICRO_PER_CREDIT);

/**
 * Create the workspace's wallet row (owner_kind='workspace') if absent. Idempotent.
 * SAFETY: a conflict on an EXISTING row must never silently re-type it — the old
 * `ON CONFLICT DO UPDATE SET owner_kind='workspace'` would convert a PERSONAL
 * wallet into a workspace wallet if a workspace id ever collided with (or was
 * passed as) a user id, hijacking a user's money. Now: insert if absent; if a row
 * already exists it must ALREADY be a workspace wallet, else error loudly.
 */
export async function ensureWorkspaceWallet(db, workspaceId) {
  const ins = await db.query(
    `INSERT INTO credit_accounts (user_id, owner_kind, balance, lifetime_earned, lifetime_spent)
     VALUES ($1, 'workspace', 0, 0, 0)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id`,
    [workspaceId],
  );
  if (ins.rows.length > 0) return; // freshly created
  const existing = await db.query('SELECT owner_kind FROM credit_accounts WHERE user_id = $1', [workspaceId]);
  const kind = existing.rows[0]?.owner_kind;
  if (kind !== 'workspace') {
    console.error(`[wallet] ensureWorkspaceWallet REFUSED: wallet for ${workspaceId} exists with owner_kind='${kind}' — refusing to re-type a personal wallet as a workspace wallet`);
    const e = new Error(`wallet for ${workspaceId} already exists with owner_kind='${kind}' (refusing to convert)`);
    e.code = 'WALLET_KIND_CONFLICT';
    throw e;
  }
}

/** Balance view (whole credits + micro) for any subject id (user OR workspace). */
export async function walletBalance(db, subjectId) {
  const b = await getBalanceV2(db, subjectId);
  const micro = Number(b.postedMicro ?? b.availableMicro ?? 0);
  return {
    credits: wholeFromMicro(micro),
    availableMicro: Number(b.availableMicro ?? micro),
    postedMicro: micro,
    pendingMicro: Number(b.pendingMicro ?? 0),
    // getBalanceV2 now plumbs the account's real freeze state through balanceView.
    is_frozen: !!b.is_frozen,
  };
}

/**
 * Durable record of a FAILED saga compensation — money is in a known-bad state
 * (user debited, workspace not credited, reversal also failed) and an operator
 * must reconcile. Never throws (this is the last-resort recorder); if even the
 * insert fails it logs the full context so nothing is silently lost.
 */
async function recordCompensationFailure(db, { userId, workspaceId, amountMicro, txnRef, reason, error }) {
  const context = { workspaceId, reason, error: String(error?.message || error) };
  try {
    await db.query(
      `INSERT INTO ledger_compensation_failures (user_id, amount_micro, txn_ref, reason, context)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, String(amountMicro), txnRef, reason, JSON.stringify(context)],
    );
  } catch (insertErr) {
    console.error('[wallet] FAILED to persist ledger_compensation_failures row:', insertErr.message);
  }
  console.error(
    `[wallet] SAGA COMPENSATION FAILURE: user=${userId} workspace=${workspaceId} amount=${amountMicro}µcr `
    + `txnRef=${txnRef} reason=${reason} error=${String(error?.message || error)} — user was debited without the `
    + 'workspace being credited; manual reconciliation required (see ledger_compensation_failures)',
  );
}

/**
 * Move credits from a user's personal wallet INTO a workspace wallet. Saga:
 * debit the user (ledger, checks sufficiency) → grant the workspace; if the grant
 * fails, refund the user. Idempotent debit id. Amount is whole credits.
 */
export async function transferToWorkspace(db, fromUserId, workspaceId, credits) {
  const amount = Number(credits) || 0;
  if (amount <= 0) return { ok: false, status: 400, error: 'Amount must be positive' };
  const costMicro = Math.round(amount * MICRO_PER_CREDIT);
  const txnId = `ws-transfer:${crypto.randomUUID()}`;

  // 1) Debit the funding user's personal wallet (fails cleanly if insufficient).
  try {
    await recordUsageV2(db, fromUserId, {
      surface: 'workspace', operation: 'fund-transfer-out', transactionId: txnId, costMicro,
      dimensions: { workspaceId },
    });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_CREDITS') {
      const bal = await walletBalance(db, fromUserId).catch(() => ({ credits: 0 }));
      return { ok: false, status: 402, error: 'Insufficient personal credits', currentCredits: bal.credits };
    }
    if (e.code === 'ACCOUNT_FROZEN') return { ok: false, status: 403, error: 'Account frozen' };
    throw e;
  }

  // 2) Credit the workspace wallet. On failure, COMPENSATE with a proper
  // REVERSING entry keyed to the original debit's transactionId — reverseUsage
  // restores balance + decrements lifetime_spent + re-credits a neutral
  // paid-priority lot (the old addGrant(kind:'promo') compensation minted NEW
  // money: it inflated lifetime_earned and jumped the drawdown queue), and is
  // idempotent per txnId (uq_credit_txn_ref) so a crash-retry can't double-refund.
  // If the compensation ITSELF fails, write a durable failure record — never a
  // silent catch — so the debited-but-not-credited state is visible and fixable.
  try {
    await ensureWorkspaceWallet(db, workspaceId);
    await addGrant(db, workspaceId, { amountMicro: costMicro, kind: 'paid', sourceRef: txnId });
  } catch (e) {
    try {
      await reverseUsage(db, fromUserId, costMicro, {
        refId: txnId,
        description: `ws-transfer-rollback:${workspaceId}`,
      });
    } catch (compErr) {
      await recordCompensationFailure(db, {
        userId: fromUserId, workspaceId, amountMicro: costMicro, txnRef: txnId,
        reason: 'ws-transfer grant failed and reversal failed', error: compErr,
      });
    }
    throw e;
  }

  return {
    ok: true,
    workspace: await walletBalance(db, workspaceId),
    personal: await walletBalance(db, fromUserId),
    transferred: amount,
  };
}

/** Set a spend cap (budget) on the workspace wallet. windowSec default = 30 days. */
export async function setWorkspaceBudget(db, workspaceId, { credits, windowSec = 2592000 }) {
  await ensureWorkspaceWallet(db, workspaceId);
  const limitMicro = Math.max(0, Math.round((Number(credits) || 0) * MICRO_PER_CREDIT));
  await setSpendCap(db, workspaceId, { windowSec, limitMicro });
  return { ok: true, credits: Number(credits) || 0, windowSec };
}

/**
 * Decide which wallet a spend should bill. If a workspace context is present, the
 * workspace opts into pooled billing (metadata.billing_mode='pooled'), and the user
 * is a member → bill the WORKSPACE wallet; otherwise the user's personal wallet.
 * @returns {{ id: string, kind: 'user'|'workspace' }}
 */
export async function resolveBillingAccountId(db, userId, workspaceId) {
  if (!workspaceId) return { id: userId, kind: 'user' };
  const ws = (await db.query(
    "SELECT id, metadata FROM workspaces WHERE id = $1 AND status = 'active'", [workspaceId],
  )).rows[0];
  if (!ws) return { id: userId, kind: 'user' };
  const mode = ws.metadata?.billing_mode || 'personal';
  if (mode !== 'pooled') return { id: userId, kind: 'user' };
  const member = await check(db, { object: `workspace:${workspaceId}`, relation: 'member', subject: `user:${userId}` });
  if (!member.allowed) return { id: userId, kind: 'user' };
  return { id: workspaceId, kind: 'workspace' };
}

export default { ensureWorkspaceWallet, walletBalance, transferToWorkspace, setWorkspaceBudget, resolveBillingAccountId };

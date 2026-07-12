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
  getBalanceV2, addGrant, recordUsageV2, setSpendCap, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';
import { check } from '../utils/authzReBAC.js';

export const wholeFromMicro = (m) => Math.floor(Number(m || 0) / MICRO_PER_CREDIT);

/** Create the workspace's wallet row (owner_kind='workspace') if absent. Idempotent. */
export async function ensureWorkspaceWallet(db, workspaceId) {
  await db.query(
    `INSERT INTO credit_accounts (user_id, owner_kind, balance, lifetime_earned, lifetime_spent)
     VALUES ($1, 'workspace', 0, 0, 0)
     ON CONFLICT (user_id) DO UPDATE SET owner_kind = 'workspace'`,
    [workspaceId],
  );
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
    is_frozen: !!b.is_frozen,
  };
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

  // 2) Credit the workspace wallet. On failure, refund the user (saga rollback).
  try {
    await ensureWorkspaceWallet(db, workspaceId);
    await addGrant(db, workspaceId, { amountMicro: costMicro, kind: 'paid', sourceRef: txnId });
  } catch (e) {
    await addGrant(db, fromUserId, { amountMicro: costMicro, kind: 'promo', sourceRef: `refund:${txnId}` }).catch(() => {});
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

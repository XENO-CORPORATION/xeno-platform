/**
 * REGRESSION TEST — a credit wallet's `owner_kind` is never INFERRED.
 *
 * `credit_accounts.user_id` holds a bare SUBJECT id: a user id, a workspace id, or
 * (soon) an org id. `owner_kind` is the only thing that says which. `ensureAccount`
 * used to omit that column from its INSERT and let the DB default it to 'user', so
 * ANY ledger primitive called with a non-user subject silently minted a wallet typed
 * `owner_kind='user'` — after which `ensureWorkspaceWallet` threw WALLET_KIND_CONFLICT
 * for that subject FOREVER (it refuses, correctly, to re-type a wallet).
 *
 * That was reachable on live: index.js resolves pooled workspace billing to a WORKSPACE
 * id and hands it to meterPremiumChat → holdV2 → ensureAccount. The first pooled chat
 * for a workspace that had never been funded permanently wedged that workspace's wallet.
 *
 * The contract this test pins:
 *   (a) a real user's first touch still backfills from legacy `users.credits` (unchanged);
 *   (b) a non-user subject with NO asserted kind is REFUSED (SUBJECT_KIND_UNKNOWN) and
 *       NO wallet row is left behind — the ledger never guesses;
 *   (c) an explicitly-typed workspace wallet is created, correctly typed, and reusable —
 *       ensureWorkspaceWallet accepts it (the wedge is gone);
 *   (d) an EXISTING wallet is returned unchanged and is never re-typed;
 *   (e) a bogus ownerKind is rejected (INVALID_OWNER_KIND) rather than minting a new
 *       wallet species.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55499/t node tests/ledger-owner-kind.test.mjs
 */
import pg from 'pg';
import crypto from 'crypto';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  addGrant, recordUsageV2, holdV2, settleHoldV2, reverseUsage, clawback,
  getBalanceV2, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';
import { ensureWorkspaceWallet } from '../services/walletService.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

// Mirrors the LIVE baseline shape (00000000000000-baseline.sql:447): owner_kind is
// NOT NULL DEFAULT 'user' — the default that used to do the mis-typing.
const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) NOT NULL DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

const kindOf = async (id) => (await pool.query('SELECT owner_kind FROM credit_accounts WHERE user_id=$1', [id])).rows[0]?.owner_kind ?? null;
const walletCount = async (id) => (await pool.query('SELECT count(*)::int n FROM credit_accounts WHERE user_id=$1', [id])).rows[0].n;

/** Capture the error code of an awaited call that is EXPECTED to throw. */
async function codeOf(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.message; }
}

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);
  console.log('✓ migration applied\n');

  // ── (a) legacy migration path for a REAL user is unchanged ──────────────────
  console.log('(a) legacy users.credits → new user wallet');
  const legacyUser = crypto.randomUUID();
  await pool.query('INSERT INTO users (id, credits) VALUES ($1, 25)', [legacyUser]);
  // No explicit ownerKind — a users row exists, so the kind is PROVEN, not guessed.
  await addGrant(pool, legacyUser, { amountMicro: C(10), kind: 'paid', sourceRef: `seed:${legacyUser}` });
  const legacyBal = await getBalanceV2(pool, legacyUser);
  ok(legacyBal.postedMicro === C(35), `legacy 25 credits seeded + 10 granted = 35 (got ${legacyBal.postedMicro / MICRO_PER_CREDIT})`);
  ok(await kindOf(legacyUser) === 'user', 'new user wallet is owner_kind=user');

  // A brand-new user with no legacy balance still works, and a spend still lands.
  const freshUser = crypto.randomUUID();
  await pool.query('INSERT INTO users (id, credits) VALUES ($1, 0)', [freshUser]);
  await addGrant(pool, freshUser, { amountMicro: C(50), kind: 'free', sourceRef: `seed:${freshUser}` });
  await recordUsageV2(pool, freshUser, {
    surface: 'ai_chat', operation: 'chat.completion', transactionId: `t:${crypto.randomUUID()}`, costMicro: C(20),
  });
  ok((await getBalanceV2(pool, freshUser)).postedMicro === C(30), 'fresh user: 50 granted − 20 spent = 30');
  ok(await kindOf(freshUser) === 'user', 'fresh user wallet is owner_kind=user');

  // The legacy seed also works when the FIRST touch is a spend (not a grant).
  const spendFirst = crypto.randomUUID();
  await pool.query('INSERT INTO users (id, credits) VALUES ($1, 8)', [spendFirst]);
  await recordUsageV2(pool, spendFirst, {
    surface: 'ai_chat', operation: 'chat.completion', transactionId: `t:${crypto.randomUUID()}`, costMicro: C(3),
  });
  ok((await getBalanceV2(pool, spendFirst)).postedMicro === C(5), 'spend-first user: legacy 8 seeded then 3 spent = 5');
  ok(await kindOf(spendFirst) === 'user', 'spend-first wallet is owner_kind=user');

  // ── (b) a NON-USER subject with no asserted kind is REFUSED ─────────────────
  console.log('\n(b) unknown subject is refused, never typed by default');
  const orphanWs = crypto.randomUUID(); // a workspace id: no `users` row exists for it

  ok(await codeOf(() => holdV2(pool, orphanWs, {
    holdId: `h:${crypto.randomUUID()}`, amountMicro: C(1), surface: 'ai_chat', operation: 'chat.completion',
  })) === 'SUBJECT_KIND_UNKNOWN', 'holdV2 on an untyped subject → SUBJECT_KIND_UNKNOWN');
  ok(await walletCount(orphanWs) === 0, 'holdV2 refusal left NO wallet row behind');

  ok(await codeOf(() => addGrant(pool, orphanWs, { amountMicro: C(5), kind: 'paid', sourceRef: `x:${crypto.randomUUID()}` }))
    === 'SUBJECT_KIND_UNKNOWN', 'addGrant on an untyped subject → SUBJECT_KIND_UNKNOWN');
  ok(await codeOf(() => recordUsageV2(pool, orphanWs, {
    surface: 'ai_chat', operation: 'chat.completion', transactionId: `t:${crypto.randomUUID()}`, costMicro: C(1),
  })) === 'SUBJECT_KIND_UNKNOWN', 'recordUsageV2 on an untyped subject → SUBJECT_KIND_UNKNOWN');
  ok(await codeOf(() => reverseUsage(pool, orphanWs, C(1), { refId: `r:${crypto.randomUUID()}` }))
    === 'SUBJECT_KIND_UNKNOWN', 'reverseUsage on an untyped subject → SUBJECT_KIND_UNKNOWN');
  ok(await codeOf(() => clawback(pool, orphanWs, C(1), { refId: `c:${crypto.randomUUID()}` }))
    === 'SUBJECT_KIND_UNKNOWN', 'clawback on an untyped subject → SUBJECT_KIND_UNKNOWN');
  ok(await walletCount(orphanWs) === 0, 'after every refused primitive, still NO wallet row');

  // THE REGRESSION ITSELF: the old code minted owner_kind='user' here, permanently
  // wedging ensureWorkspaceWallet for this workspace. It must now still be adoptable.
  await ensureWorkspaceWallet(pool, orphanWs);
  ok(await kindOf(orphanWs) === 'workspace', 'the refused subject is still adoptable as a workspace wallet (no wedge)');

  // ── (c) an explicitly-typed workspace wallet is created and reusable ────────
  console.log('\n(c) explicit ownerKind creates a correctly typed wallet');
  const ws = crypto.randomUUID();
  await addGrant(pool, ws, { amountMicro: C(100), kind: 'paid', sourceRef: `ws:${crypto.randomUUID()}`, ownerKind: 'workspace' });
  ok(await kindOf(ws) === 'workspace', 'addGrant(ownerKind:workspace) created owner_kind=workspace');
  ok((await getBalanceV2(pool, ws)).postedMicro === C(100), 'workspace wallet funded to 100');
  // ensureWorkspaceWallet must ACCEPT a wallet the ledger created — this is the exact
  // assertion that failed (WALLET_KIND_CONFLICT) under the defect.
  ok(await codeOf(() => ensureWorkspaceWallet(pool, ws)) === null, 'ensureWorkspaceWallet accepts the ledger-created workspace wallet');

  // The full pooled-billing shape: hold → settle against the WORKSPACE wallet.
  const wsHold = `h:${crypto.randomUUID()}`;
  await holdV2(pool, ws, {
    holdId: wsHold, amountMicro: C(40), surface: 'ai_chat', operation: 'chat.completion', ownerKind: 'workspace',
  });
  ok((await getBalanceV2(pool, ws)).availableMicro === C(60), 'hold of 40 reserves against the workspace wallet');
  await settleHoldV2(pool, ws, wsHold, C(15), { ownerKind: 'workspace' });
  ok((await getBalanceV2(pool, ws)).postedMicro === C(85), 'settle 15 of a 40 hold → workspace posted 85');
  ok(await kindOf(ws) === 'workspace', 'workspace wallet kind survived hold+settle');

  // A workspace subject reached WITHOUT the kind, once the wallet already exists, is
  // fine — the existing row answers the question, so pooled billing keeps working.
  await recordUsageV2(pool, ws, {
    surface: 'ai_chat', operation: 'chat.completion', transactionId: `t:${crypto.randomUUID()}`, costMicro: C(5),
  });
  ok((await getBalanceV2(pool, ws)).postedMicro === C(80), 'existing workspace wallet spends fine without an asserted kind');

  // ── (d) an EXISTING wallet is returned unchanged, never re-typed ────────────
  console.log('\n(d) existing wallets are never re-typed');
  const balBefore = (await getBalanceV2(pool, legacyUser)).postedMicro;
  // A caller wrongly asserting 'workspace' over a real USER wallet must NOT convert it,
  // and must NOT fail the spend (a bookkeeping discrepancy is logged, not an outage).
  await addGrant(pool, legacyUser, { amountMicro: C(1), kind: 'paid', sourceRef: `mis:${crypto.randomUUID()}`, ownerKind: 'workspace' });
  ok(await kindOf(legacyUser) === 'user', 'mis-asserted ownerKind did NOT re-type an existing user wallet');
  ok((await getBalanceV2(pool, legacyUser)).postedMicro === balBefore + C(1), 'the mis-asserted grant still posted (no outage)');
  ok(await walletCount(legacyUser) === 1, 'still exactly one wallet row for the subject');

  // ── (e) a bogus ownerKind is rejected outright ──────────────────────────────
  console.log('\n(e) bogus ownerKind is rejected');
  const bogus = crypto.randomUUID();
  ok(await codeOf(() => addGrant(pool, bogus, { amountMicro: C(1), kind: 'paid', sourceRef: `b:${crypto.randomUUID()}`, ownerKind: 'workspaces' }))
    === 'INVALID_OWNER_KIND', "ownerKind 'workspaces' (typo) → INVALID_OWNER_KIND");
  ok(await walletCount(bogus) === 0, 'the typo minted no wallet');

  // An 'org' subject is a first-class kind (the next consumer of this contract).
  const org = crypto.randomUUID();
  await addGrant(pool, org, { amountMicro: C(7), kind: 'paid', sourceRef: `o:${crypto.randomUUID()}`, ownerKind: 'org' });
  ok(await kindOf(org) === 'org', "ownerKind 'org' creates an owner_kind=org wallet");

  console.log(`\n${fail === 0 ? '✅' : '❌'} ledger-owner-kind: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });

/**
 * XENO-WORKFORCE-01 LIFE-09 -- capacity is DERIVED, never declared.
 *
 *   LIFE-09: "How much a workforce can take on is a projection over active admissions, remaining
 *             budget envelopes (RUN-10) and in-flight runs -- the same discipline as DIV-07's
 *             ledger-derived balance. A stored headcount or capacity number is a cache with no
 *             invalidation, which is the failure mode this estate records most often."
 *
 * `readWorkforceCapacity(pool, ctx, { owner, expectedActorAccountId })` answers "what is this scope
 * running, what has it committed to spend, and what can its payers still fund" -- computed at the
 * moment of the read from the rows that decide it, in one transaction:
 *   - the scope's runs from `workforce_scope_capacity` (20260927100000-workforce-derived-capacity.sql),
 *     a VIEW over admissions, revocations and leases;
 *   - each active payer's headroom from `credit_accounts` and `credit_holds`, with the SAME
 *     arithmetic admission uses to refuse a budget (workforceRunAdmission.js). It is read here rather
 *     than in a view because credit_holds is created after the versioned chain runs.
 * Nothing is written and no number is kept, so there is nothing to invalidate.
 *
 * WHO MAY ASK: exactly who may read the scope's catalog -- the catalog's own `authorizeRead`, imported
 * rather than copied, so the two can never disagree: the owner of a personal scope, a viewer of a
 * workspace. A scope the caller cannot read answers identically to one that does not exist.
 * A payer's balance is disclosed ONLY to that payer or to a workspace administrator of the scope: a
 * viewer learns that runs are funded, not how much another person holds.
 *
 * RUN-10 (2026-09-27, 20260927110000-workforce-nested-run-envelopes.sql): a nested run is carved out of
 * its parent's envelope, so its ceiling is already inside its root's. `committedCeilingMicro` therefore
 * counts each root envelope once, while `activeAdmissions` counts every active run.
 * Ordinary unfunded admissions retain that compatibility projection. Pool commitments
 * instead follow their actual canonical root holds: revocation and expiry are NOT
 * settlement. Held pool payers stay visible even after authority stops, and settled
 * or proved-undispatched holds stop counting. Pool headroom excludes expired and
 * quarantined contribution lots. These are financial headroom figures, not a claim
 * that every provider is eligible for bounded pool dispatch.
 */
import { normalizeOwnerScope } from './workforceScope.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';
import { authorizeRead } from './workforceCatalog.js';

export class WorkforceCapacityError extends Error {
  constructor(code = 'denied', reason = 'capacity_unavailable') {
    super(code === 'bad_input' ? 'Invalid workforce capacity request.' : 'Workforce capacity unavailable.');
    this.name = 'WorkforceCapacityError';
    this.code = code;
    this.status = code === 'bad_input' ? 400 : 403;
    this.details = Object.freeze({ schemaVersion: 1, reason });
  }
}
const fail = (code, reason) => { throw new WorkforceCapacityError(code, reason); };
const uuid = (value) => normalizeOwnerScope({ type: 'user', id: value }).id;

function input(context, value) {
  const record = (v, allowed) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('bad_input', 'invalid_capacity_shape');
    for (const key of Object.keys(v)) if (!allowed.includes(key)) fail('bad_input', 'invalid_capacity_shape');
    return v;
  };
  const ctx = record(context, ['actorUserId', 'clientId', 'apiKeyId']);
  if (typeof ctx.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ctx.clientId)) fail('bad_input', 'invalid_capacity_context');
  const body = record(value, ['owner', 'expectedActorAccountId']);
  let owner, actorUserId, expected;
  try {
    owner = normalizeOwnerScope(body.owner);
    actorUserId = uuid(ctx.actorUserId);
    expected = uuid(body.expectedActorAccountId);
  } catch { fail('bad_input', 'invalid_capacity_shape'); }
  if (expected !== actorUserId) fail('denied', 'actor_precondition_mismatch');
  return { actor: { actorUserId, clientId: ctx.clientId, ...(Object.hasOwn(ctx, 'apiKeyId') ? { apiKeyId: uuid(ctx.apiKeyId) } : {}) }, owner };
}

/** The catalog's read rule decides WHO; this only adds whether they administer the scope. Its denial
 * is the catalog's own error, so denied and missing answer identically here too. */
async function readableScope(db, actorUserId, owner) {
  const principal = await authorizeRead(db, actorUserId, owner);
  const subject = `${principal.kind === 'agent' ? 'agent' : 'user'}:${principal.id}`;
  const admin = principal.kind === 'human' && (owner.type === 'user'
    || (await check(db, { object: `workspace:${owner.id}`, subject, relation: 'admin' })).allowed);
  return { principal, admin };
}

export async function readWorkforceCapacity(pool, authenticatedContext, value) {
  const { actor, owner } = input(authenticatedContext, value);
  return authorityTransaction(pool, async (db) => {
    // Every figure in this response describes one database snapshot, including
    // concurrent hold -> settle transitions across the canonical tables.
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const { principal, admin } = await readableScope(db, actor.actorUserId, owner);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const row = (await db.query('SELECT * FROM workforce_scope_capacity WHERE scope_type=$1 AND scope_id=$2', [owner.type, owner.id])).rows[0];
    // Pool liability survives revocation and clock expiry; admission activity is
    // not a financial release. Keep unresolved payers visible after work stops.
    const roots=(await db.query(`SELECT a.payer_user_id,h.state,h.amount_micro,h.settled_micro
      FROM workforce_run_admissions a JOIN workforce_run_funding f ON f.admission_id=a.id
      JOIN credit_holds h ON h.id=f.hold_row_id
      WHERE a.parent_admission_id IS NULL AND
        (($1='workspace' AND a.target_workspace_id=$2) OR
         ($1='user' AND a.target_workspace_id IS NULL AND a.target_owner_user_id=$2))`,[owner.type,owner.id])).rows;
    const ordinary=(await db.query(`SELECT COALESCE(sum(budget_ceiling_micro),0)::text AS total
      FROM workforce_run_admissions a WHERE a.payer_kind='user' AND a.parent_admission_id IS NULL
        AND workforce_run_admission_fence(a.id) IS NULL
        AND (($1='workspace' AND a.target_workspace_id=$2) OR
          ($1='user' AND a.target_workspace_id IS NULL AND a.target_owner_user_id=$2))`,[owner.type,owner.id])).rows[0].total;
    const committed=BigInt(ordinary)+roots.filter(r=>r.state==='held').reduce((n,r)=>n+BigInt(r.amount_micro)-BigInt(r.settled_micro),0n);
    const payers = [...new Set([...(row?.active_payers??[]),...roots.filter(r=>r.state==='held').map(r=>r.payer_user_id)])];
    const funding = [];
    for (const payer of [...payers].sort()) {
      const acct = (await db.query('SELECT balance, is_frozen,owner_kind FROM credit_accounts WHERE user_id=$1', [payer])).rows[0];
      const isPool=acct?.owner_kind==='project_pool';
      const held = BigInt((await db.query(`SELECT coalesce(sum(amount_micro - settled_micro),0)::text AS h FROM credit_holds
        WHERE user_id=$1 AND state='held' AND ($2::boolean OR expires_at > now())`, [payer,isPool])).rows[0].h);
      let available = acct ? BigInt(acct.balance) - held : 0n;
      if(isPool) {
        const eligible=(await db.query(`SELECT COALESCE(sum(GREATEST(0,g.remaining_micro-COALESCE((SELECT sum(f.reserved_micro)
          FROM credit_hold_funding f JOIN credit_holds h ON h.id=f.hold_row_id WHERE f.grant_id=g.id AND h.state='held'),0))),0)::text AS total
          FROM credit_grants g JOIN workforce_contribution_lots l ON l.pool_grant_id=g.id
          JOIN workforce_funding_contributions c ON c.id=l.contribution_id
          WHERE g.user_id=$1 AND g.kind='contribution' AND c.state='confirmed' AND g.remaining_micro>0
            AND (g.expires_at IS NULL OR g.expires_at>now())
            AND NOT EXISTS(SELECT 1 FROM workforce_funding_origin_quarantine q WHERE q.grant_id=l.origin_grant_id)`,[payer])).rows[0].total;
        if(available>BigInt(eligible))available=BigInt(eligible);
      }
      const canFund = Boolean(acct) && !acct.is_frozen && available > 0n;
      // A payer's own balance is theirs; a workspace administrator may see it for runs in their scope.
      const mayDisclose = admin || payer === (principal.kind === 'human' ? principal.id : principal.owner.id);
      funding.push({ payerUserId: payer, canFund, ...(mayDisclose ? { availableMicro: (available < 0n ? 0n : available).toString() } : {}) });
    }
    return {
      schemaVersion: 1, owner,
      derivedAt: (await db.query('SELECT clock_timestamp() AS t')).rows[0].t.toISOString(),
      activeAdmissions: Number(row?.active_admissions ?? 0),
      inFlightRuns: Number(row?.in_flight_runs ?? 0),
      activeAgents: Number(row?.active_agents ?? 0),
      committedCeilingMicro: String(committed),
      funding,
    };
  });
}

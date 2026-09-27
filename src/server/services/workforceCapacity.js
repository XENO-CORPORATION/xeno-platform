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
 * sums ROOT admissions only -- each approved envelope once -- while `activeAdmissions` counts every run,
 * and a run fenced by a stopped ancestor is not active. Both come from the views, not from here.
 *
 * NOT CLAIMED: FUND-06's pooled envelope does not exist, so there is no pool to report beyond each payer's
 * headroom. Those are reported per payer rather than summed into a pool no ledger holds.
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
    const { principal, admin } = await readableScope(db, actor.actorUserId, owner);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:read');
    const row = (await db.query('SELECT * FROM workforce_scope_capacity WHERE scope_type=$1 AND scope_id=$2', [owner.type, owner.id])).rows[0];
    const payers = row?.active_payers ?? [];
    const funding = [];
    for (const payer of [...payers].sort()) {
      const acct = (await db.query('SELECT balance, is_frozen FROM credit_accounts WHERE user_id=$1', [payer])).rows[0];
      const held = BigInt((await db.query(`SELECT coalesce(sum(amount_micro - settled_micro),0)::text AS h FROM credit_holds
        WHERE user_id=$1 AND state='held' AND expires_at > now()`, [payer])).rows[0].h);
      const available = acct ? BigInt(acct.balance) - held : 0n;
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
      committedCeilingMicro: String(row?.committed_ceiling_micro ?? '0'),
      funding,
    };
  });
}

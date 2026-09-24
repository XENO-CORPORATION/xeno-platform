/**
 * Marketplace broker -- XENO-WORKFORCE-01 MKT-06:
 *   "Broker invocation must create/adopt a durable hosted run, expose actual queued/running/completed/
 *    failed/interrupted state and return artifacts/results. Authorization or a debit alone cannot report
 *    `brokered:true` or completion. No debit for an execution that was never admitted; uncertain dispatch
 *    is reconciled before retry."
 *
 * The hosted run lives in xeno-agents-api. The platform does not run anything itself: it records the
 * INVOCATION durably, asks agents-api to create the run AS THE BUYER, and afterwards only relays the
 * run's real state. Four decisions, each forced by the requirement:
 *
 *  1. THE BUYER OWNS THE RUN. agents-api authenticates every caller against the platform and scopes runs
 *     to that user, so the run is created with a short-lived access token for the buyer. It is minted by
 *     this platform (it IS the OIDC issuer) on its own session, carries `act: { sub: 'xeno-marketplace' }`
 *     (RFC 8693) so the delegation is visible, and is revocable by ending that one session.
 *     There is no service-to-service shortcut in agents-api to trust, and none is added.
 *
 *  2. MONEY FOLLOWS ADMISSION, NOT THE REQUEST. agents-api places the ledger hold when it admits the run
 *     and settles it from real usage when the run ends (with a heartbeat keeping it alive -- FUND-09). The
 *     platform debits NOTHING here. A run agents-api refused has no hold and costs nothing; a run it
 *     admitted is billed exactly once, by the service that knows what it consumed.
 *
 *  3. UNCERTAIN DISPATCH IS RECONCILED, NEVER RE-SENT BLINDLY. The invocation row is written BEFORE the
 *     call with a deterministic Idempotency-Key; agents-api returns the same run for the same key. A retry
 *     of an invocation whose first response was lost therefore adopts the run that was created, rather
 *     than creating a second one.
 *
 *  4. STATE IS OBSERVED, NOT ASSERTED. `brokered` is never set by this module. The response carries the
 *     run id and the status agents-api reported; GET /invocations/:id re-reads it.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getSigningKey, ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_TYP } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';

export const BROKER_ACTOR = 'xeno-marketplace';
const DELEGATED_TTL_SEC = 5 * 60;
const TERMINAL = new Set(['completed', 'failed', 'skipped', 'cancelled', 'interrupted']);

export class BrokerUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'BrokerUnavailableError'; this.code = 'broker_unavailable'; }
}

export function agentsApiBaseUrl(env = process.env) {
  return String(env.AGENTS_API_BASE_URL || '').replace(/\/+$/, '');
}

/**
 * A short-lived access token for `userId`, minted on its own one-purpose OIDC session so it passes the
 * ordinary session checks and can be revoked without touching any of the user's own sessions.
 */
export async function mintDelegatedAccessToken(db, userId, { invocationId }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  await db.query(
    `INSERT INTO oauth_user_auth_epochs (user_id, epoch) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const epoch = Number((await db.query('SELECT epoch FROM oauth_user_auth_epochs WHERE user_id = $1', [userId])).rows[0].epoch);
  await db.query(
    `INSERT INTO oauth_session_state (sid, user_id, auth_epoch, auth_time, dpop_jkt, expires_at)
     VALUES ($1, $2, $3, now(), NULL, now() + ($4 || ' seconds')::interval)`,
    [sid, userId, epoch, String(DELEGATED_TTL_SEC)],
  );
  // Recorded against the invocation, so an audit can list every credential the broker minted for it.
  await db.query(
    'UPDATE marketplace_invocations SET delegated_sids = array_append(delegated_sids, $2::uuid) WHERE id = $1',
    [invocationId, sid],
  );
  const token = jwt.sign(
    {
      iss: issuer(), iat: now, sub: userId, aud: ACCESS_TOKEN_AUDIENCE,
      client_id: BROKER_ACTOR, azp: BROKER_ACTOR, scope: 'agents:run',
      act: { sub: BROKER_ACTOR, invocation_id: invocationId },
      sid, auth_epoch: epoch, auth_time: now, typ: ACCESS_TOKEN_TYP,
    },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn: DELEGATED_TTL_SEC, header: { typ: ACCESS_TOKEN_TYP, kid: key.kid } },
  );
  return { token, sid };
}

async function revokeDelegatedSession(db, sid) {
  await db.query('UPDATE oauth_session_state SET revoked_at = now() WHERE sid = $1 AND revoked_at IS NULL', [sid]);
}

function publicInvocation(row) {
  return {
    id: row.id,
    listingId: row.listing_id,
    access: row.access,
    bindingId: row.binding_id ?? null,
    servingVersionId: row.serving_version_id ?? null,
    state: row.state,
    runId: row.run_id,
    runStatus: row.run_status,
    runStatusReason: row.run_status_reason,
    creditsHeld: row.credits_held == null ? null : Number(row.credits_held),
    creditsSettled: row.credits_settled == null ? null : Number(row.credits_settled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function applyRun(db, invocationId, run) {
  const r = await db.query(
    `UPDATE marketplace_invocations
        SET run_id = COALESCE(run_id, $2), run_status = $3, run_status_reason = $4,
            credits_held = $5, credits_settled = $6,
            state = CASE WHEN $7 THEN 'finished' ELSE 'dispatched' END, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [invocationId, run.runId, run.status, run.statusReason ?? null,
     run.creditsHeld ?? null, run.creditsSettled ?? null, TERMINAL.has(run.status)],
  );
  return r.rows[0];
}

/**
 * Create (or adopt) the hosted run for an invocation. Returns the invocation after the call, whatever
 * happened: `dispatched`/`finished` with a real run, `refused` when agents-api declined to admit it
 * (nothing held, nothing charged), or `uncertain` when the outcome is unknown -- the next call with the
 * same invocation adopts whatever run was created.
 */
export async function dispatchInvocation(db, { invocation, user, listing, version, prompt, fetchImpl = fetch, env = process.env }) {
  const base = agentsApiBaseUrl(env);
  if (!base) throw new BrokerUnavailableError('AGENTS_API_BASE_URL is not configured');
  const { token, sid } = await mintDelegatedAccessToken(db, user.id, { invocationId: invocation.id });
  try {
    let res;
    try {
      res = await fetchImpl(`${base}/runs`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          // Deterministic per invocation: a retry after a lost response returns the SAME run.
          'idempotency-key': `mkt-invocation:${invocation.id}`,
        },
        body: JSON.stringify({
          prompt,
          title: `${listing.title}`.slice(0, 200),
          agent: {
            name: listing.slug,
            description: `marketplace ${listing.kind} ${listing.id}${version ? ` v${version.version}` : ''}`,
          },
          ...(invocation.max_credits != null ? { budget: { maxCredits: Number(invocation.max_credits) } } : {}),
        }),
      });
    } catch {
      return markUncertain(db, invocation.id, 'transport_error');
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body?.run?.runId) return applyRun(db, invocation.id, body.run);
    // A definite refusal: agents-api did not admit the run, so no hold exists and nothing is owed.
    if (res.status >= 400 && res.status < 500) {
      // agents-api's envelope is strictly { error: "<code>" } (app.ts setErrorHandler); the object
      // form is accepted too so a future envelope change does not silently erase the reason.
      const code = (typeof body?.error === 'string' ? body.error : body?.error?.code)
        || body?.code || `http_${res.status}`;
      const r = await db.query(
        `UPDATE marketplace_invocations SET state = 'refused', run_status_reason = $2, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [invocation.id, String(code).slice(0, 120)],
      );
      return r.rows[0];
    }
    return markUncertain(db, invocation.id, `http_${res.status}`);
  } finally {
    await revokeDelegatedSession(db, sid);
  }
}

async function markUncertain(db, invocationId, reason) {
  const r = await db.query(
    `UPDATE marketplace_invocations SET state = 'uncertain', run_status_reason = $2, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [invocationId, reason],
  );
  return r.rows[0];
}

/** Re-read the run's real state from agents-api. An uncertain dispatch is reconciled by re-dispatching
 * with the same idempotency key, which adopts the run if it was created and creates it if it was not. */
export async function refreshInvocation(db, { invocation, user, listing, version, fetchImpl = fetch, env = process.env }) {
  if (invocation.state === 'uncertain' || invocation.state === 'pending') {
    return dispatchInvocation(db, { invocation, user, listing, version, prompt: invocation.prompt, fetchImpl, env });
  }
  if (!invocation.run_id || invocation.state === 'finished' || invocation.state === 'refused') return invocation;
  const base = agentsApiBaseUrl(env);
  if (!base) throw new BrokerUnavailableError('AGENTS_API_BASE_URL is not configured');
  const { token, sid } = await mintDelegatedAccessToken(db, user.id, { invocationId: invocation.id });
  try {
    let res;
    try {
      res = await fetchImpl(`${base}/runs/${encodeURIComponent(invocation.run_id)}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
    } catch {
      return invocation;   // the run exists; an unreachable reader changes nothing about it
    }
    const body = await res.json().catch(() => null);
    return res.ok && body?.run?.runId ? applyRun(db, invocation.id, body.run) : invocation;
  } finally {
    await revokeDelegatedSession(db, sid);
  }
}

export async function createInvocation(db, { user, listing, access, prompt, maxCredits, binding = null }) {
  // A rental invocation carries the binding it runs under and the serving version it pins (MKT-05),
  // so the work stays attributable after the rental ends; the table refuses a rental row without both.
  const r = await db.query(
    `INSERT INTO marketplace_invocations
       (user_id, listing_id, access, prompt, max_credits, state, binding_id, serving_version_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *`,
    [user.id, listing.id, access, prompt, maxCredits ?? null, binding?.id ?? null, binding?.serving_version_id ?? null],
  );
  return r.rows[0];
}

export async function getInvocation(db, userId, id) {
  const r = await db.query('SELECT * FROM marketplace_invocations WHERE id = $1 AND user_id = $2', [id, userId]);
  return r.rows[0] || null;
}

export { publicInvocation, TERMINAL as TERMINAL_RUN_STATUSES };

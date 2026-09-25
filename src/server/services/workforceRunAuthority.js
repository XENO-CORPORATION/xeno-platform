/**
 * XENO-WORKFORCE-01 RUN-03 / NFR-06 / NFR-10 -- live authority for an ADMITTED run.
 *
 *   RUN-03: "Pins preserve reproducibility; live revocation still overrides pinned grants before each
 *            privileged call and new provider dispatch. On lost authority, checkpoint/stop according to
 *            the bounded lease policy; never spend indefinitely offline."
 *   NFR-06: "Connected revocation blocks the next privileged operation; disconnected execution uses
 *            explicit short-lived admission leases, maximum 60 seconds, and then checkpoints/blocks."
 *   NFR-10: "The 60-second lease uses signed/validated expiry and a monotonic elapsed-time bound from
 *            receipt, with conservative clock-skew allowance. It cannot restart from zero after process
 *            restart, wall-clock rollback or reconnect. Without reliable remaining-validity proof,
 *            require online re-admission."
 *
 * An admission (workforceRunAdmission.js) decides that a run may START. It pins the definition -- the
 * version and content hash the run executes -- and that pin is what makes a run reproducible. It does
 * NOT pin authority: everything the admission was granted can be taken away while the run is alive.
 *
 * `authorizeRunStep(pool, ctx, { admissionId, operation, capability })` is the question the runtime asks
 * before each privileged call and each new provider dispatch. It re-derives every term of the admission
 * from the LIVE rows the admission named -- the actor, the agent and its pin, the assignment or
 * participation and its effective policy now, the team membership, the entitlement, the payer's
 * account -- and never from the admission's own snapshot. The answer is the intersection of the
 * admission's effective set with what is still live: authority only ever NARROWS after admission.
 *
 * A passing answer carries a LEASE: an ES256 JWS signed with the platform's OIDC key (verifiable against
 * the published JWKS), valid for at most 60 seconds, bound to one admission and one monotonic sequence.
 * The runtime may act within its effective set until the lease expires, and then it must ask again --
 * which is how a disconnected worker is bounded: it cannot spend past the lease it holds, and it cannot
 * mint a newer one. `verifyRunLease` is the reference verifier, and it is where NFR-10's rules live:
 * signature and claims, `exp` minus the allowed skew, and the monotonic bound measured from RECEIPT --
 * a runtime that records when it received the lease (from a monotonic clock) is bounded by that elapsed
 * time even if the wall clock is wound back.
 *
 * ── WHAT "LOST AUTHORITY" MEANS HERE ───────────────────────────────────────────────────────────
 * Any term failing refuses the step with a typed reason AND, for a terminal loss (the assignment was
 * revoked, the actor suspended, the entitlement expired, the agent archived), writes a durable
 * revocation. A revocation fences every earlier lease: `readRunAuthority` reports the admission as
 * revoked, and the database refuses to issue another lease under it. A transient refusal (the payer
 * cannot fund this step right now) does not revoke -- a top-up must be able to resume the run.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 * It never releases or voids a hold. FUND-09 forbids releasing a reservation because authority or a
 * lease lapsed, and NFR-06 keeps dispatched noncancellable work visible until it settles. Revoking
 * authority stops NEW work; the ledger settles what already ran.
 */
import crypto from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority } from './workspaceOperationReceipts.js';
import { lockApiKeyWorkforceAuthority } from './apiKeyWorkforceAuthority.js';
import { RunAdmissionError } from './workforceRunAdmission.js';

/** NFR-06: "maximum 60 seconds". The database CHECK holds the same bound independently. */
export const RUN_LEASE_MAX_SECONDS = 60;
/** NFR-10: a conservative allowance for the verifier's clock being AHEAD of the issuer's. */
export const RUN_LEASE_SKEW_SECONDS = 5;
export const RUN_LEASE_TYP = 'xeno-run-lease+jwt';

const fail = (code, reason, extra) => { throw new RunAdmissionError(code, reason, extra); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Terminal losses revoke durably; everything else refuses this step only. */
const TERMINAL = new Map([
  ['actor_unavailable', 'authority_lost'], ['agent_not_found', 'authority_lost'], ['agent_version_withdrawn', 'authority_lost'],
  ['assignment_not_live', 'authority_lost'], ['participation_not_live', 'authority_lost'], ['project_not_live', 'authority_lost'],
  ['actor_cannot_act_for_target', 'authority_lost'], ['actor_not_an_admitted_member', 'authority_lost'],
  ['observer_cannot_dispatch', 'authority_lost'], ['agent_not_an_admitted_member', 'authority_lost'],
  ['entitlement_not_live', 'authority_lost'], ['root_binding_not_live', 'authority_lost'],
]);

async function livePrincipal(db, userId) {
  const principal = await resolvePrincipal(db, userId);
  if (!principal?.usable || !['human', 'agent'].includes(principal.kind)) return null;
  if (principal.kind === 'agent') {
    const owner = await resolvePrincipal(db, principal.owner.id);
    if (!owner?.usable || owner.kind !== 'human') return null;
  }
  return { principal, subject: `${principal.kind === 'agent' ? 'agent' : 'user'}:${principal.id}` };
}

async function actsForWorkspace(db, who, workspaceId) {
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [workspaceId])).rows[0]?.status;
  if (status !== 'active') return false;
  const verdict = await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: who.subject });
  return verdict.allowed && ['direct', 'role-hierarchy'].includes(verdict.via);
}

/**
 * Re-derive every term of an admission from live rows. Returns the capabilities still live, or throws
 * the typed reason of the FIRST term that no longer holds. Reads, never writes.
 */
async function liveTerms(db, row) {
  const who = await livePrincipal(db, row.actor_user_id);
  if (!who) fail('denied', 'actor_unavailable');

  // The pin itself does not move: the admitted version must still exist and the agent still be active.
  // A NEWER version does not revoke the run -- that is exactly what a pin is for.
  const agent = (await db.query(`SELECT * FROM workforce_resources WHERE id=$1 AND kind='agent' FOR SHARE`, [row.agent_resource_id])).rows[0];
  if (!agent || agent.status !== 'active') fail('denied', 'agent_not_found');
  const pinned = (await db.query('SELECT content_hash FROM workforce_agent_versions WHERE resource_id=$1 AND version=$2',
    [row.agent_resource_id, row.agent_version])).rows[0];
  if (!pinned || pinned.content_hash !== row.agent_content_hash) fail('denied', 'agent_version_withdrawn');

  let targetTerm;
  if (row.target_kind === 'personal') {
    if (agent.owner_user_id !== row.target_owner_user_id) fail('denied', 'actor_cannot_act_for_target');
    const self = who.principal.kind === 'human' ? who.principal.id : who.principal.owner?.id;
    if (self !== row.target_owner_user_id) fail('denied', 'actor_cannot_act_for_target');
    targetTerm = row.rights.definition;
  } else if (row.target_kind === 'workspace') {
    const a = (await db.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1 FOR SHARE', [row.assignment_id])).rows[0];
    if (!a || a.state !== 'accepted') fail('denied', 'assignment_not_live');
    const ep = (await db.query('SELECT effective_capabilities FROM workforce_assignment_effective_policy WHERE assignment_id=$1', [row.assignment_id])).rows[0];
    targetTerm = ep?.effective_capabilities ?? [];
  } else {
    const p = (await db.query('SELECT state, project_id, target_kind, assignment_id FROM workforce_project_participations WHERE id=$1 FOR SHARE',
      [row.participation_id])).rows[0];
    if (!p || p.state !== 'active') fail('denied', 'participation_not_live');
    const project = (await db.query('SELECT is_archived FROM chat_projects WHERE id=$1 FOR SHARE', [p.project_id])).rows[0];
    if (!project || project.is_archived) fail('denied', 'project_not_live');
    if (p.target_kind === 'workspace') {
      const a = (await db.query('SELECT state FROM workforce_workspace_assignments WHERE id=$1 FOR SHARE', [p.assignment_id])).rows[0];
      if (!a || a.state !== 'accepted') fail('denied', 'assignment_not_live');
    }
    const ep = (await db.query('SELECT effective_capabilities FROM workforce_participation_effective_policy WHERE participation_id=$1', [row.participation_id])).rows[0];
    targetTerm = ep?.effective_capabilities ?? [];
  }

  if (row.target_workspace_id && !(await actsForWorkspace(db, who, row.target_workspace_id))) fail('denied', 'actor_cannot_act_for_target');
  if (row.target_kind === 'project' && !row.target_workspace_id) {
    const self = who.principal.kind === 'human' ? who.principal.id : who.principal.owner?.id;
    if (self !== row.target_owner_user_id) fail('denied', 'actor_cannot_act_for_target');
  }

  if (row.team_id) {
    // The actor's own admitted membership, NOW: a removed member or one demoted to observer stops.
    const member = (await db.query(`SELECT role FROM workforce_assignment_active_member_candidates
       WHERE assignment_id=$1 AND team_id=$2 AND member_principal_id=$3`, [row.assignment_id, row.team_id, who.principal.id])).rows[0];
    if (!member) fail('denied', 'actor_not_an_admitted_member');
    if (!['manager', 'worker'].includes(member.role)) fail('denied', 'observer_cannot_dispatch');
    const agentMember = (await db.query(`SELECT 1 FROM workforce_assignment_active_member_candidates
       WHERE assignment_id=$1 AND team_id=$2 AND member_resource_id=$3`, [row.assignment_id, row.team_id, row.agent_resource_id])).rowCount;
    if (!agentMember) fail('denied', 'agent_not_an_admitted_member');
  }

  if (row.root_binding_id) {
    const live = (await db.query('SELECT binding_id FROM chat_project_execution_root($1, $2)', [row.project_id, row.host_installation_id])).rows
      .some((b) => b.binding_id === row.root_binding_id);
    if (!live) fail('denied', 'root_binding_not_live');
  }

  let entitlementTerm = null;
  if (row.entitlement_id) {
    const ent = (await db.query(`SELECT e.id FROM marketplace_entitlements e WHERE e.id=$1 AND e.status='active'
       AND (e.expires_at IS NULL OR e.expires_at > now()) FOR SHARE`, [row.entitlement_id])).rows[0];
    if (!ent) fail('denied', 'entitlement_not_live');
    entitlementTerm = row.rights.entitlement;
  }

  // Budget: the payer must still be able to fund work at all. A frozen account stops the run; an
  // account with nothing left is refused for THIS step without revoking -- a top-up resumes it.
  const acct = (await db.query('SELECT balance, is_frozen FROM credit_accounts WHERE user_id=$1 FOR SHARE', [row.payer_user_id])).rows[0];
  if (!acct || acct.is_frozen) fail('needs_approval', 'payer_cannot_fund');

  let live = row.effective_capabilities.filter((c) => targetTerm.includes(c));
  if (entitlementTerm) live = live.filter((c) => entitlementTerm.includes(c));
  return { who, live };
}

function parseStep(context, value) {
  if (!context || typeof context !== 'object') fail('bad_input', 'invalid_context');
  for (const key of Object.keys(context)) if (!['actorUserId', 'clientId', 'apiKeyId'].includes(key)) fail('bad_input', 'unknown_field', { field: `context.${key}` });
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('bad_input', 'invalid_request');
  for (const key of Object.keys(value)) if (!['admissionId', 'operation', 'capability'].includes(key)) fail('bad_input', 'unknown_field', { field: `request.${key}` });
  if (!['privileged_call', 'provider_dispatch'].includes(value.operation)) fail('bad_input', 'invalid_operation');
  if (value.operation === 'privileged_call' ? (typeof value.capability !== 'string' || !CAPABILITY.test(value.capability)) : value.capability !== undefined) {
    fail('bad_input', 'invalid_capability');
  }
  if (typeof context.clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(context.clientId)) fail('bad_input', 'invalid_client');
  return {
    actor: { actorUserId: uuid(context.actorUserId, 'actor'), clientId: context.clientId,
      ...(Object.hasOwn(context, 'apiKeyId') ? { apiKeyId: uuid(context.apiKeyId, 'api_key') } : {}) },
    admissionId: uuid(value.admissionId, 'admission'), operation: value.operation, capability: value.capability ?? null,
  };
}

/**
 * RUN-03: ask, before each privileged call or new provider dispatch, whether the admitted run may still
 * act. Returns `{ lease, token, admission }` or throws a typed refusal (a terminal one revoked the run).
 *
 * `signingKey` is `{ kid, privatePem }` -- the platform's active OIDC key in production, injected so a
 * test can hold a key the verifier also knows. Never a key the request supplies.
 */
export async function authorizeRunStep(pool, authenticatedContext, value, { signingKey, now = () => Date.now() } = {}) {
  const { actor, admissionId, operation, capability } = parseStep(authenticatedContext, value);
  if (!signingKey?.kid || !signingKey?.privatePem) fail('unavailable', 'lease_signing_unavailable');

  let terminal = null;
  const result = await authorityTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM workforce_run_admissions WHERE id=$1', [admissionId])).rows[0];
    // Only the actor that was admitted may drive the run. Anyone else learns nothing about it.
    if (!row || row.actor_user_id !== actor.actorUserId || row.client_id !== actor.clientId) fail('not_found', 'admission_not_found');
    if (row.target_workspace_id) await lockWorkspaceAuthority(db, row.target_workspace_id);
    await lockApiKeyWorkforceAuthority(db, actor, 'workforce:manage');
    // Serialize the admission's lease sequence; the database guard holds the same rule independently.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-authority:${admissionId}`]);

    const revoked = (await db.query('SELECT reason FROM workforce_run_revocations WHERE admission_id=$1', [admissionId])).rows[0];
    if (revoked) fail('denied', 'admission_revoked', { revocation: revoked.reason });

    let live;
    try { ({ live } = await liveTerms(db, row)); }
    catch (error) {
      if (error instanceof RunAdmissionError && TERMINAL.has(error.details.reason)) terminal = { error, reason: TERMINAL.get(error.details.reason) };
      throw error;
    }
    if (operation === 'privileged_call' && !live.includes(capability)) {
      fail('denied', 'capability_not_live', { capability });
    }
    if (operation === 'provider_dispatch' && live.length === 0 && row.effective_capabilities.length > 0) {
      // Everything this run was granted has since been withdrawn: dispatching the model again could only
      // produce calls nothing would allow. That is lost authority, not a quiet no-op run.
      terminal = { error: new RunAdmissionError('denied', 'no_live_capabilities'), reason: 'authority_lost' };
      throw terminal.error;
    }

    const sequence = BigInt((await db.query('SELECT coalesce(max(sequence),0)::text AS s FROM workforce_run_leases WHERE admission_id=$1',
      [admissionId])).rows[0].s) + 1n;
    const iat = Math.floor(now() / 1000);
    const exp = iat + RUN_LEASE_MAX_SECONDS;
    const header = { alg: 'ES256', typ: RUN_LEASE_TYP, kid: signingKey.kid };
    const claims = { iss: 'xeno-platform', aud: 'xeno-run-runtime', sub: admissionId, jti: crypto.randomUUID(),
      seq: sequence.toString(), op: operation, ...(capability ? { cap: capability } : {}), caps: live, iat, exp };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: signingKey.privatePem, dsaEncoding: 'ieee-p1363' });
    const token = `${signingInput}.${b64url(signature)}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const lease = (await db.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,capability,effective_capabilities,
        issued_at,expires_at,signing_kid,token_hash) VALUES($1,$2,$3,$4,$5,to_timestamp($6),to_timestamp($7),$8,$9) RETURNING *`,
    [admissionId, sequence.toString(), operation, capability, JSON.stringify(live), iat, exp, signingKey.kid, tokenHash])).rows[0];
    return { token, lease: publicLease(lease) };
  }).catch(async (error) => {
    // A terminal loss is recorded in its OWN transaction: the refused step rolled back, the revocation
    // must not. Idempotent -- a second loss for the same admission keeps the first reason.
    if (terminal) {
      // A platform finding names nobody: the actor who happened to ask did not decide it.
      await pool.query(`INSERT INTO workforce_run_revocations(admission_id,reason) VALUES($1,$2)
        ON CONFLICT (admission_id) DO NOTHING`, [admissionId, terminal.reason]);
    }
    throw error;
  });
  return result;
}

/** Stop a run deliberately: the actor, or anyone who may act for its workspace target. Idempotent. */
export async function revokeRun(pool, authenticatedContext, admissionIdValue) {
  const actorUserId = uuid(authenticatedContext?.actorUserId, 'actor');
  const admissionId = uuid(admissionIdValue, 'admission');
  return authorityTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM workforce_run_admissions WHERE id=$1', [admissionId])).rows[0];
    if (!row) fail('not_found', 'admission_not_found');
    let reason = null;
    if (row.actor_user_id === actorUserId) reason = 'stopped_by_actor';
    else if (row.target_workspace_id) {
      const who = await livePrincipal(db, actorUserId);
      if (who && await actsForWorkspace(db, who, row.target_workspace_id)) reason = 'stopped_by_target';
    }
    if (!reason) fail('not_found', 'admission_not_found');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-authority:${admissionId}`]);
    await db.query(`INSERT INTO workforce_run_revocations(admission_id,revoked_by_user_id,reason) VALUES($1,$2,$3)
      ON CONFLICT (admission_id) DO NOTHING`, [admissionId, actorUserId, reason]);
    const r = (await db.query('SELECT * FROM workforce_run_revocations WHERE admission_id=$1', [admissionId])).rows[0];
    return { schemaVersion: 1, admissionId, revoked: true, reason: r.reason, revokedAt: r.revoked_at.toISOString(), replayed: r.reason !== reason };
  });
}

/** The admission's current authority state: revoked or not, and the latest lease sequence. */
export async function readRunAuthority(pool, authenticatedContext, admissionIdValue) {
  const actorUserId = uuid(authenticatedContext?.actorUserId, 'actor');
  const admissionId = uuid(admissionIdValue, 'admission');
  const row = (await pool.query('SELECT actor_user_id FROM workforce_run_admissions WHERE id=$1', [admissionId])).rows[0];
  if (!row || row.actor_user_id !== actorUserId) fail('not_found', 'admission_not_found');
  const revoked = (await pool.query('SELECT reason, revoked_at FROM workforce_run_revocations WHERE admission_id=$1', [admissionId])).rows[0];
  const latest = (await pool.query('SELECT max(sequence)::text AS s FROM workforce_run_leases WHERE admission_id=$1', [admissionId])).rows[0].s;
  return { schemaVersion: 1, admissionId, revoked: Boolean(revoked), reason: revoked?.reason ?? null,
    latestLeaseSequence: latest ?? null };
}

function publicLease(row) {
  return { schemaVersion: 1, leaseId: row.id, admissionId: row.admission_id, sequence: String(row.sequence),
    operation: row.operation, capability: row.capability, effectiveCapabilities: row.effective_capabilities,
    issuedAt: row.issued_at.toISOString(), expiresAt: row.expires_at.toISOString(), kid: row.signing_kid };
}

/**
 * NFR-10: the reference RUNTIME-SIDE verifier. A runtime calls this before each privileged operation
 * while it holds a lease, and asks the platform again when it returns `valid: false`.
 *
 *   publicKey        the platform key for `kid`, from the published JWKS -- never from the token
 *   receivedAtMono   a MONOTONIC reading (ms) taken when the lease was received (process.hrtime,
 *                    performance.now) -- the bound that survives the wall clock being wound back
 *   nowMono          the same monotonic clock now
 *   nowWallMs        the wall clock now, used only to check `exp` with the skew allowance
 *   minSequence      the highest sequence this runtime has ever seen for the admission, persisted, so
 *                    a lease replayed after a restart cannot be older than one already used
 *
 * The monotonic bound does not survive a process restart (a new process has a new monotonic origin),
 * so a restarted runtime that cannot prove when it received its lease has "no reliable remaining-
 * validity proof" and must re-authorize online: pass `receivedAtMono: null` and this returns
 * `requires_online_reauthorization`, whatever the wall clock says.
 */
export function verifyRunLease(token, { publicKey, admissionId, receivedAtMono, nowMono, nowWallMs, minSequence = 0n,
  skewSeconds = RUN_LEASE_SKEW_SECONDS } = {}) {
  const refuse = (reason) => ({ valid: false, reason });
  if (typeof token !== 'string') return refuse('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) return refuse('malformed');
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { return refuse('malformed'); }
  if (header.alg !== 'ES256' || header.typ !== RUN_LEASE_TYP) return refuse('wrong_type');
  if (!publicKey) return refuse('unknown_key');
  const signed = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(parts[2], 'base64url'));
  if (!signed) return refuse('bad_signature');
  if (claims.iss !== 'xeno-platform' || claims.aud !== 'xeno-run-runtime' || claims.sub !== admissionId) return refuse('wrong_subject');
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.exp - claims.iat > RUN_LEASE_MAX_SECONDS) {
    return refuse('unbounded');
  }
  let seq;
  try { seq = BigInt(claims.seq); } catch { return refuse('malformed'); }
  if (seq < BigInt(minSequence)) return refuse('superseded');
  // Wall clock, with the skew allowance applied in the CONSERVATIVE direction: the verifier treats the
  // lease as expiring EARLIER, never later.
  if (typeof nowWallMs !== 'number' || nowWallMs / 1000 >= claims.exp - skewSeconds) return refuse('expired');
  // Monotonic elapsed time since receipt: bounded by the lease's own lifetime however the wall clock moves.
  if (receivedAtMono === null || receivedAtMono === undefined || typeof nowMono !== 'number') return refuse('requires_online_reauthorization');
  const elapsed = (nowMono - receivedAtMono) / 1000;
  if (elapsed < 0) return refuse('requires_online_reauthorization');
  if (elapsed >= (claims.exp - claims.iat) - skewSeconds) return refuse('expired');
  return { valid: true, sequence: seq, capabilities: claims.caps, operation: claims.op, capability: claims.cap ?? null };
}

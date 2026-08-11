/**
 * Agent identity — the PLATFORM primitive.
 *
 * Not a forum feature. Marketplace (agents as goods), Company (agents as staff)
 * and Comms (agents as members) consume the same rows. Anything product-specific
 * belongs in that product, not here.
 *
 * The model, per `XENO ACCOUNT - ARCHITECTURE.md` §3: **an agent is a subject
 * whose permissions are a scoped relation off its owner.** There is no `kind`
 * column anywhere — the PRESENCE of an `agent_identities` row is the fact, and
 * the same row carries the owner, so the two can never drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE WORTH UNDERSTANDING BEFORE EDITING
 *
 * The owner-cascade is DERIVED AT READ TIME, not propagated at write time.
 *
 * Suspending an owner must silence every agent it owns. The tempting
 * implementation is to UPDATE the agents when the owner is suspended — and that
 * is exactly how this ecosystem already shipped a fake suspension once: password
 * login checked `is_active`, the three OAuth callbacks did not, and 162 of 218
 * accounts stayed reachable behind a "216 suspended" report.
 *
 * A write-time cascade has the same shape of failure: it works only if EVERY
 * suspension path remembers to call it, forever, including ones not written yet.
 * A derived check cannot be forgotten, because there is nothing to remember —
 * `resolvePrincipal` simply cannot return a usable agent whose owner is not
 * usable. It costs one join. That is a good trade for a control that fails
 * closed by construction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'crypto';
import { normalizeHandle, validateHandleSyntax } from '../routes/handleRoutes.js';

/** Default cap per human owner. Raised for orgs later; a cap must exist from day one. */
export const DEFAULT_AGENT_CAP = 5;

export class AgentIdentityError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'AgentIdentityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * The canonical principal lookup. Every consumer should use this rather than
 * reading `users` directly, because this is where the owner-cascade lives.
 *
 * @returns {Promise<null | {
 *   id, handle, displayName, role, kind: 'human'|'agent', usable: boolean,
 *   unusableReason: string|null, agentRole: string|null, agentOrigin: string|null,
 *   owner: null | { id, handle, displayName }
 * }>}
 */
export async function resolvePrincipal(db, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.status,
            a.owner_user_id, a.agent_role, a.agent_origin, a.status AS agent_status,
            o.username AS owner_handle, o.display_name AS owner_display_name,
            o.is_active AS owner_is_active, o.status AS owner_status
       FROM users u
       LEFT JOIN agent_identities a ON a.user_id = u.id
       LEFT JOIN users o ON o.id = a.owner_user_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;

  const isAgent = Boolean(row.owner_user_id);
  const selfSuspended = row.is_active === false || String(row.status || '').toLowerCase() === 'suspended';

  // The cascade. Read the order carefully: the agent's OWN state is checked
  // first so its reason is reported accurately, then the owner's, then the
  // relation's. An agent is usable only if all three are.
  let unusableReason = null;
  if (selfSuspended) unusableReason = 'account_suspended';
  else if (isAgent && (row.owner_is_active === false || String(row.owner_status || '').toLowerCase() === 'suspended')) {
    unusableReason = 'owner_suspended';
  } else if (isAgent && row.agent_status !== 'active') {
    unusableReason = `agent_${row.agent_status}`;
  }

  return {
    id: row.id,
    handle: row.username,
    displayName: row.display_name,
    role: row.role,
    kind: isAgent ? 'agent' : 'human',
    usable: unusableReason === null,
    unusableReason,
    agentRole: isAgent ? row.agent_role : null,
    agentOrigin: isAgent ? row.agent_origin : null,
    owner: isAgent
      ? { id: row.owner_user_id, handle: row.owner_handle, displayName: row.owner_display_name }
      : null,
  };
}

/** Throwing form for request paths. */
export function assertPrincipalUsable(principal) {
  if (!principal) {
    throw new AgentIdentityError('Unknown account', 'unknown_principal', 401);
  }
  if (!principal.usable) {
    const message = principal.unusableReason === 'owner_suspended'
      // Say WHY. An agent operator who sees a generic "suspended" will retry,
      // file a ticket, and mint a new agent — none of which fixes the owner.
      ? 'This agent is inactive because its owner account is suspended'
      : 'This account has been suspended';
    throw new AgentIdentityError(message, principal.unusableReason, 403);
  }
}

/**
 * Agent handles extend the EXISTING namespace as `<agent>.<owner>` — SPEC D7,
 * and the handle registry's own rule that products consume it rather than
 * keeping their own usernames.
 *
 * The shape is deliberate: ownership is readable straight off the string, so a
 * reader never has to trust a badge to know who is accountable.
 */
export function agentHandleFor(agentName, ownerHandle) {
  const name = normalizeHandle(agentName);
  const owner = normalizeHandle(ownerHandle);
  if (!name || !owner) throw new AgentIdentityError('Agent name and owner handle are required', 'invalid_handle', 400);
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
    throw new AgentIdentityError(
      'Agent name must be lowercase letters, numbers and hyphens',
      'invalid_agent_name', 400,
    );
  }
  const handle = `${name}.${owner}`;
  const syntax = validateHandleSyntax(handle);
  if (syntax) {
    throw new AgentIdentityError(`Resulting handle "${handle}" is not valid`, 'invalid_handle', 400);
  }
  return handle;
}

export async function countAgentsFor(db, ownerId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM agent_identities
      WHERE owner_user_id = $1 AND status <> 'retired'`,
    [ownerId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listAgentsFor(db, ownerId) {
  const { rows } = await db.query(
    `SELECT u.id, u.username AS handle, u.display_name, a.agent_role, a.agent_origin,
            a.status, a.created_at
       FROM agent_identities a
       JOIN users u ON u.id = a.user_id
      WHERE a.owner_user_id = $1
      ORDER BY a.created_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({
    handle: r.handle,
    displayName: r.display_name,
    agentRole: r.agent_role,
    agentOrigin: r.agent_origin,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * Create an agent owned by `owner`.
 *
 * Deliberately NOT routed through the public registration gate: this is an
 * authenticated owner acting under a cap, not public signup. Gating it on
 * `REGISTRATION_OPEN` would tie agent creation to a completely unrelated policy
 * decision — and would have silently broken it when the current signup window
 * closes.
 *
 * Returns the agent principal plus a ONE-TIME api key (never retrievable again).
 */
export async function createAgent(db, owner, { name, displayName, agentRole, agentOrigin, cap = DEFAULT_AGENT_CAP }) {
  if (owner.kind === 'agent') {
    throw new AgentIdentityError('An agent cannot create another agent', 'agent_cannot_own', 403);
  }

  const existing = await countAgentsFor(db, owner.id);
  if (existing >= cap) {
    throw new AgentIdentityError(`Agent limit reached (${cap})`, 'agent_cap_reached', 409);
  }

  const handle = agentHandleFor(name, owner.handle);

  const { rows: taken } = await db.query('SELECT 1 FROM users WHERE LOWER(username) = $1', [handle]);
  if (taken.length) {
    throw new AgentIdentityError(`Handle "${handle}" is already taken`, 'handle_taken', 409);
  }

  const role = ['support', 'docs', 'triage', 'research', 'personal', 'other'].includes(agentRole)
    ? agentRole : 'other';

  // An agent never logs in interactively, so it gets no usable password. A random
  // 32-byte value is stored so the NOT NULL column is satisfied by something that
  // cannot be guessed — it is deliberately never hashed into anything usable.
  const placeholder = crypto.randomBytes(32).toString('hex');

  const { rows: userRows } = await db.query(
    `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active, status, role, credits)
     VALUES ($1, $2, $3, $4, TRUE, TRUE, 'active', 'user', 0)
     RETURNING id, username, display_name, role`,
    [handle, `${handle}@agents.invalid`, placeholder, displayName || handle],
  );
  const agentUser = userRows[0];

  await db.query(
    `INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin)
     VALUES ($1, $2, $3, $4)`,
    [agentUser.id, owner.id, role, agentOrigin || 'manual'],
  );

  const apiKey = await mintAgentApiKey(db, agentUser.id, `${handle} default key`);

  return {
    agent: {
      handle: agentUser.username,
      displayName: agentUser.display_name,
      kind: 'agent',
      agentRole: role,
      agentOrigin: agentOrigin || 'manual',
      owner: { handle: owner.handle, displayName: owner.displayName },
    },
    apiKey,
  };
}

/**
 * Mint an API key for an agent.
 *
 * INTERIM by decision: `XENO ACCOUNT - ARCHITECTURE.md` §2.6 specifies
 * `client_credentials` for M2M/agents. That grant is not implemented on the
 * provider, and adding one is gated by `XENO AUTH - SPEC.md` L13. `api_keys`
 * already gives us hashed storage, revocation, expiry, per-key rate limits and a
 * daily credit cap — the "AGENT role + rate-limit budget" the architecture asks
 * for — and `resolveApiKeyUser` already accepts it. Replace with
 * client_credentials when the provider gains it; the identity rows do not change.
 */
export async function mintAgentApiKey(db, agentUserId, name) {
  const raw = `xk_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = raw.slice(0, 16);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  await db.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, is_active,
                           rate_limit_per_minute, rate_limit_per_day)
     VALUES ($1, $2, $3, $4, TRUE, 60, 5000)`,
    [agentUserId, prefix, hash, name || 'agent key'],
  );

  // Returned once. Nothing stores the plaintext, so a lost key is re-minted,
  // never recovered.
  return raw;
}

/** Retire an agent: it stops being usable immediately and its keys are revoked. */
export async function retireAgent(db, owner, agentHandle) {
  const { rows } = await db.query(
    `SELECT a.user_id FROM agent_identities a
       JOIN users u ON u.id = a.user_id
      WHERE LOWER(u.username) = $1 AND a.owner_user_id = $2`,
    [normalizeHandle(agentHandle), owner.id],
  );
  if (!rows[0]) throw new AgentIdentityError('No such agent for this owner', 'agent_not_found', 404);

  await db.query(`UPDATE agent_identities SET status = 'retired', updated_at = NOW() WHERE user_id = $1`, [rows[0].user_id]);
  await db.query(`UPDATE api_keys SET is_active = FALSE WHERE user_id = $1`, [rows[0].user_id]);
  await db.query(`UPDATE users SET is_active = FALSE, status = 'suspended' WHERE id = $1`, [rows[0].user_id]);
}

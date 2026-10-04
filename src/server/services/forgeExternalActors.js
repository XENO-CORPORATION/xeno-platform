// FORGE-06: external PRs and issues keep working with no XENO
// account. The contributor's public provider identity is mirrored
// as an external actor — never as a users row, so no billable user
// is auto-created and no ownership is fabricated. Verified identity
// linking (the XENO user proves they own the external account) plus
// explicit per-scope consent gate XENO spending, private access and
// agent execution. Attribution always reports external provenance.
export const EXTERNAL_CONSENT_SCOPES = Object.freeze(['spending', 'private_access', 'agent_execution']);
export const EXTERNAL_LINK_METHODS = Object.freeze(['oauth', 'signed_nonce', 'maintainer_attestation']);

function isPool(poolOrClient) {
  return poolOrClient && typeof poolOrClient.totalCount === 'number';
}

async function withTx(poolOrClient, fn) {
  if (!isPool(poolOrClient)) return fn(poolOrClient);
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

function clean(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

export async function recordExternalActor(poolOrClient, input) {
  const provider = input && input.provider === 'github' ? 'github' : null;
  const providerActorId = clean(input && input.providerActorId, 64);
  const login = clean(input && input.login, 128);
  if (!provider || !providerActorId || !login) throw new Error('external_actor_invalid');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(
      `INSERT INTO forge_external_actors
         (provider, provider_actor_id, login, display_name, avatar_url, profile_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, provider_actor_id)
       DO UPDATE SET login = EXCLUDED.login,
         display_name = COALESCE(EXCLUDED.display_name, forge_external_actors.display_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, forge_external_actors.avatar_url),
         profile_url = COALESCE(EXCLUDED.profile_url, forge_external_actors.profile_url)
       RETURNING *`,
      [provider, providerActorId, login,
        clean(input.displayName, 256), clean(input.avatarUrl, 512), clean(input.profileUrl, 512)],
    );
    return rows[0];
  });
}

export async function attributeExternalWork(poolOrClient, { actorId, kind, ref }) {
  if (!actorId || (kind !== 'pull_request' && kind !== 'issue')) throw new Error('external_work_invalid');
  const cleanRef = clean(ref, 256);
  if (!cleanRef) throw new Error('external_work_invalid');
  return withTx(poolOrClient, async (executor) => {
    const actor = await executor.query(`SELECT id FROM forge_external_actors WHERE id = $1`, [actorId]);
    if (actor.rows.length === 0) throw new Error('external_actor_unknown');
    const { rows } = await executor.query(
      `INSERT INTO forge_external_works (actor_id, kind, ref) VALUES ($1, $2, $3)
       ON CONFLICT (actor_id, kind, ref) DO NOTHING RETURNING *`,
      [actorId, kind, cleanRef],
    );
    if (rows.length > 0) return { recorded: true, work: rows[0] };
    const existing = await executor.query(
      `SELECT * FROM forge_external_works WHERE actor_id = $1 AND kind = $2 AND ref = $3`,
      [actorId, kind, cleanRef],
    );
    return { recorded: false, work: existing.rows[0] };
  });
}

export async function linkExternalIdentity(poolOrClient, { actorId, userId, actorUserId, method, proofRef }) {
  if (!actorId || !userId) throw new Error('external_link_invalid');
  if (actorUserId !== userId) throw new Error('external_link_not_self');
  if (!EXTERNAL_LINK_METHODS.includes(method)) throw new Error('external_link_unverified');
  const proof = clean(proofRef, 256);
  if (!proof) throw new Error('external_link_unverified');
  return withTx(poolOrClient, async (executor) => {
    const actor = await executor.query(
      `SELECT id, verified_link FROM forge_external_actors WHERE id = $1 FOR UPDATE`, [actorId]);
    if (actor.rows.length === 0) throw new Error('external_actor_unknown');
    if (actor.rows[0].verified_link) throw new Error('external_link_exists');
    const user = await executor.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (user.rows.length === 0) throw new Error('external_link_user_unknown');
    const { rows } = await executor.query(
      `UPDATE forge_external_actors SET linked_user_id = $2, verified_link = TRUE,
         verification_method = $3, verification_proof_ref = $4, verified_at = now()
       WHERE id = $1 RETURNING *`,
      [actorId, userId, method, proof],
    );
    return rows[0];
  });
}

export async function grantExternalConsent(poolOrClient, { actorId, scope, grantedByUserId }) {
  if (!actorId || !EXTERNAL_CONSENT_SCOPES.includes(scope) || !grantedByUserId) {
    throw new Error('external_consent_invalid');
  }
  return withTx(poolOrClient, async (executor) => {
    const actor = await executor.query(
      `SELECT id, linked_user_id, verified_link FROM forge_external_actors WHERE id = $1 FOR UPDATE`,
      [actorId],
    );
    if (actor.rows.length === 0) throw new Error('external_actor_unknown');
    const row = actor.rows[0];
    if (!row.verified_link || !row.linked_user_id) throw new Error('external_unlinked');
    if (row.linked_user_id !== grantedByUserId) throw new Error('external_consent_not_self');
    const { rows } = await executor.query(
      `INSERT INTO forge_external_consents (actor_id, scope, active, granted_by_user_id, revoked_at)
       VALUES ($1, $2, TRUE, $3, NULL)
       ON CONFLICT (actor_id, scope)
       DO UPDATE SET active = TRUE, granted_by_user_id = EXCLUDED.granted_by_user_id,
         granted_at = now(), revoked_at = NULL
       RETURNING *`,
      [actorId, scope, grantedByUserId],
    );
    return rows[0];
  });
}

export async function revokeExternalConsent(poolOrClient, { actorId, scope, revokedByUserId }) {
  if (!actorId || !EXTERNAL_CONSENT_SCOPES.includes(scope) || !revokedByUserId) {
    throw new Error('external_consent_invalid');
  }
  return withTx(poolOrClient, async (executor) => {
    const actor = await executor.query(
      `SELECT id, linked_user_id, verified_link FROM forge_external_actors WHERE id = $1 FOR UPDATE`,
      [actorId],
    );
    if (actor.rows.length === 0) throw new Error('external_actor_unknown');
    const row = actor.rows[0];
    if (!row.verified_link || !row.linked_user_id) throw new Error('external_unlinked');
    if (row.linked_user_id !== revokedByUserId) throw new Error('external_consent_not_self');
    const { rows } = await executor.query(
      `UPDATE forge_external_consents SET active = FALSE, revoked_at = now()
       WHERE actor_id = $1 AND scope = $2 AND active = TRUE RETURNING *`,
      [actorId, scope],
    );
    if (rows.length === 0) throw new Error('external_consent_missing');
    return rows[0];
  });
}

export async function requireExternalCapability(poolOrClient, { actorId, scope }) {
  if (!actorId || !EXTERNAL_CONSENT_SCOPES.includes(scope)) throw new Error('external_capability_invalid');
  const { rows } = await poolOrClient.query(
    `SELECT id, linked_user_id, verified_link FROM forge_external_actors WHERE id = $1`,
    [actorId],
  );
  if (rows.length === 0) throw new Error('external_actor_unknown');
  const row = rows[0];
  if (!row.verified_link || !row.linked_user_id) throw new Error('external_unlinked');
  const consent = await poolOrClient.query(
    `SELECT id FROM forge_external_consents WHERE actor_id = $1 AND scope = $2 AND active = TRUE`,
    [actorId, scope],
  );
  if (consent.rows.length === 0) throw new Error('external_consent_missing');
  return { actorId: row.id, userId: row.linked_user_id, scope };
}

export async function readExternalAttribution(poolOrClient, actorId) {
  const { rows } = await poolOrClient.query(
    `SELECT a.id, a.provider, a.provider_actor_id, a.login, a.display_name,
       a.profile_url, a.linked_user_id, a.verified_link, a.verified_at,
       COALESCE((SELECT json_agg(json_build_object('kind', w.kind, 'ref', w.ref)
         ORDER BY w.created_at) FROM forge_external_works w WHERE w.actor_id = a.id),
         '[]'::json) AS works
     FROM forge_external_actors a WHERE a.id = $1`,
    [actorId],
  );
  if (rows.length === 0) throw new Error('external_actor_unknown');
  const row = rows[0];
  return {
    actorId: row.id,
    provider: row.provider,
    providerActorId: row.provider_actor_id,
    login: row.login,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    kind: row.verified_link && row.linked_user_id ? 'linked' : 'external',
    userId: row.verified_link ? row.linked_user_id : null,
    verifiedAt: row.verified_at,
    works: row.works,
  };
}

// Ownership is never derived from an external login: an unlinked
// actor owns nothing, and a linked actor owns exactly what its
// linked XENO user owns. There is no branch that reports an
// external login itself as an owner.
export function externalOwns(attribution, ownerUserId) {
  if (!attribution || attribution.kind !== 'linked' || !attribution.userId) return false;
  return attribution.userId === ownerUserId;
}

/**
 * inferenceGrants — single-use, ≤60s handles. Never the secret.
 *
 * Spec §6. The platform mints a grant when it resolves a managed BYOK
 * route. The gateway POSTs it back to /api/v2/inference/credential, once.
 * The second POST is 410 grant_spent, even from the same caller.
 *
 * The table stores sha256(grant), not the grant, and never the provider
 * key. Exchange spends the row, then decrypts inside useCredential's
 * callback — the same "never return plaintext" rule as the vault.
 */

import crypto from 'node:crypto';
import { useCredential } from './providerCredentials.js';

export const GRANT_TTL_SECONDS = 60;
export const GRANT_PREFIX = 'xgrant_';

function fail(code, message, http = 410) {
  const e = new Error(message);
  e.code = code;
  e.http = http;
  return e;
}

export function hashGrant(grant) {
  return crypto.createHash('sha256').update(String(grant), 'utf8').digest('hex');
}

/**
 * Mint a grant bound to (user_id, surface, model, credential_id).
 * Returns { grant, expiresAt }. The raw grant is shown once, here.
 */
export async function mintGrant(db, userId, { surface, model = '', credentialId }) {
  if (!userId) throw fail('grant_unbound', 'user is required', 400);
  if (!credentialId) throw fail('grant_unbound', 'credential is required', 400);
  const boundSurface = surface && String(surface).trim() ? String(surface).trim() : '*';
  const boundModel = model == null ? '' : String(model);
  const grant = GRANT_PREFIX + crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + GRANT_TTL_SECONDS * 1000);
  await db.query(
    `INSERT INTO inference_grants
       (grant_hash, user_id, surface, model, credential_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hashGrant(grant), userId, boundSurface, boundModel, credentialId, expiresAt],
  );
  return { grant, expiresAt: expiresAt.toISOString() };
}

/**
 * Spend the grant (one row, one time) and return the binding.
 * Does not decrypt. Callers that need the secret go through exchangeGrant.
 */
export async function spendGrant(db, presented) {
  if (!presented || typeof presented !== 'string' || !presented.startsWith(GRANT_PREFIX)) {
    throw fail('grant_spent', 'grant is not usable', 410);
  }
  const hash = hashGrant(presented);
  const { rows } = await db.query(
    `UPDATE inference_grants
        SET spent_at = NOW()
      WHERE grant_hash = $1 AND spent_at IS NULL AND expires_at > NOW()
      RETURNING user_id, surface, model, credential_id`,
    [hash],
  );
  if (rows[0]) return rows[0];

  const { rows: existing } = await db.query(
    `SELECT spent_at FROM inference_grants WHERE grant_hash = $1`,
    [hash],
  );
  if (existing[0] && existing[0].spent_at) {
    throw fail('grant_spent', 'grant has already been used', 410);
  }
  if (existing[0]) throw fail('grant_expired', 'grant has expired', 410);
  throw fail('grant_spent', 'grant is not usable', 410);
}

/**
 * Spend, then decrypt into `use`. The secret never leaves the callback.
 * Returns whatever `use` returns — typically { provider, baseUrl } after
 * the route has already copied those fields next to a one-shot secret
 * write. The route is the only place that puts `secret` on a response,
 * and that response is Cache-Control: no-store, TLS-only, service-token.
 */
export async function exchangeGrant(db, presented, use) {
  const binding = await spendGrant(db, presented);
  return useCredential(db, binding.user_id, binding.credential_id, async (cred) => (
    use({
      ...cred,
      userId: binding.user_id,
      surface: binding.surface,
      model: binding.model,
      credentialId: binding.credential_id,
    })
  ));
}

/**
 * Attach a grant onto a managed-BYOK decision. Premium / local / in-house
 * decisions pass through unchanged — there is nothing to mint.
 */
export async function attachManagedGrant(db, userId, decision, { surface, model } = {}) {
  if (!decision || decision.path !== 'byok' || decision.mode !== 'managed' || !decision.credential) {
    return decision;
  }
  const minted = await mintGrant(db, userId, {
    surface,
    model,
    credentialId: decision.credential.id,
  });
  return {
    ...decision,
    credential: {
      ...decision.credential,
      grant: minted.grant,
      expiresAt: minted.expiresAt,
    },
  };
}

export default {
  GRANT_TTL_SECONDS, GRANT_PREFIX, hashGrant,
  mintGrant, spendGrant, exchangeGrant, attachManagedGrant,
};

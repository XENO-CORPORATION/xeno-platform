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

/**
 * Record the usage of a BYOK call, bound to the grant that carried it.
 *
 * Spec D4: BYOK never meters money but ALWAYS records usage. The platform's own
 * chat route already does this (aiRoutes -> recordInferenceUsage). The gateway
 * path — API key -> gateway -> grant exchange -> user's provider — had nothing
 * to call: /service/usage prices every call at premium server-side, so posting a
 * BYOK completion there would have CHARGED the user, and there was no unbilled
 * alternative. Measured 2026-09-17 on the first real BYOK call through the
 * platform vault: resolve 200, exchange 200, key used, zero credit movement —
 * and zero api_usage_logs rows. Correct money, invisible usage.
 *
 * Binding to the grant is what makes this safe to expose to a service token:
 * the row is only written for a grant that was minted for this user, for this
 * surface, and has been SPENT — i.e. the exchange actually happened. A caller
 * holding the token cannot record free usage for an arbitrary user or model,
 * and cannot record a second row for the same call: one grant, one row.
 *
 * The cost is 0 by construction (recordInferenceUsage refuses any other value).
 * `provider` and `model` come from the caller because the caller is the one
 * that saw the provider's response; `surface` and `user_id` come from the grant
 * because the caller is not trusted to say who this was for.
 */
export async function recordGrantUsage(db, presented, usage = {}) {
  if (!presented || typeof presented !== 'string' || !presented.startsWith(GRANT_PREFIX)) {
    throw fail('grant_unknown', 'grant is not usable', 409);
  }
  const hash = hashGrant(presented);
  const { rows } = await db.query(
    `SELECT id, user_id, surface, model, credential_id, spent_at
       FROM inference_grants WHERE grant_hash = $1`,
    [hash],
  );
  const g = rows[0];
  if (!g) throw fail('grant_unknown', 'no such grant', 409);
  if (!g.spent_at) throw fail('grant_unspent', 'usage can only be recorded for an exchanged grant', 409);

  const inTok = Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : 0;
  const outTok = Number.isInteger(usage.outputTokens) && usage.outputTokens >= 0 ? usage.outputTokens : 0;
  const requestId = `grant:${g.id}`;

  // One grant, one row. The request_id carries the grant id so a retry from
  // the gateway (network blip after we committed) is a no-op, not a double.
  const { rows: existing } = await db.query(
    'SELECT id FROM api_usage_logs WHERE user_id = $1 AND request_id = $2 LIMIT 1',
    [g.user_id, requestId],
  );
  if (existing[0]) return { recorded: false, duplicate: true, grantId: g.id };

  const { recordInferenceUsage } = await import('../utils/recordInferenceUsage.js');
  await recordInferenceUsage(db, g.user_id, {
    surface: g.surface,
    operation: usage.operation || 'chat.completion',
    model: typeof usage.model === 'string' && usage.model ? usage.model : (g.model || null),
    provider: typeof usage.provider === 'string' ? usage.provider : null,
    inputTokens: inTok,
    outputTokens: outTok,
    requestId,
    endpoint: '/v1/chat/completions',
    // A grant row is BYOK by construction; the reason says which level chose it.
    dimensions: { route_path: 'byok', ...(usage.dimensions || {}) },
  });
  await db.query(
    'UPDATE user_provider_credentials SET last_used_at = NOW() WHERE id = $1',
    [g.credential_id],
  ).catch(() => {});
  return { recorded: true, duplicate: false, grantId: g.id, userId: g.user_id, surface: g.surface };
}

export default {
  GRANT_TTL_SECONDS, GRANT_PREFIX, hashGrant,
  mintGrant, spendGrant, exchangeGrant, attachManagedGrant, recordGrantUsage,
};

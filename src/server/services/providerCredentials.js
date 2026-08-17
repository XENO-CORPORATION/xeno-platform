/**
 * providerCredentials — the vault, and the routing decision it feeds.
 *
 * Spec: `XENO INFERENCE ROUTING - SPEC.md`.
 * Handling rules: `XENO CREDENTIAL HYGIENE - PLAYBOOK.md` — read §3–§6 before
 * editing anything below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO RULES WORTH UNDERSTANDING BEFORE EDITING
 *
 * 1. NOTHING HERE EVER RETURNS PLAINTEXT TO A CALLER — including the owner.
 *    `listCredentials` excludes `secret_encrypted` **at the query**, not in a
 *    serializer someone will later refactor into a spread. A key is re-entered,
 *    never recovered. The only function that decrypts is `useCredential`, and it
 *    hands the secret to an outbound provider call and forgets it.
 *
 * 2. RESOLUTION FAILS CLOSED. A request routed to the user's own key NEVER falls
 *    back to premium. Falling back would spend their credits on a request they
 *    deliberately routed to be free — silently, at scale, visible only on the
 *    invoice. This ecosystem has shipped "the gate breaks OPEN" four times
 *    (xeno-apps' smoke gates, xeno-workflow's 76 unreachable nodes, xeno-tools'
 *    never-called install, xeno-comms' skipped CI). This is the same shape,
 *    refused up front. The only automatic transition is active → invalid, which
 *    STOPS requests rather than re-routing them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { encrypt, decrypt, isConfigured } from '../utils/secretBox.js';
import { safeGet, assertSafeEndpointUrl } from '../utils/safeEndpoint.js';

/** The account-default row. Not a magic string scattered around — one constant. */
export const DEFAULT_SURFACE = '*';

/**
 * Ship behind a flag that FAILS CLOSED: unset means today's exact behaviour
 * (a 400 from aiRoutes), never "on". A half-configured security route must fail,
 * not quietly produce a working-but-unsafe path.
 */
export function byokEnabled() {
  return process.env.BYOK_ENABLED === 'true';
}

/**
 * Per-provider verification. Each entry answers one question with one cheap GET:
 * "does this credential authenticate?" — never a generation call, which would
 * cost the user money just to save their key.
 */
const PROVIDERS = {
  openai: {
    defaultBase: 'https://api.openai.com/v1',
    probe: '/models',
    headers: (secret) => ({ Authorization: `Bearer ${secret}` }),
  },
  anthropic: {
    defaultBase: 'https://api.anthropic.com/v1',
    probe: '/models',
    headers: (secret) => ({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' }),
  },
  google: {
    defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
    probe: '/models',
    // Google takes the key as a header on v1beta; the ?key= form would put the
    // secret in a URL, and URLs reach access logs and Referer headers.
    headers: (secret) => ({ 'x-goog-api-key': secret }),
  },
  openrouter: {
    defaultBase: 'https://openrouter.ai/api/v1',
    probe: '/key',
    headers: (secret) => ({ Authorization: `Bearer ${secret}` }),
  },
  'azure-openai': {
    defaultBase: null, // always user-supplied — every Azure resource has its own host
    probe: '/openai/models?api-version=2024-02-01',
    headers: (secret) => ({ 'api-key': secret }),
  },
  compatible: {
    defaultBase: null, // Ollama, self-hosted, xeno-rt
    probe: '/models',
    headers: (secret) => ({ Authorization: `Bearer ${secret}` }),
  },
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);

/** A typed refusal the routes turn into a 4xx without inventing a message. */
function fail(code, message, http = 400) {
  const e = new Error(message);
  e.code = code;
  e.http = http;
  return e;
}

/**
 * sha256(secret)[0:16] — the incident primitive (hygiene §6).
 *
 * Lets us answer "which users hold the key that just leaked" while having never
 * stored the thing that leaked, and lets a scrubber recognise a burned key
 * without embedding it. Same technique as xeno-extension's BURNED_KEY_FINGERPRINT.
 */
export function fingerprint(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex').slice(0, 16);
}

/** Display tail. Short enough to be useless, long enough to tell two keys apart. */
function last4(secret) {
  const s = String(secret);
  return s.length <= 4 ? '' : s.slice(-4);
}

/** Resolve the base URL for a provider, applying the SSRF guard to user input. */
function resolveBase(provider, baseUrl) {
  const meta = PROVIDERS[provider];
  if (!meta) throw fail('provider_unsupported', `unknown provider: ${provider}`);

  if (baseUrl) {
    // Throws a typed endpoint_* code. Structural check only — the real control
    // runs at connect time inside safeGet.
    assertSafeEndpointUrl(baseUrl);
    return String(baseUrl).replace(/\/+$/, '');
  }
  if (!meta.defaultBase) {
    throw fail('base_url_required', `${provider} requires an explicit endpoint`);
  }
  return meta.defaultBase;
}

/**
 * Spec D9 — prove a credential works BEFORE storing it active.
 *
 * Returns { ok, status, reason }. An unverified key stored as active fails for
 * the first time in the middle of the user's actual work, which is the worst
 * possible moment to discover a typo.
 */
export async function verifyCredential({ provider, secret, baseUrl }) {
  const meta = PROVIDERS[provider];
  if (!meta) throw fail('provider_unsupported', `unknown provider: ${provider}`);

  const base = resolveBase(provider, baseUrl);
  let res;
  try {
    res = await safeGet(`${base}${meta.probe}`, { headers: meta.headers(secret) });
  } catch (err) {
    // Never surface the raw error: safeEndpoint already scrubs it, but this is
    // the boundary where a caller could otherwise start echoing internals.
    return { ok: false, status: 0, reason: err.code || 'endpoint_unreachable' };
  }

  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'rejected_by_provider' };
  if (res.status === 429) return { ok: false, status: res.status, reason: 'provider_rate_limited' };
  if (res.status >= 500) return { ok: false, status: res.status, reason: 'provider_unavailable' };
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, reason: null };
  return { ok: false, status: res.status, reason: 'unexpected_provider_response' };
}

/**
 * Store a credential. Verification happens first and a failure is REFUSED —
 * we do not store an unusable key as `invalid` and let the user wonder.
 */
export async function createCredential(db, userId, { provider, label, secret, baseUrl = null }) {
  if (!isConfigured()) {
    // encrypt() would throw anyway; this turns an unhandled 500 into a truthful
    // 503, and makes the operator failure legible instead of mysterious.
    throw fail('vault_unavailable', 'at-rest encryption is not configured on this server', 503);
  }
  if (!SUPPORTED_PROVIDERS.includes(provider)) throw fail('provider_unsupported', `unknown provider: ${provider}`);
  if (!secret || String(secret).trim().length < 8) throw fail('secret_invalid', 'that does not look like an API key');
  if (!label || !String(label).trim()) throw fail('label_required', 'a label is required');

  const clean = String(secret).trim();
  const check = await verifyCredential({ provider, secret: clean, baseUrl });
  if (!check.ok) {
    throw fail('credential_rejected', `the provider did not accept that key (${check.reason})`, 422);
  }

  const fp = fingerprint(clean);
  const { rows } = await db.query(
    `INSERT INTO user_provider_credentials
       (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, base_url, status, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
     ON CONFLICT (user_id, provider, key_fingerprint) DO UPDATE
       SET label = EXCLUDED.label,
           base_url = EXCLUDED.base_url,
           secret_encrypted = EXCLUDED.secret_encrypted,
           status = 'active',
           verified_at = NOW(),
           updated_at = NOW()
     RETURNING id, provider, label, key_fingerprint, key_last4, base_url, status, verified_at, created_at`,
    [userId, provider, String(label).trim(), encrypt(clean), fp, last4(clean), baseUrl || null]
  );
  return rows[0];
}

/**
 * 🔴 The column list is the security control. `secret_encrypted` is excluded
 * HERE, at the query — not filtered downstream. `SELECT *` in this function
 * would be a defect, and a reviewer should treat it as one.
 */
export async function listCredentials(db, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.provider, c.label, c.key_fingerprint, c.key_last4, c.base_url,
            c.status, c.verified_at, c.last_used_at, c.created_at,
            COUNT(r.surface)::int AS routed_surfaces
       FROM user_provider_credentials c
       LEFT JOIN inference_routes r ON r.credential_id = c.id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows;
}

/** Terminal, and it stops use immediately. It does NOT re-point anything. */
export async function revokeCredential(db, userId, credentialId) {
  const { rows } = await db.query(
    `UPDATE user_provider_credentials
        SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, status`,
    [credentialId, userId]
  );
  if (!rows[0]) throw fail('credential_not_found', 'no such credential', 404);
  return rows[0];
}

/**
 * Delete. The FK is ON DELETE RESTRICT, so this is REFUSED while any route still
 * points at it — deliberately (spec D10). We report which products, so the UI can
 * ask what they should do instead rather than silently re-routing them to premium.
 */
export async function deleteCredential(db, userId, credentialId) {
  const { rows: used } = await db.query(
    `SELECT surface FROM inference_routes WHERE user_id = $1 AND credential_id = $2 ORDER BY surface`,
    [userId, credentialId]
  );
  if (used.length > 0) {
    const e = fail('credential_in_use', 'that key is still used by one or more products', 409);
    e.surfaces = used.map((r) => r.surface);
    throw e;
  }
  const { rowCount } = await db.query(
    `DELETE FROM user_provider_credentials WHERE id = $1 AND user_id = $2`,
    [credentialId, userId]
  );
  if (rowCount === 0) throw fail('credential_not_found', 'no such credential', 404);
  return { deleted: true };
}

/**
 * Set a route. `surface` is DEFAULT_SURFACE for the account default, or an OIDC
 * client_id for a product override.
 */
export async function setRoute(db, userId, surface, { path, mode = 'managed', credentialId = null }) {
  if (!['premium', 'byok', 'inhouse'].includes(path)) throw fail('path_invalid', `unknown path: ${path}`);
  if (!['managed', 'local'].includes(mode)) throw fail('mode_invalid', `unknown mode: ${mode}`);

  if (path === 'byok' && mode === 'managed') {
    if (!credentialId) throw fail('credential_required', 'choose a key for this product');
    const { rows } = await db.query(
      `SELECT id, status FROM user_provider_credentials WHERE id = $1 AND user_id = $2`,
      [credentialId, userId]
    );
    if (!rows[0]) throw fail('credential_not_found', 'no such credential', 404);
    if (rows[0].status !== 'active') throw fail('credential_not_active', `that key is ${rows[0].status}`, 409);
  }

  const { rows } = await db.query(
    `INSERT INTO inference_routes (user_id, surface, path, mode, credential_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, surface) DO UPDATE
       SET path = EXCLUDED.path, mode = EXCLUDED.mode,
           credential_id = EXCLUDED.credential_id, updated_at = NOW()
     RETURNING surface, path, mode, credential_id, updated_at`,
    [userId, surface, path, mode, path === 'byok' && mode === 'managed' ? credentialId : null]
  );
  return rows[0];
}

/** Remove an override so the product INHERITS the account default again (D2). */
export async function clearRoute(db, userId, surface) {
  if (surface === DEFAULT_SURFACE) throw fail('cannot_clear_default', 'the account default cannot be cleared, only changed');
  await db.query(`DELETE FROM inference_routes WHERE user_id = $1 AND surface = $2`, [userId, surface]);
  return { cleared: true };
}

/**
 * Every first-party product, with this user's route and whether they have ever
 * signed into it.
 *
 * Read from `oauth_clients` rather than a hardcoded list, because that table IS
 * the product registry (spec D6 — one vocabulary across oauth_clients,
 * api_usage_logs and inference_routes). A hardcoded list would drift the first
 * time a product is registered.
 *
 * ⚠️ `last_signed_in` is honest and frequently NULL: as of 2026-08-17 only 4 of
 * 14 registered clients have ever minted a refresh token. The UI must render
 * that as "never signed in", never as an inactive-looking zero — a product that
 * has not adopted the account yet is a different fact from one that is idle.
 */
export async function listProducts(db, userId) {
  const { rows } = await db.query(
    `SELECT c.client_id, c.name, c.surface,
            r.path, r.mode, r.credential_id,
            cred.label AS credential_label, cred.key_last4, cred.status AS credential_status,
            (SELECT MAX(t.created_at) FROM oauth_refresh_tokens t
              WHERE t.client_id = c.client_id AND t.user_id = $1) AS last_signed_in
       FROM oauth_clients c
       LEFT JOIN inference_routes r
              ON r.user_id = $1 AND r.surface = c.client_id
       LEFT JOIN user_provider_credentials cred
              ON cred.id = r.credential_id
      WHERE c.is_first_party = TRUE
      ORDER BY c.name`,
    [userId]
  );
  return rows;
}

export async function listRoutes(db, userId) {
  const { rows } = await db.query(
    `SELECT r.surface, r.path, r.mode, r.credential_id, r.updated_at,
            c.label AS credential_label, c.provider AS credential_provider,
            c.key_last4, c.status AS credential_status
       FROM inference_routes r
       LEFT JOIN user_provider_credentials c ON c.id = r.credential_id
      WHERE r.user_id = $1
      ORDER BY (r.surface = '*') DESC, r.surface`,
    [userId]
  );
  return rows;
}

/**
 * ── THE RESOLUTION (spec D2) ─────────────────────────────────────────────────
 *
 *   account default ('*')  →  product override (client_id)  →  request override
 *
 * Absence INHERITS. A product with no row is not "unset"; it takes the account
 * default. That is why "reset to default" is a DELETE and not a value someone
 * has to write correctly.
 *
 * Returns a decision, or throws a typed refusal. 🔴 It NEVER downgrades a byok
 * decision into a premium one — see rule 2 at the top of this file.
 */
export async function resolveInferenceRoute(db, userId, { surface, requestedPath = null }) {
  const key = surface && String(surface).trim() ? String(surface).trim() : DEFAULT_SURFACE;

  const { rows } = await db.query(
    `SELECT r.surface, r.path, r.mode, r.credential_id,
            c.provider, c.base_url, c.status AS credential_status, c.key_fingerprint
       FROM inference_routes r
       LEFT JOIN user_provider_credentials c ON c.id = r.credential_id
      WHERE r.user_id = $1 AND r.surface = ANY($2::text[])`,
    [userId, [key, DEFAULT_SURFACE]]
  );

  const override = rows.find((r) => r.surface === key && key !== DEFAULT_SURFACE);
  const accountDefault = rows.find((r) => r.surface === DEFAULT_SURFACE);
  const chosen = override || accountDefault || null;

  let path = requestedPath || chosen?.path || 'premium';
  let reason = requestedPath ? 'request-override'
    : override ? 'product-override'
    : accountDefault ? 'account-default'
    : 'platform-default';

  if (path !== 'byok') {
    return {
      path, mode: 'managed', reason,
      metered: path === 'premium',
      credential: null,
    };
  }

  // ── byok from here down. Every exit is either a usable credential or a typed
  //    refusal. There is no branch that returns premium. ────────────────────────
  if (!byokEnabled()) throw fail('byok_disabled', 'bring-your-own-key is not enabled on this server', 503);

  const mode = chosen?.mode || 'managed';
  if (mode === 'local') {
    // The key never reaches us. We are not the egress and we have nothing to
    // resolve — the product calls the provider itself.
    return { path: 'byok', mode: 'local', reason, metered: false, credential: null };
  }

  if (!chosen?.credential_id) throw fail('byok_credential_missing', 'no key is configured for this product', 409);
  if (chosen.credential_status === 'revoked') throw fail('byok_credential_revoked', 'the key for this product was revoked', 409);
  if (chosen.credential_status !== 'active') throw fail('byok_credential_invalid', 'the key for this product was rejected by the provider', 409);

  return {
    path: 'byok',
    mode: 'managed',
    reason,
    metered: false, // spec D4: never money. Usage is still recorded by the caller.
    credential: {
      id: chosen.credential_id,
      provider: chosen.provider,
      fingerprint: chosen.key_fingerprint,
      baseUrl: chosen.base_url || PROVIDERS[chosen.provider]?.defaultBase || null,
    },
  };
}

/**
 * Decrypt for one outbound call. The ONLY function here that yields plaintext,
 * and it never returns it — the caller receives the result of `use(secret)`.
 *
 * Written this way on purpose: a function that RETURNED the secret would be
 * copied into a route handler within a week.
 */
export async function useCredential(db, userId, credentialId, use) {
  const { rows } = await db.query(
    `SELECT id, provider, secret_encrypted, base_url, status
       FROM user_provider_credentials
      WHERE id = $1 AND user_id = $2`,
    [credentialId, userId]
  );
  const row = rows[0];
  if (!row) throw fail('byok_credential_missing', 'no such credential', 409);
  if (row.status !== 'active') throw fail('byok_credential_invalid', `that key is ${row.status}`, 409);

  const secret = decrypt(row.secret_encrypted);
  try {
    return await use({ secret, provider: row.provider, baseUrl: row.base_url });
  } finally {
    // Best-effort touch; a failed timestamp must never fail the user's request.
    db.query(`UPDATE user_provider_credentials SET last_used_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
  }
}

/**
 * The provider told us the key is bad. Mark it invalid so we stop trying.
 *
 * 🔴 This STOPS requests. It does not re-route them. See rule 2.
 */
export async function markCredentialInvalid(db, credentialId) {
  await db.query(
    `UPDATE user_provider_credentials SET status = 'invalid', updated_at = NOW()
      WHERE id = $1 AND status = 'active'`,
    [credentialId]
  );
}

export default {
  DEFAULT_SURFACE, SUPPORTED_PROVIDERS, byokEnabled, fingerprint,
  verifyCredential, createCredential, listCredentials, revokeCredential, deleteCredential,
  setRoute, clearRoute, listRoutes, listProducts, resolveInferenceRoute, useCredential, markCredentialInvalid,
};

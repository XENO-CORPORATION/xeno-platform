/**
 * Browser installations: one row per browser a person has connected, reached through
 * `/api/v2/browser/installations` (routes/browserRelayRoutes.js). Contract: docs/CHAT-TOOL-CALLING-PLAN.md
 * → "Browser tools".
 *
 * 🔴 THE BINDING IS THE DPoP KEY, AND THAT IS THE WHOLE SECURITY ARGUMENT.
 * The row is created with the thumbprint (`dpop_jkt`) of the key that proved the registration. Only a
 * token BOUND to that key can connect as this installation, so a copied access token is useless to a
 * different machine — and because the check is a comparison against a stored column, a person cannot
 * silently adopt someone else's browser by guessing an id. Re-registering the same installation with a
 * DIFFERENT key is refused rather than honoured: that is what an attacker who obtained the token would
 * have to do, and the honest answer is `409 key_mismatch` plus instructions to revoke and re-register.
 *
 * Labels are the person's own words and are never used to identify anything — every lookup is by id.
 */
import { jwkThumbprint } from '../utils/dpop.js';

export const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InstallationError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) || null : null);

function readRegistration(body, noun = 'browser') {
  const installationId = String(body?.installationId || '').trim();
  if (!INSTALLATION_ID.test(installationId)) {
    throw new InstallationError('installationId must be the uuid v4 the extension generated once at install.', 'invalid_installation_id');
  }
  const label = clip(body?.label, 80);
  if (!label) throw new InstallationError(`Give this ${noun} a name so you recognise it later.`, 'invalid_label');
  return { installationId, label, browser: clip(body?.browser, 40), os: clip(body?.os, 40) };
}

const VIEW = `SELECT id, installation_id AS "installationId", dpop_jkt, label, browser, os, enabled,
   extension_version AS "extensionVersion", tools, last_seen_at AS "lastSeenAt",
   created_at AS "createdAt", updated_at AS "updatedAt", revoked_at AS "revokedAt",
   surface, projects, offered_tools AS "offeredTools" FROM browser_installations`;

/** What a caller may see: the VIEW minus the key thumbprint. The binding is ours to check, never to publish. */
const publicView = ({ dpop_jkt: _jkt, surface, projects, offeredTools, ...rest }) => (surface === 'browser' ? rest : { ...rest, projects, offeredTools });

/**
 * Register (or re-register) this browser for this person. Idempotent per (user, installationId):
 * the same browser, the same key, the same row — so a worker restart or a re-install that reuses its
 * stored installationId never accumulates rows.
 *
 * `enabled` is deliberately NOT set here. Connecting a browser is not consenting to be driven by chats;
 * the person turns that on, and a fresh installation therefore starts OFF.
 *
 * A Corpus PC starts ON, because its consent is on the PC: the app registers only after the person turned a project on there, and answers
 * only for those. Removing a PC in XENO has to mean something, though: it isn't a row the app can quietly recreate at its next start, so
 * the same installation id stays refused and the app has to mint a new one when the person asks to connect again.
 */
export async function register(db, userId, body, proofJkt, surface = 'browser') {
  const { installationId, label, browser, os } = readRegistration(body, surface === 'corpus' ? 'PC' : 'browser');
  if (!proofJkt) {
    throw new InstallationError('Register with a proof from this browser’s key so only it can connect.', 'dpop_bound_required', 403);
  }
  const live = (await db.query(
    `${VIEW} WHERE user_id = $1 AND installation_id = $2 AND surface = $3 AND revoked_at IS NULL`, [userId, installationId, surface])).rows[0];

  if (live) {
    if (live.dpop_jkt !== proofJkt) {
      // Not a merge, not a takeover. The browser that owns this installation presented a different key.
      throw new InstallationError(
        'That browser is connected with a different key. Remove it from your account, then connect again.',
        'key_mismatch', 409);
    }
    const updated = (await db.query(
      `UPDATE browser_installations SET label = $2, browser = $3, os = $4, updated_at = now()
        WHERE id = $1 RETURNING id`, [live.id, label, browser, os])).rows[0];
    return { installation: await get(db, userId, updated.id, surface), created: false };
  }
  if (surface === 'corpus' && (await db.query(`SELECT 1 FROM browser_installations WHERE user_id = $1 AND installation_id = $2 AND surface = 'corpus' AND revoked_at IS NOT NULL`, [userId, installationId])).rows[0]) {
    throw new InstallationError('This PC was removed from your XENO account.', 'installation_removed', 403);
  }

  // One live row per (person, installation). A row that was revoked is not live, so a browser that
  // reconnects after a revoke is a NEW row with a new id — old links keep pointing at the old one.
  const { rows } = await db.query(
    `INSERT INTO browser_installations (user_id, installation_id, dpop_jkt, label, browser, os, enabled, surface)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, installation_id) WHERE revoked_at IS NULL DO NOTHING
     RETURNING id`, [userId, installationId, proofJkt, label, browser, os, surface === 'corpus', surface]);
  if (!rows[0]) throw new InstallationError('That browser is already connected. Reload your account page.', 'conflict', 409);
  return { installation: await get(db, userId, rows[0].id, surface), created: true };
}

/** The person's own installations. Someone else's id reads as absent. */
export async function list(db, userId, surface = 'browser') {
  const { rows } = await db.query(
    `${VIEW} WHERE user_id = $1 AND surface = $2 AND revoked_at IS NULL ORDER BY created_at`, [userId, surface]);
  return { installations: rows.map(publicView) };
}

export async function get(db, userId, id, surface = 'browser') {
  if (!INSTALLATION_ID.test(String(id || ''))) throw new InstallationError('Browser not found', 'not_found', 404);
  const { rows } = await db.query(`${VIEW} WHERE id = $1 AND user_id = $2 AND surface = $3 AND revoked_at IS NULL`, [id, userId, surface]);
  if (!rows[0]) throw new InstallationError('Browser not found', 'not_found', 404);
  return publicView(rows[0]);
}

/** The ONLY switch that lets chats use a browser, and the label. Nothing else is editable: the
 *  installation id and the key binding are facts, not preferences. */
export async function patch(db, userId, id, body, surface = 'browser') {
  const current = await get(db, userId, id, surface);
  const enabled = typeof body?.enabled === 'boolean' ? body.enabled : current.enabled;
  const label = body?.label === undefined ? current.label : clip(body.label, 80);
  if (!label) throw new InstallationError('A browser name cannot be empty.', 'invalid_label');
  const { rows } = await db.query(
    `UPDATE browser_installations SET enabled = $3, label = $4, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [id, userId, enabled, label]);
  if (!rows[0]) throw new InstallationError('Browser not found', 'not_found', 404);
  return { installation: await get(db, userId, id, surface) };
}

/** Revoke: the row is kept (history and audit stay true), `revoked_at` is set, and the relay closes the
 *  socket and fails queued calls — revoking is not a request the browser may decline. */
export async function remove(db, userId, id, surface = 'browser') {
  const { rows } = await db.query(
    `UPDATE browser_installations SET revoked_at = now(), enabled = false, updated_at = now(), projects = '[]'::jsonb, offered_tools = '[]'::jsonb
      WHERE id = $1 AND user_id = $2 AND surface = $3 AND revoked_at IS NULL RETURNING id`, [id, userId, surface]);
  if (!rows[0]) throw new InstallationError('Browser not found', 'not_found', 404);
  return { revoked: true, id: String(rows[0].id) };
}

/** The DPoP thumbprint of a public JWK — re-exported so a route never reimplements the thumbprint. */
export const jktOf = (jwk) => jwkThumbprint(jwk);

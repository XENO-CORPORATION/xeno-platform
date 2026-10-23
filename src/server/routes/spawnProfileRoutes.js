/**
 * /api/v2/spawn/profiles — account-synced Spawn profile definitions
 * (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md).
 *
 * Mounted behind the same OIDC/DPoP auth as /api/v2/me: the account is ALWAYS
 * req.user.id from the token, never anything in the body, so one account can
 * never read or write another's rows. Writes are optimistic: the client names
 * the revision its bundle is based on, and a stale base is a 409, never a
 * silent overwrite (the VS Code sync lesson). The bundle is profile
 * definitions and non-credential config only; the server additionally refuses
 * the credential filenames outright, so a buggy client cannot upload a vendor
 * token here even by accident.
 */
import express from 'express';

export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const BUNDLE_MAX_BYTES = 256 * 1024;
const CREDENTIAL_NAMES = new Set(['.credentials.json', 'auth.json', 'credentials.json']);

/** Names in a bundle the server refuses outright. @param {unknown} bundle @returns {string[]} */
export function bundleViolations(bundle) {
  /** @type {string[]} */ const bad = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return ['bundle must be an object'];
  const files = /** @type {any} */ (bundle).files;
  if (files !== undefined) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) bad.push('files must be an object of path -> text');
    else for (const name of Object.keys(files)) {
      const base = name.split(/[\\/]/).pop() ?? name;
      if (CREDENTIAL_NAMES.has(base)) bad.push(`credential file refused: ${name}`);
      if (/(^|[\\/])(projects|sessions|history)([\\/]|$)/.test(name)) bad.push(`session transcript refused: ${name}`);
    }
  }
  if (JSON.stringify(bundle).length > BUNDLE_MAX_BYTES) bad.push(`bundle exceeds ${BUNDLE_MAX_BYTES} bytes`);
  return bad;
}

/** The handlers, with the database injected so tests need no server.
 * @param {{query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}>}} db */
export function spawnProfileHandlers(db) {
  return {
    /** @param {string} userId */
    async list(userId) {
      const r = await db.query(
        'SELECT profile_id, rev, bundle, deleted, updated_at FROM spawn_profile_sync WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId]);
      return { profiles: r.rows.map(row => ({ profileId: row.profile_id, rev: row.rev, ...(row.deleted ? { deleted: true } : { bundle: row.bundle }), updatedAt: row.updated_at })) };
    },
    /** @param {string} userId @param {string} profileId @param {number} baseRev @param {unknown} bundle */
    async put(userId, profileId, baseRev, bundle) {
      if (!PROFILE_ID.test(profileId)) return { status: 400, body: { error: { code: 'BAD_PROFILE_ID', message: 'profileId format' } } };
      if (!Number.isInteger(baseRev) || baseRev < 0) return { status: 400, body: { error: { code: 'BAD_REV', message: 'baseRev must be a non-negative integer' } } };
      const bad = bundleViolations(bundle);
      if (bad.length) return { status: 400, body: { error: { code: 'BAD_BUNDLE', message: bad.join('; ') } } };
      const cur = await db.query('SELECT rev, deleted FROM spawn_profile_sync WHERE user_id = $1 AND profile_id = $2', [userId, profileId]);
      const currentRev = cur.rows.length ? cur.rows[0].rev : 0;
      if (baseRev !== currentRev) return { status: 409, body: { error: { code: 'REV_CONFLICT', message: `based on rev ${baseRev}, current is ${currentRev}`, currentRev } } };
      const rev = currentRev + 1;
      await db.query(
        `INSERT INTO spawn_profile_sync (user_id, profile_id, rev, bundle, deleted, updated_at) VALUES ($1,$2,$3,$4,FALSE,now())
         ON CONFLICT (user_id, profile_id) DO UPDATE SET rev = EXCLUDED.rev, bundle = EXCLUDED.bundle, deleted = FALSE, updated_at = now()`,
        [userId, profileId, rev, JSON.stringify(bundle)]);
      return { status: 200, body: { profileId, rev } };
    },
    /** @param {string} userId @param {string} profileId @param {number} baseRev */
    async remove(userId, profileId, baseRev) {
      if (!PROFILE_ID.test(profileId)) return { status: 400, body: { error: { code: 'BAD_PROFILE_ID', message: 'profileId format' } } };
      const cur = await db.query('SELECT rev FROM spawn_profile_sync WHERE user_id = $1 AND profile_id = $2', [userId, profileId]);
      const currentRev = cur.rows.length ? cur.rows[0].rev : 0;
      if (baseRev !== currentRev) return { status: 409, body: { error: { code: 'REV_CONFLICT', message: `based on rev ${baseRev}, current is ${currentRev}`, currentRev } } };
      const rev = currentRev + 1;
      await db.query(
        `INSERT INTO spawn_profile_sync (user_id, profile_id, rev, bundle, deleted, updated_at) VALUES ($1,$2,$3,NULL,TRUE,now())
         ON CONFLICT (user_id, profile_id) DO UPDATE SET rev = EXCLUDED.rev, bundle = NULL, deleted = TRUE, updated_at = now()`,
        [userId, profileId, rev]);
      return { status: 200, body: { profileId, rev, deleted: true } };
    },
  };
}

const router = express.Router();
const wrap = (/** @type {(h: any, req: any) => Promise<{status?: number, body: unknown}>} */ fn) =>
  async (/** @type {any} */ req, /** @type {any} */ res) => {
    try {
      const out = await fn(spawnProfileHandlers(req.db), req);
      res.status(out.status ?? 200).json(out.body);
    } catch (e) {
      console.error('[spawn/profiles] error:', e instanceof Error ? e.message : String(e));
      res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'profile sync failed' } });
    }
  };

router.get('/', wrap(async (h, req) => ({ body: await h.list(req.user.id) })));
router.put('/:profileId', wrap(async (h, req) => h.put(req.user.id, req.params.profileId, req.body?.baseRev, req.body?.bundle)));
router.delete('/:profileId', wrap(async (h, req) => h.remove(req.user.id, req.params.profileId, req.body?.baseRev ?? -1)));

export default router;

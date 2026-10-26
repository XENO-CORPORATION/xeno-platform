/**
 * /api/v2/spawn/devices — the devices that sync Spawn profiles with this account
 * (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md, "Removal and the choice").
 *
 * A signed-in Spawn checks in after each sync (PUT), and the account page lists them (GET) to say when each device last
 * synced and whether one has a profile waiting for a choice. Forgetting one (DELETE) only removes it from this list; it
 * signs nothing out, and the device appears again on its next sync. Same auth as the profiles route: the account is ALWAYS
 * req.user.id from the token, never the body. Informational only: no sync decision reads this table.
 */
import express from 'express';

export const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A device name as shown on the page: one line, no control characters, at most 120 characters. @param {unknown} value */
export function cleanDeviceName(value) {
  const name = String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return name || null;
}
/** @param {unknown} value */
const count = (value) => Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) <= 10000 ? /** @type {number} */ (value) : null;

/** The handlers, with the database injected so tests need no server.
 * @param {{query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}>}} db */
export function spawnDeviceHandlers(db) {
  return {
    /** @param {string} userId */
    async list(userId) {
      const r = await db.query(
        'SELECT device_id, name, version, profiles, conflicts, last_sync_at FROM spawn_sync_devices WHERE user_id = $1 ORDER BY last_sync_at DESC',
        [userId]);
      return { devices: r.rows.map(row => ({ deviceId: row.device_id, name: row.name, version: row.version, profiles: row.profiles,
        conflicts: row.conflicts, lastSyncAt: row.last_sync_at })) };
    },
    /** @param {string} userId @param {string} deviceId @param {any} body */
    async checkIn(userId, deviceId, body) {
      if (!DEVICE_ID.test(deviceId)) return { status: 400, body: { error: { code: 'BAD_DEVICE_ID', message: 'deviceId format' } } };
      const name = cleanDeviceName(body?.name), profiles = count(body?.profiles ?? 0), conflicts = count(body?.conflicts ?? 0);
      const version = body?.version == null ? null : String(body.version).replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 60) || null;
      if (!name) return { status: 400, body: { error: { code: 'BAD_NAME', message: 'name is required' } } };
      if (profiles === null || conflicts === null) return { status: 400, body: { error: { code: 'BAD_COUNT', message: 'profiles and conflicts are counts from 0 to 10000' } } };
      await db.query(
        `INSERT INTO spawn_sync_devices (user_id, device_id, name, version, profiles, conflicts, last_sync_at) VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (user_id, device_id) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version, profiles = EXCLUDED.profiles,
           conflicts = EXCLUDED.conflicts, last_sync_at = now()`,
        [userId, deviceId, name, version, profiles, conflicts]);
      return { status: 200, body: { deviceId } };
    },
    /** @param {string} userId @param {string} deviceId */
    async forget(userId, deviceId) {
      if (!DEVICE_ID.test(deviceId)) return { status: 400, body: { error: { code: 'BAD_DEVICE_ID', message: 'deviceId format' } } };
      await db.query('DELETE FROM spawn_sync_devices WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);
      return { status: 200, body: { deviceId, forgotten: true } };
    },
  };
}

const router = express.Router();
const wrap = (/** @type {(h: any, req: any) => Promise<{status?: number, body: unknown}>} */ fn) =>
  async (/** @type {any} */ req, /** @type {any} */ res) => {
    try {
      const out = await fn(spawnDeviceHandlers(req.db), req);
      res.status(out.status ?? 200).json(out.body);
    } catch (e) {
      console.error('[spawn/devices] error:', e instanceof Error ? e.message : String(e));
      res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'device list failed' } });
    }
  };

router.get('/', wrap(async (h, req) => ({ body: await h.list(req.user.id) })));
router.put('/:deviceId', wrap(async (h, req) => h.checkIn(req.user.id, req.params.deviceId, req.body)));
router.delete('/:deviceId', wrap(async (h, req) => h.forget(req.user.id, req.params.deviceId)));

export default router;

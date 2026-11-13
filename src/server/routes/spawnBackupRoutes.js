/**
 * /api/v2/spawn/backup — Spawn's end-to-end encrypted conversation backup (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md,
 * "v2"; owner, 2026-11-12: "periodic uploads of the session into our storage on xenosystem account ... secure our full conversation
 * session with the agents", protected "Encrypted on this PC").
 *
 * Amended 2026-11-13 (owner: "like how iCloud works correct? no need for an extra backup password right?", then "iCloud
 * model (Recommended)"): in STANDARD mode the platform also keeps the data key, wrapped with its own key (/keys/account), so a
 * signed-in device can restore without another device or a recovery key. The conversations themselves are still encrypted on
 * the device before upload; Storage holds only ciphertext. PRIVATE mode deletes the account wrap and the paragraph below holds
 * in full again.
 *
 * THE SERVER NEVER SEES PLAINTEXT AND NEVER HOLDS A KEY (private mode; see the amendment above for standard mode). It stores three opaque things for the token's account:
 *   keys      the account data key, only WRAPPED: once per device (to that device's X25519 public key) and once to a recovery key
 *             the person keeps. A wrapped key is never rewritten (a database trigger holds it); devices are revoked, not erased.
 *   segments  numbered ciphertext of one object (a transcript), append-only: the same bytes again answer the same, different bytes
 *             for a number already written are refused. A rewritten transcript goes up whole as a new VERSION, never merged.
 *   objects   chosen by the client as an opaque id: no folder, agent or title is in it. The server sees the id, numbers, sizes, times.
 *
 * The bytes live in the person's XENO Storage, in ONE "Spawn backup" folder (app xeno-spawn-backup), so they are metered against
 * the allowance and restorable from the Storage trash like any other file.
 *
 * What the "approved" state is, said plainly: bookkeeping that the person's devices show. It is not what protects the backup. Only
 * someone who already has the data key (an approved device, or the recovery key) can wrap it to a new device; a device the server
 * lists as approved with a key nobody wrapped for it reads nothing. A stolen token can add noise, revoke a listing or fill the
 * allowance; it can neither read the backup nor replace a key the person's devices wrote.
 *
 *   GET    /keys                                     devices, the current recovery record, the key log
 *   PUT    /keys/devices/:deviceId                   {publicKey, name?, wrappedKey?, via?}   register (pending), or approved as the
 *                                                    account's FIRST device, or via the recovery key ({via: 'recovery'})
 *   POST   /keys/devices/:deviceId/approve           {byDeviceId, wrappedKey}   an approved device wraps the key to a pending one
 *   POST   /keys/devices/:deviceId/revoke            {byDeviceId?}
 *   PUT    /keys/recovery                            {byDeviceId, wrappedKey}   the recovery-wrapped key (a new one supersedes)
 *   PUT    /keys/account                             {byDeviceId, dataKey}   STANDARD MODE (the iCloud model, wrap type 0x03): an
 *                                                    approved device hands the data key to the platform, which keeps it wrapped
 *                                                    with SPAWN_BACKUP_KEK (utils/spawnBackupKek.js), never bare
 *   GET    /keys/account?deviceId=                   {dataKey}   a device registered to this account (pending or approved) gets
 *                                                    the key back. A device's FIRST unwrap needs a sign-in in the last 10 minutes
 *                                                    and mails the person; every unwrap is logged
 *   DELETE /keys/account                             {byDeviceId}   PRIVATE MODE: the account wrap is really deleted
 *   GET    /objects                                  every object with its segments and versions (numbers, sizes, sha256, times)
 *   PUT    /objects/:objectId/segments/:n            raw ciphertext   ·   GET the same path reads it back
 *   PUT    /objects/:objectId/versions/:n            raw ciphertext   ·   GET the same path reads it back
 */
import crypto from 'node:crypto';
import express from 'express';
import { DEVICE_ID } from './spawnDeviceRoutes.js';
import { ensureProjectFolder, listProjectFiles, projectFileAt, readProjectFile, writeProjectFile, ProjectFolderError } from '../services/projectFolders.js';
import { wrapDataKey, unwrapDataKey, KekUnavailableError } from '../utils/spawnBackupKek.js';
import { sendEmail } from '../services/emailService.js';

export const BACKUP_APP = 'xeno-spawn-backup';
export const OBJECT_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const SEGMENT_MAX_BYTES = 16 * 1024 * 1024;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;            // 32 bytes, base64url without padding (X25519)
const WRAPPED_KEY = /^[A-Za-z0-9_-]{16,1024}$/;
const DATA_KEY = /^[A-Za-z0-9_-]{43}$/;              // 32 bytes, base64url without padding
/** A device's first unwrap needs a sign-in this recent (seconds): a long-lived or stolen token cannot quietly add a device. */
export const FIRST_UNWRAP_FRESH_SEC = 10 * 60;
const freshSignIn = (authTime, now = Date.now()) => Number.isFinite(Number(authTime)) && now / 1000 - Number(authTime) <= FIRST_UNWRAP_FRESH_SEC;
const PART = { segments: 'segments', versions: 'versions' };
const MAX_NUMBER = 999_999_999;

const err = (status, code, message) => ({ status, body: { error: { code, message } } });
const cleanName = (v) => { const n = String(v ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); return n || null; };

/** The account's one backup folder: its id is derived from the account, so every device lands in the same one. */
export const backupProjectId = (userId) => {
  const h = crypto.createHash('sha256').update(`xeno-spawn-backup:${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const pathOf = (objectId, part, n) => `${objectId}/${part}/${String(n).padStart(10, '0')}`;

const shapeDevice = (r) => ({ deviceId: r.device_id, name: r.name, state: r.state, publicKey: r.public_key, wrappedKey: r.wrapped_key,
  approvedBy: r.approved_by, createdAt: r.created_at, approvedAt: r.approved_at, revokedAt: r.revoked_at });

/** Run `fn` in one transaction holding this account's backup-key lock, so two first devices cannot both win. */
async function locked(db, userId, fn) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const release = client !== db;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`spawn-backup-keys:${userId}`]);
    const out = await fn(client);
    await client.query(out.status && out.status >= 400 ? 'ROLLBACK' : 'COMMIT');
    return out;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { if (release) client.release(); }
}
const event = (db, userId, kind, deviceId, byDevice = null) =>
  db.query('INSERT INTO spawn_backup_key_events (user_id, kind, device_id, by_device) VALUES ($1,$2,$3,$4)', [userId, kind, deviceId, byDevice]);
const approvedDevice = async (db, userId, deviceId) =>
  (await db.query("SELECT 1 FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' AND device_id = $2 AND state = 'approved'", [userId, deviceId])).rows.length > 0;

/** The key handlers, with the database injected. */
export function spawnBackupKeyHandlers(db) {
  return {
    async list(userId) {
      const devices = (await db.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' ORDER BY created_at", [userId])).rows;
      const recovery = (await db.query("SELECT wrapped_key, created_at FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'recovery' AND state = 'current'", [userId])).rows[0];
      const events = (await db.query('SELECT kind, device_id, by_device, at FROM spawn_backup_key_events WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 200', [userId])).rows;
      const account = (await db.query("SELECT created_at, kek_version FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'account' AND state = 'current'", [userId])).rows[0];
      const lastUnwrap = (await db.query("SELECT max(at) AS at FROM spawn_backup_key_events WHERE user_id = $1 AND kind = 'account_unwrapped'", [userId])).rows[0]?.at ?? null;
      return { status: 200, body: { devices: devices.map(shapeDevice), recovery: recovery ? { wrappedKey: recovery.wrapped_key, createdAt: recovery.created_at } : null,
        account: { present: Boolean(account), createdAt: account?.created_at ?? null, kekVersion: account?.kek_version ?? null, lastUnwrapAt: lastUnwrap },
        events: events.map((e) => ({ kind: e.kind, deviceId: e.device_id, byDeviceId: e.by_device, at: e.at })) } };
    },

    async register(userId, deviceId, body) {
      if (!DEVICE_ID.test(String(deviceId))) return err(400, 'BAD_DEVICE_ID', 'deviceId format');
      const b = body || {};
      for (const k of Object.keys(b)) if (!['publicKey', 'name', 'wrappedKey', 'via'].includes(k)) return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (typeof b.publicKey !== 'string' || !PUBLIC_KEY.test(b.publicKey)) return err(400, 'BAD_PUBLIC_KEY', 'publicKey is a 32-byte X25519 key, base64url');
      if (b.wrappedKey !== undefined && (typeof b.wrappedKey !== 'string' || !WRAPPED_KEY.test(b.wrappedKey))) return err(400, 'BAD_WRAPPED_KEY', 'wrappedKey is base64url');
      if (b.via !== undefined && b.via !== 'recovery') return err(400, 'BAD_VIA', "via is 'recovery' or absent");
      if (b.via === 'recovery' && !b.wrappedKey) return err(400, 'BAD_WRAPPED_KEY', 'a recovery restore brings the key it unwrapped, wrapped to this device');
      const name = cleanName(b.name);
      return locked(db, userId, async (tx) => {
        const row = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' AND device_id = $2", [userId, deviceId])).rows[0];
        if (row) {
          if (row.public_key !== b.publicKey) return err(409, 'DEVICE_KEY_MISMATCH', 'this device is registered with another key; a new key needs a new device id');
          if (row.state === 'revoked') return err(409, 'DEVICE_REVOKED', 'this device was revoked; register it again under a new device id');
          if (b.wrappedKey && row.state === 'approved' && row.wrapped_key !== b.wrappedKey) return err(409, 'ALREADY_APPROVED', 'this device already has its wrapped key; it is never replaced');
          if (b.wrappedKey && row.state === 'pending') return this.promote(tx, userId, deviceId, b);
          return { status: 200, body: { device: shapeDevice(row), replayed: true } };
        }
        if (b.wrappedKey) {
          const first = !(await tx.query("SELECT 1 FROM spawn_backup_keys WHERE user_id = $1 AND (kind = 'recovery' OR state = 'approved')", [userId])).rows.length;
          if (!first && b.via !== 'recovery') return err(409, 'APPROVAL_REQUIRED', 'this account already has a backup key: approve this device from one that has it, or restore with the recovery key');
          if (b.via === 'recovery' && first) return err(409, 'NO_RECOVERY', 'this account has no recovery record');
          const inserted = (await tx.query(`INSERT INTO spawn_backup_keys (user_id, kind, device_id, name, public_key, wrapped_key, state, approved_at)
            VALUES ($1,'device',$2,$3,$4,$5,'approved',now()) RETURNING *`, [userId, deviceId, name, b.publicKey, b.wrappedKey])).rows[0];
          await event(tx, userId, first ? 'first_device' : 'recovered', deviceId);
          return { status: 200, body: { device: shapeDevice(inserted), replayed: false } };
        }
        const inserted = (await tx.query(`INSERT INTO spawn_backup_keys (user_id, kind, device_id, name, public_key, state)
          VALUES ($1,'device',$2,$3,$4,'pending') RETURNING *`, [userId, deviceId, name, b.publicKey])).rows[0];
        await event(tx, userId, 'registered', deviceId);
        return { status: 200, body: { device: shapeDevice(inserted), replayed: false } };
      });
    },

    // a pending device that restored with the recovery key, or the first device registering after it asked to be pending
    async promote(tx, userId, deviceId, b) {
      const first = !(await tx.query("SELECT 1 FROM spawn_backup_keys WHERE user_id = $1 AND (kind = 'recovery' OR state = 'approved')", [userId])).rows.length;
      if (!first && b.via !== 'recovery') return err(409, 'APPROVAL_REQUIRED', 'approve this device from one that has the key, or restore with the recovery key');
      if (b.via === 'recovery' && first) return err(409, 'NO_RECOVERY', 'this account has no recovery record');
      const row = (await tx.query(`UPDATE spawn_backup_keys SET state = 'approved', wrapped_key = $3, approved_at = now()
        WHERE user_id = $1 AND kind = 'device' AND device_id = $2 AND state = 'pending' RETURNING *`, [userId, deviceId, b.wrappedKey])).rows[0];
      await event(tx, userId, first ? 'first_device' : 'recovered', deviceId);
      return { status: 200, body: { device: shapeDevice(row), replayed: false } };
    },

    async approve(userId, deviceId, body) {
      if (!DEVICE_ID.test(String(deviceId))) return err(400, 'BAD_DEVICE_ID', 'deviceId format');
      const b = body || {};
      for (const k of Object.keys(b)) if (!['byDeviceId', 'wrappedKey'].includes(k)) return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (!DEVICE_ID.test(String(b.byDeviceId))) return err(400, 'BAD_DEVICE_ID', 'byDeviceId format');
      if (typeof b.wrappedKey !== 'string' || !WRAPPED_KEY.test(b.wrappedKey)) return err(400, 'BAD_WRAPPED_KEY', 'wrappedKey is base64url');
      if (b.byDeviceId === deviceId) return err(409, 'SELF_APPROVAL', 'a device cannot approve itself');
      return locked(db, userId, async (tx) => {
        if (!(await approvedDevice(tx, userId, b.byDeviceId))) return err(403, 'APPROVER_NOT_APPROVED', 'only a device that already has the key can approve another');
        const row = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' AND device_id = $2", [userId, deviceId])).rows[0];
        if (!row) return err(404, 'DEVICE_NOT_FOUND', 'no such device is waiting');
        if (row.state === 'approved') return row.wrapped_key === b.wrappedKey ? { status: 200, body: { device: shapeDevice(row), replayed: true } } : err(409, 'ALREADY_APPROVED', 'this device already has its wrapped key');
        if (row.state !== 'pending') return err(409, 'DEVICE_REVOKED', 'this device was revoked');
        const updated = (await tx.query(`UPDATE spawn_backup_keys SET state = 'approved', wrapped_key = $3, approved_by = $4, approved_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING *`, [row.id, userId, b.wrappedKey, b.byDeviceId])).rows[0];
        await event(tx, userId, 'approved', deviceId, b.byDeviceId);
        return { status: 200, body: { device: shapeDevice(updated), replayed: false } };
      });
    },

    async revoke(userId, deviceId, body) {
      if (!DEVICE_ID.test(String(deviceId))) return err(400, 'BAD_DEVICE_ID', 'deviceId format');
      const b = body || {};
      for (const k of Object.keys(b)) if (k !== 'byDeviceId') return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (b.byDeviceId !== undefined && !DEVICE_ID.test(String(b.byDeviceId))) return err(400, 'BAD_DEVICE_ID', 'byDeviceId format');
      return locked(db, userId, async (tx) => {
        const row = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' AND device_id = $2", [userId, deviceId])).rows[0];
        if (!row) return err(404, 'DEVICE_NOT_FOUND', 'no such device');
        if (row.state === 'revoked') return { status: 200, body: { device: shapeDevice(row), replayed: true } };
        const updated = (await tx.query("UPDATE spawn_backup_keys SET state = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *", [row.id])).rows[0];
        await event(tx, userId, 'revoked', deviceId, b.byDeviceId ?? null);
        return { status: 200, body: { device: shapeDevice(updated), replayed: false } };
      });
    },

    async setRecovery(userId, body) {
      const b = body || {};
      for (const k of Object.keys(b)) if (!['byDeviceId', 'wrappedKey'].includes(k)) return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (!DEVICE_ID.test(String(b.byDeviceId))) return err(400, 'BAD_DEVICE_ID', 'byDeviceId format');
      if (typeof b.wrappedKey !== 'string' || !WRAPPED_KEY.test(b.wrappedKey)) return err(400, 'BAD_WRAPPED_KEY', 'wrappedKey is base64url');
      return locked(db, userId, async (tx) => {
        if (!(await approvedDevice(tx, userId, b.byDeviceId))) return err(403, 'APPROVER_NOT_APPROVED', 'only a device that has the key can set the recovery record');
        const cur = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'recovery' AND state = 'current'", [userId])).rows[0];
        if (cur && cur.wrapped_key === b.wrappedKey) return { status: 200, body: { recovery: { wrappedKey: cur.wrapped_key, createdAt: cur.created_at }, replayed: true } };
        if (cur) await tx.query("UPDATE spawn_backup_keys SET state = 'superseded' WHERE id = $1", [cur.id]);
        const row = (await tx.query(`INSERT INTO spawn_backup_keys (user_id, kind, wrapped_key, state, approved_by, approved_at)
          VALUES ($1,'recovery',$2,'current',$3,now()) RETURNING *`, [userId, b.wrappedKey, b.byDeviceId])).rows[0];
        await event(tx, userId, 'recovery_set', null, b.byDeviceId);
        return { status: 200, body: { recovery: { wrappedKey: row.wrapped_key, createdAt: row.created_at }, replayed: false } };
      });
    },

    // STANDARD MODE: an approved device gives the platform the data key, kept only wrapped with the platform key.
    async setAccount(userId, body, env = process.env) {
      const b = body || {};
      for (const k of Object.keys(b)) if (!['byDeviceId', 'dataKey'].includes(k)) return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (!DEVICE_ID.test(String(b.byDeviceId))) return err(400, 'BAD_DEVICE_ID', 'byDeviceId format');
      if (typeof b.dataKey !== 'string' || !DATA_KEY.test(b.dataKey)) return err(400, 'BAD_DATA_KEY', 'dataKey is 32 bytes, base64url without padding');
      const dataKey = Buffer.from(b.dataKey, 'base64url');
      return locked(db, userId, async (tx) => {
        if (!(await approvedDevice(tx, userId, b.byDeviceId))) return err(403, 'APPROVER_NOT_APPROVED', 'only a device that has the key can hand it to the account');
        const cur = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'account' AND state = 'current'", [userId])).rows[0];
        if (cur) {
          let same = false;
          try { same = unwrapDataKey(cur.wrapped_key, { userId, wrapId: cur.id, version: cur.kek_version }, env).equals(dataKey); } catch (e) { if (e instanceof KekUnavailableError) throw e; }
          if (same) return { status: 200, body: { account: { state: 'current', createdAt: cur.created_at, kekVersion: cur.kek_version }, replayed: true } };
          await tx.query("UPDATE spawn_backup_keys SET state = 'superseded' WHERE id = $1", [cur.id]);
        }
        const wrapId = crypto.randomUUID();
        const { wrapped, version } = wrapDataKey(dataKey, { userId, wrapId }, env);
        const row = (await tx.query(`INSERT INTO spawn_backup_keys (id, user_id, kind, wrapped_key, state, approved_by, approved_at, kek_version)
          VALUES ($1,$2,'account',$3,'current',$4,now(),$5) RETURNING *`, [wrapId, userId, wrapped, b.byDeviceId, version])).rows[0];
        await event(tx, userId, 'account_set', null, b.byDeviceId);
        return { status: 201, body: { account: { state: 'current', createdAt: row.created_at, kekVersion: row.kek_version }, replayed: false } };
      });
    },

    // A device of this account gets the data key back. Its FIRST unwrap needs a fresh sign-in and mails the person.
    async getAccount(userId, deviceId, { authTime = null, now = Date.now(), env = process.env, notify = null } = {}) {
      if (!DEVICE_ID.test(String(deviceId))) return err(400, 'BAD_DEVICE_ID', 'deviceId is required');
      const out = await locked(db, userId, async (tx) => {
        const device = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'device' AND device_id = $2", [userId, deviceId])).rows[0];
        if (!device) return err(403, 'DEVICE_NOT_REGISTERED', 'register this device first');
        if (device.state === 'revoked') return err(403, 'DEVICE_REVOKED', 'this device was revoked');
        const wrap = (await tx.query("SELECT * FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'account' AND state = 'current'", [userId])).rows[0];
        if (!wrap) return err(404, 'ACCOUNT_WRAP_ABSENT', 'this account keeps no copy of the key (no backup yet, or private mode)');
        const first = !(await tx.query("SELECT 1 FROM spawn_backup_key_events WHERE user_id = $1 AND kind = 'account_unwrapped' AND device_id = $2 LIMIT 1", [userId, deviceId])).rows.length;
        if (first && !freshSignIn(authTime, now)) return err(401, 'RECENT_SIGN_IN_REQUIRED', 'a new device opens the backup only right after signing in; sign in again and retry');
        const dataKey = unwrapDataKey(wrap.wrapped_key, { userId, wrapId: wrap.id, version: wrap.kek_version }, env);
        await event(tx, userId, 'account_unwrapped', deviceId);
        return { status: 200, body: { dataKey: dataKey.toString('base64url'), kekVersion: wrap.kek_version, firstUnwrap: first }, device };
      });
      if (out.status === 200 && out.body.firstUnwrap && notify) {
        // After the commit, never inside it: the mail is a notice, and a mail failure must not take the key back.
        Promise.resolve(notify({ userId, deviceName: out.device.name || 'a new device', at: new Date(now) })).catch(() => {});
      }
      delete out.device;
      return out;
    },

    // PRIVATE MODE: the account wrap is really deleted (every current and superseded copy). Idempotent.
    async deleteAccount(userId, body) {
      const b = body || {};
      for (const k of Object.keys(b)) if (k !== 'byDeviceId') return err(400, 'UNKNOWN_FIELD', `unknown field ${k}`);
      if (!DEVICE_ID.test(String(b.byDeviceId))) return err(400, 'BAD_DEVICE_ID', 'byDeviceId format');
      return locked(db, userId, async (tx) => {
        if (!(await approvedDevice(tx, userId, b.byDeviceId))) return err(403, 'APPROVER_NOT_APPROVED', 'only a device that has the key can remove the account copy');
        const gone = await tx.query("DELETE FROM spawn_backup_keys WHERE user_id = $1 AND kind = 'account'", [userId]);
        if (gone.rowCount) await event(tx, userId, 'account_wrap_deleted', null, b.byDeviceId);
        return { status: 204, body: undefined };
      });
    },
  };
}

/** Mail the person that a device opened their conversation backup for the first time (the iCloud "new sign-in" notice). */
export async function notifyFirstUnwrap(db, { userId, deviceName, at }) {
  const user = (await db.query('SELECT email, display_name, username FROM users WHERE id = $1', [userId])).rows[0];
  if (!user?.email) return;
  await sendEmail(db, 'spawn_backup_device_opened', user.email, {
    displayName: user.display_name || user.username || 'there', deviceName, when: at.toUTCString(),
  }, userId);
}

/** The object handlers: bytes in the person's Storage, append-only. */
export function spawnBackupObjectHandlers(db, { uploadsDir }) {
  const ensure = (userId) => ensureProjectFolder(db, userId, { app: BACKUP_APP, projectId: backupProjectId(userId), name: 'Conversations (encrypted)' });
  const check = (objectId, part, n) => {
    if (!OBJECT_ID.test(String(objectId))) return err(400, 'BAD_OBJECT_ID', 'objectId is 16-64 base64url characters');
    if (!PART[part]) return err(404, 'NOT_FOUND', 'segments or versions');
    if (!/^\d{1,9}$/.test(String(n)) || Number(n) > MAX_NUMBER) return err(400, 'BAD_NUMBER', 'a number from 0 to 999999999');
    return null;
  };
  return {
    async list(userId) {
      await ensure(userId);
      const { files } = await listProjectFiles(db, userId, BACKUP_APP, backupProjectId(userId));
      const objects = new Map();
      for (const f of files) {
        const [objectId, part, num] = f.path.split('/');
        if (!OBJECT_ID.test(objectId || '') || !PART[part]) continue;
        const o = objects.get(objectId) || { objectId, segments: [], versions: [] };
        o[part].push({ n: Number(num), size: f.size, sha256: f.sha256, at: f.updatedAt });
        objects.set(objectId, o);
      }
      for (const o of objects.values()) { o.segments.sort((a, b) => a.n - b.n); o.versions.sort((a, b) => a.n - b.n); }
      return { status: 200, body: { objects: [...objects.values()] } };
    },
    async put(userId, objectId, part, n, bytes) {
      const bad = check(objectId, part, n); if (bad) return bad;
      if (!Buffer.isBuffer(bytes) || !bytes.length) return err(400, 'NO_CONTENT', 'the body is the ciphertext');
      if (bytes.length > SEGMENT_MAX_BYTES) return err(413, 'TOO_LARGE', `at most ${SEGMENT_MAX_BYTES} bytes per ${part.slice(0, -1)}`);
      await ensure(userId);
      const p = pathOf(objectId, part, Number(n)), digest = crypto.createHash('sha256').update(bytes).digest('hex');
      const before = await projectFileAt(db, userId, BACKUP_APP, backupProjectId(userId), p);
      if (before) {
        if (before.sha256 === digest) return { status: 200, body: { objectId, part, n: Number(n), size: before.size, sha256: digest, created: false } };
        return err(409, 'ALREADY_WRITTEN', `${part.slice(0, -1)} ${n} is already written with other bytes; it is never overwritten`);
      }
      try {
        // a brand-new path refuses a racing writer itself (version_conflict), so two uploads of one number never both land
        const out = await writeProjectFile(db, userId, BACKUP_APP, backupProjectId(userId), p, { bytes, mimeType: 'application/octet-stream', uploadsDir });
        return { status: 200, body: { objectId, part, n: Number(n), size: bytes.length, sha256: out.sha256, created: true } };
      } catch (e) {
        if (e instanceof ProjectFolderError && e.code === 'version_conflict') {
          const now = await projectFileAt(db, userId, BACKUP_APP, backupProjectId(userId), p);
          if (now && now.sha256 === digest) return { status: 200, body: { objectId, part, n: Number(n), size: now.size, sha256: digest, created: false } };
          return err(409, 'ALREADY_WRITTEN', `${part.slice(0, -1)} ${n} is already written with other bytes; it is never overwritten`);
        }
        throw e;
      }
    },
    async read(userId, objectId, part, n) {
      const bad = check(objectId, part, n); if (bad) return bad;
      await ensure(userId);
      try { return { status: 200, file: await readProjectFile(db, userId, BACKUP_APP, backupProjectId(userId), pathOf(objectId, part, Number(n))) }; }
      catch (e) { if (e instanceof ProjectFolderError && e.code === 'file_not_found') return err(404, 'NOT_FOUND', `no such ${part.slice(0, -1)}`); throw e; }
    },
  };
}

export default function spawnBackupRoutes({ uploadsDir }) {
  const router = express.Router();
  const send = (res, out) => (out.status === 204 ? res.status(204).end() : res.status(out.status ?? 200).json(out.body));
  const fail = (res, e) => {
    if (e?.code === 'storage_full') return res.status(507).json({ error: { code: 'STORAGE_FULL', message: e.message } });
    if (e instanceof KekUnavailableError) return res.status(503).json({ error: { code: 'ACCOUNT_WRAP_UNAVAILABLE', message: 'the account copy of the key is not available right now' } });
    if (e instanceof ProjectFolderError) return res.status(e.status).json({ error: { code: String(e.code).toUpperCase(), message: e.message } });
    console.error('[spawn/backup] error:', e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'backup failed' } });
  };
  const keys = (fn) => async (req, res) => { try { send(res, await fn(spawnBackupKeyHandlers(req.db), req)); } catch (e) { fail(res, e); } };
  const objs = (fn) => async (req, res) => { try { send(res, await fn(spawnBackupObjectHandlers(req.db, { uploadsDir }), req)); } catch (e) { fail(res, e); } };

  router.get('/keys', keys((h, req) => h.list(req.user.id)));
  router.put('/keys/devices/:deviceId', keys((h, req) => h.register(req.user.id, req.params.deviceId, req.body)));
  router.post('/keys/devices/:deviceId/approve', keys((h, req) => h.approve(req.user.id, req.params.deviceId, req.body)));
  router.post('/keys/devices/:deviceId/revoke', keys((h, req) => h.revoke(req.user.id, req.params.deviceId, req.body)));
  router.put('/keys/recovery', keys((h, req) => h.setRecovery(req.user.id, req.body)));
  router.put('/keys/account', keys((h, req) => h.setAccount(req.user.id, req.body)));
  router.get('/keys/account', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    keys((h, req) => h.getAccount(req.user.id, req.query.deviceId, { authTime: req.auth?.authTime ?? null, notify: (n) => notifyFirstUnwrap(req.db, n) })));
  router.delete('/keys/account', keys((h, req) => h.deleteAccount(req.user.id, req.body)));

  router.get('/objects', objs((h, req) => h.list(req.user.id)));
  router.put('/objects/:objectId/:part/:n', express.raw({ type: () => true, limit: SEGMENT_MAX_BYTES }),
    objs((h, req) => h.put(req.user.id, req.params.objectId, req.params.part, req.params.n, req.body)));
  router.get('/objects/:objectId/:part/:n', async (req, res) => {
    try {
      const out = await spawnBackupObjectHandlers(req.db, { uploadsDir }).read(req.user.id, req.params.objectId, req.params.part, req.params.n);
      if (!out.file) return send(res, out);
      res.set({ 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': out.file.content_sha256, 'Cache-Control': 'no-store' });
      res.sendFile(out.file.local_path, { dotfiles: 'allow' }, (e) => { if (e && !res.headersSent) res.status(404).json({ error: { code: 'BYTES_MISSING', message: 'being restored; try again shortly' } }); });
    } catch (e) { fail(res, e); }
  });
  return router;
}

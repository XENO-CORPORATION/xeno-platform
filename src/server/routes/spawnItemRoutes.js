/**
 * /api/v2/spawn/projects and /api/v2/spawn/sessions — Spawn's projects and named sessions, synced with the account
 * (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md, "v2"; owner, 2026-11-12: "upload all session and spawn profiles
 * to the account on xenosystem ... so that we can get it on another machines also").
 *
 * The same contract as /api/v2/spawn/profiles, so Spawn's client reuses that code: GET lists the account's items; PUT /:id
 * {baseRev, record} answers {rev} or 409 on a stale base; DELETE /:id {baseRev} leaves a tombstone. The account is ALWAYS
 * req.user.id from the token. A record is checked whole and an unknown field is refused, not trimmed: nothing in it is a
 * secret, and keeping it that way is the point. A folder is a path on ONE PC, so folders are kept per device id.
 */
import express from 'express';

export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const RECORD_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORD = /^[a-z][a-z0-9_-]{0,39}$/;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const text = (v, max, what, bad) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || CONTROL.test(v)) bad.push(`${what} must be one line of at most ${max} characters`);
};
const only = (obj, keys, what, bad) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { bad.push(`${what} must be an object`); return false; }
  for (const k of Object.keys(obj)) if (!keys.includes(k)) bad.push(`unknown field ${what}.${k}`);
  return true;
};
function folders(v, bad) {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || Array.isArray(v)) { bad.push('folders must be an object of deviceId -> path'); return; }
  const entries = Object.entries(v);
  if (entries.length > 50) bad.push('at most 50 devices in folders');
  for (const [device, path] of entries) {
    if (!UUID.test(device)) bad.push(`folders key ${device.slice(0, 40)} is not a device id`);
    if (typeof path !== 'string' || !path || path.length > 1024 || CONTROL.test(path)) bad.push('a folder is a path of at most 1024 characters');
  }
}
const optional = (o, key, re, bad) => { if (o[key] !== undefined && o[key] !== null && (typeof o[key] !== 'string' || !re.test(o[key]))) bad.push(`${key} format`); };

/** What is wrong with a record of `kind`; empty when it may be stored. @param {'project'|'session'} kind */
export function recordViolations(kind, record) {
  /** @type {string[]} */ const bad = [];
  if (kind === 'project') {
    if (!only(record, ['name', 'tabs', 'folders'], 'record', bad)) return bad;
    text(record.name, 120, 'name', bad);
    if (record.tabs !== undefined) {
      if (!Array.isArray(record.tabs) || record.tabs.length > 50) bad.push('tabs must be a list of at most 50');
      else record.tabs.forEach((t, i) => {
        if (!only(t, ['title', 'vendor', 'permission', 'sessionId', 'profileId'], `tabs[${i}]`, bad)) return;
        if (t.title !== undefined && t.title !== null) text(t.title, 120, `tabs[${i}].title`, bad);
        if (typeof t.vendor !== 'string' || !WORD.test(t.vendor)) bad.push(`tabs[${i}].vendor format`);
        optional(t, 'permission', WORD, bad); optional(t, 'sessionId', SESSION_ID, bad); optional(t, 'profileId', ITEM_ID, bad);
      });
    }
    folders(record.folders, bad);
  } else {
    if (!only(record, ['name', 'vendor', 'sessionId', 'chosen', 'permission', 'profileId', 'folders'], 'record', bad)) return bad;
    text(record.name, 120, 'name', bad);
    if (typeof record.vendor !== 'string' || !WORD.test(record.vendor)) bad.push('vendor format');
    optional(record, 'sessionId', SESSION_ID, bad); optional(record, 'permission', WORD, bad); optional(record, 'profileId', ITEM_ID, bad);
    if (record.chosen !== undefined && typeof record.chosen !== 'boolean') bad.push('chosen must be true or false');
    folders(record.folders, bad);
  }
  if (!bad.length && JSON.stringify(record).length > RECORD_MAX_BYTES) bad.push(`record exceeds ${RECORD_MAX_BYTES} bytes`);
  return bad;
}

const conflict = (baseRev, currentRev) => ({ status: 409, body: { error: { code: 'REV_CONFLICT', message: `based on rev ${baseRev}, current is ${currentRev}`, currentRev } } });

/** The handlers for one kind, with the database injected so tests need no server.
 * @param {{query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}>}} db @param {'project'|'session'} kind */
export function spawnItemHandlers(db, kind) {
  const plural = kind === 'project' ? 'projects' : 'sessions';
  const idKey = 'id';
  const current = async (userId, id) => {
    const r = await db.query('SELECT rev FROM spawn_item_sync WHERE user_id = $1 AND kind = $2 AND item_id = $3', [userId, kind, id]);
    return r.rows.length ? r.rows[0].rev : 0;
  };
  return {
    async list(userId) {
      const r = await db.query('SELECT item_id, rev, record, deleted, updated_at FROM spawn_item_sync WHERE user_id = $1 AND kind = $2 ORDER BY updated_at DESC',
        [userId, kind]);
      return { [plural]: r.rows.map(row => ({ [idKey]: row.item_id, rev: row.rev, ...(row.deleted ? { deleted: true } : { record: row.record }), updatedAt: row.updated_at })) };
    },
    async put(userId, id, baseRev, record) {
      if (!ITEM_ID.test(String(id))) return { status: 400, body: { error: { code: 'BAD_ID', message: `${idKey} format` } } };
      if (!Number.isInteger(baseRev) || baseRev < 0) return { status: 400, body: { error: { code: 'BAD_REV', message: 'baseRev must be a non-negative integer' } } };
      const bad = recordViolations(kind, record);
      if (bad.length) return { status: 400, body: { error: { code: 'BAD_RECORD', message: bad.slice(0, 20).join('; ') } } };
      const currentRev = await current(userId, id);
      if (baseRev !== currentRev) return conflict(baseRev, currentRev);
      const rev = currentRev + 1;
      // the WHERE on the update makes a concurrent write with the same base lose, not overwrite
      const w = await db.query(
        `INSERT INTO spawn_item_sync (user_id, kind, item_id, rev, record, deleted, updated_at) VALUES ($1,$2,$3,$4,$5,FALSE,now())
         ON CONFLICT (user_id, kind, item_id) DO UPDATE SET rev = EXCLUDED.rev, record = EXCLUDED.record, deleted = FALSE, updated_at = now()
         WHERE spawn_item_sync.rev = $6 RETURNING rev`,
        [userId, kind, id, rev, JSON.stringify(record), currentRev]);
      if (!w.rows.length) return conflict(baseRev, await current(userId, id));
      return { status: 200, body: { [idKey]: id, rev } };
    },
    async remove(userId, id, baseRev) {
      if (!ITEM_ID.test(String(id))) return { status: 400, body: { error: { code: 'BAD_ID', message: `${idKey} format` } } };
      if (!Number.isInteger(baseRev) || baseRev < 0) return { status: 400, body: { error: { code: 'BAD_REV', message: 'baseRev must be a non-negative integer' } } };
      const currentRev = await current(userId, id);
      if (baseRev !== currentRev) return conflict(baseRev, currentRev);
      const rev = currentRev + 1;
      const w = await db.query(
        `INSERT INTO spawn_item_sync (user_id, kind, item_id, rev, record, deleted, updated_at) VALUES ($1,$2,$3,$4,NULL,TRUE,now())
         ON CONFLICT (user_id, kind, item_id) DO UPDATE SET rev = EXCLUDED.rev, record = NULL, deleted = TRUE, updated_at = now()
         WHERE spawn_item_sync.rev = $5 RETURNING rev`,
        [userId, kind, id, rev, currentRev]);
      if (!w.rows.length) return conflict(baseRev, await current(userId, id));
      return { status: 200, body: { [idKey]: id, rev, deleted: true } };
    },
  };
}

/** A router for one kind. @param {'project'|'session'} kind */
export function spawnItemRouter(kind) {
  const router = express.Router();
  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(spawnItemHandlers(req.db, kind), req);
      res.status(out.status ?? 200).json(out.body);
    } catch (e) {
      console.error(`[spawn/${kind}s] error:`, e instanceof Error ? e.message : String(e));
      res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: `${kind} sync failed` } });
    }
  };
  router.get('/', wrap(async (h, req) => ({ body: await h.list(req.user.id) })));
  router.put('/:id', wrap(async (h, req) => h.put(req.user.id, req.params.id, req.body?.baseRev, req.body?.record)));
  router.delete('/:id', wrap(async (h, req) => h.remove(req.user.id, req.params.id, req.body?.baseRev ?? -1)));
  return router;
}

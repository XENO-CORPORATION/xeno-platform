/**
 * /api/storage/service/depot/v1/* — XENO Depot's object store on XENO Storage, SERVICE-authenticated.
 * The store and its rules are services/storageDepotObjects.js; this file is only the wire.
 *
 * Caller: XENO Depot's server (depot.xenosystem.ai), never a browser or a person. It has already authorised the
 * repository → workspace through its own gate (xeno-depot decision 0001 §3), so the bearer token can act on any
 * workspace's Depot namespace and is a HIGH-VALUE secret: constant-time compared, never logged, fail-closed when
 * unset. It reaches nothing outside this namespace.
 *
 * Auth: `Authorization: Bearer <DEPOT_STORAGE_SERVICE_TOKEN>`. Unset/empty → 401 for everything.
 * Mounted with databaseMiddleware and WITHOUT authMiddleware (there is no req.user), like serviceLedgerRoutes.js.
 *
 *   PUT  /workspaces/:wid/objects/:hash    body = bytes; X-Content-SHA256 required, X-Xeno-Object-Meta optional
 *                                          201 created · 200 already there (same bytes) · 409 different bytes · 507 full
 *   GET  /workspaces/:wid/objects/:hash    Range: bytes=a-b | a- | -n supported (206)
 *   HEAD /workspaces/:wid/objects/:hash
 *   DELETE /workspaces/:wid/objects/:hash  Depot decided nothing references it; 200 removed · 404 nothing there
 *   POST /workspaces/:wid/objects/exists  { hashes: [...] } → { present: { hash: { size, meta } }, absent: [...] }
 *   POST /workspaces/:wid/objects/urls     { hashes: [...], ttl?: ≤300 } → { urls: { hash: { url, size, sha256, meta } }, absent, expiresAt }
 *                                          URLs on the objects host (objects.xenosystem.ai); 503 when DEPOT_OBJECT_URL_KEY is unset
 *   GET  /workspaces/:wid/usage         { usedBytes, allowanceBytes, depotBytes, objects }
 */
import crypto from 'node:crypto';
import express from 'express';
import {
  putDepotObject, getDepotObject, headDepotObject, depotObjectsExist, depotUsage, deleteDepotObject, signDepotObjectUrls,
  assertWorkspaceId, MAX_DEPOT_OBJECT_BYTES,
} from '../services/storageDepotObjects.js';
import { workspaceUsedBytes, workspaceStorageAllowance, storageUsage } from '../services/storageAllowance.js';
import { ownerScopeOf } from '../services/ownerScope.js';

const tokenMatches = (presented, expected) => {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
};

function serviceAuth(env) {
  return (req, res, next) => {
    const expected = (env.DEPOT_STORAGE_SERVICE_TOKEN || '').trim();
    const header = req.get('authorization') || '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!expected || !presented || !tokenMatches(presented, expected)) return res.status(401).json({ error: { code: 'unauthorized' } });
    next();
  };
}

function sendErr(res, error) {
  const status = error.status || (error.code === 'storage_full' ? 507 : 500);
  if (status >= 500 && error.code !== 'storage_full') console.error('[storage/depot] error:', error.code || '', error.message);
  const body = { error: { code: error.code || 'platform_error', message: status === 500 ? 'internal error' : error.message } };
  if (error.code === 'storage_full') Object.assign(body.error, { usedBytes: error.usedBytes, allowanceBytes: error.allowanceBytes, neededBytes: error.neededBytes });
  return res.status(status).json(body);
}

/** `Range: bytes=…` as { start, end } (end null = to the end), `{ suffix }` for `-n`, or null. Throws on a multi-range. */
export function parseRange(header) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) throw Object.assign(new Error('only one bytes=a-b range is supported'), { code: 'bad_range', status: 416 });
  if (m[1] === '') return { suffix: Number(m[2]) };
  return { start: Number(m[1]), end: m[2] === '' ? null : Number(m[2]) };
}

const objectHeaders = (res, object) => {
  res.set('X-Content-SHA256', object.sha256);
  if (object.meta !== null) res.set('X-Xeno-Object-Meta', object.meta);
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');   // content-addressed: never changes
  res.set('Content-Type', 'application/octet-stream');
};

export function createStorageDepotServiceRouter({ env = process.env, store } = {}) {
  const router = express.Router();
  const opts = store ? { store } : {};
  router.use(serviceAuth(env));
  router.param('wid', (req, res, next, wid) => { try { assertWorkspaceId(wid); next(); } catch (e) { sendErr(res, e); } });

  router.put('/workspaces/:wid/objects/:hash',
    express.raw({ type: () => true, limit: MAX_DEPOT_OBJECT_BYTES }),
    async (req, res) => {
      try {
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const meta = req.get('x-xeno-object-meta') ?? null;
        const result = await putDepotObject(req.db, { workspaceId: req.params.wid, hash: req.params.hash, bytes, sha256: (req.get('x-content-sha256') || '').toLowerCase(), meta }, opts);
        res.status(result.created ? 201 : 200).json({ created: result.created, object: result.object });
      } catch (error) { sendErr(res, error); }
    });

  router.head('/workspaces/:wid/objects/:hash', async (req, res) => {
    try {
      const object = await headDepotObject(req.db, { workspaceId: req.params.wid, hash: req.params.hash });
      if (!object) return res.status(404).end();
      objectHeaders(res, object); res.set('Content-Length', String(object.size)); res.status(200).end();
    } catch (error) { res.status(error.status || 500).end(); }
  });

  router.get('/workspaces/:wid/objects/:hash', async (req, res) => {
    try {
      let range = parseRange(req.get('range'));
      if (range?.suffix !== undefined) {
        const object = await headDepotObject(req.db, { workspaceId: req.params.wid, hash: req.params.hash });
        if (!object) return res.status(404).json({ error: { code: 'not_found' } });
        if (range.suffix === 0) { res.set('Content-Range', `bytes */${object.size}`); return res.status(416).json({ error: { code: 'range_not_satisfiable' } }); }
        range = { start: Math.max(0, object.size - range.suffix), end: object.size - 1 };
      }
      const got = await getDepotObject(req.db, { workspaceId: req.params.wid, hash: req.params.hash, range }, opts);
      if (!got) return res.status(404).json({ error: { code: 'not_found' } });
      objectHeaders(res, got.object);
      res.set('Content-Length', String(got.bytes.length));
      if (range) { res.set('Content-Range', `bytes ${got.start}-${got.end}/${got.object.size}`); return res.status(206).end(got.bytes); }
      return res.status(200).end(got.bytes);
    } catch (error) {
      if (error.code === 'range_not_satisfiable' && error.size !== undefined) res.set('Content-Range', `bytes */${error.size}`);
      sendErr(res, error);
    }
  });

  router.delete('/workspaces/:wid/objects/:hash', async (req, res) => {
    try {
      const removed = await deleteDepotObject(req.db, { workspaceId: req.params.wid, hash: req.params.hash }, opts);
      res.status(removed ? 200 : 404).json({ deleted: removed });
    } catch (error) { sendErr(res, error); }
  });

  router.post('/workspaces/:wid/objects/exists', express.json({ limit: '256kb' }), async (req, res) => {
    try { res.json(await depotObjectsExist(req.db, { workspaceId: req.params.wid, hashes: req.body?.hashes })); }
    catch (error) { sendErr(res, error); }
  });

  router.post('/workspaces/:wid/objects/urls', express.json({ limit: '256kb' }), async (req, res) => {
    try { res.json(await signDepotObjectUrls(req.db, { workspaceId: req.params.wid, hashes: req.body?.hashes, ttlSeconds: req.body?.ttl ?? undefined }, { env })); }
    catch (error) { sendErr(res, error); }
  });

  router.get('/workspaces/:wid/usage', async (req, res) => {
    try {
      const workspaceId = req.params.wid;
      const scope = await ownerScopeOf(req.db, { workspaceId });
      const depot = await depotUsage(req.db, workspaceId);
      if (scope.personal) {
        const u = await storageUsage(req.db, scope.accountableUserId);
        return res.json({ usedBytes: u.usedBytes, allowanceBytes: u.allowanceBytes, depotBytes: depot.bytes, objects: depot.objects });
      }
      const [usedBytes, allowanceBytes] = await Promise.all([workspaceUsedBytes(req.db, workspaceId), workspaceStorageAllowance(req.db, workspaceId)]);
      res.json({ usedBytes, allowanceBytes, depotBytes: depot.bytes, objects: depot.objects });
    } catch (error) { sendErr(res, error); }
  });

  // express.raw's size refusal arrives here: answer it in this namespace's shape
  router.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: `an object is at most ${MAX_DEPOT_OBJECT_BYTES} bytes` } });
    return sendErr(res, error);
  });
  return router;
}

export default createStorageDepotServiceRouter();

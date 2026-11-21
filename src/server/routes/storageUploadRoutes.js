/**
 * /api/library/uploads — XENO Storage upload sessions (services/storageUploads.js), behind the account's sign-in.
 *
 *   POST   /                  { name, size, type, workspace? } → session { id, partSize, partCount, transport, parts: [] }
 *   GET    /:id               the session, the parts the store holds (resume after a reload or a dropped connection),
 *                             and a fresh transport token
 *   PUT    /:id/parts/:n      one part, only where the session's transport is `platform` (no objects host configured)
 *   POST   /:id/complete      close it; answers at once with state `processing`, then poll GET until `done` or `failed`
 *   DELETE /:id               abort and free the parts
 *
 * Mounted before the global body parsers (index.js): the part route reads its own raw body, capped at one part.
 */
import express from 'express';
import {
  openUploadSession, getUploadSession, putUploadPart, completeUploadSession, abortUploadSession, MAX_PART_BYTES,
} from '../services/storageUploads.js';

export function createStorageUploadRouter({ authMiddleware, databaseMiddleware, uploadsDir, store, env = process.env }) {
  const router = express.Router();
  const opts = { uploadsDir, env, ...(store ? { store } : {}) };
  const send = (res, error) => {
    const status = error.status || (error.code === 'storage_full' ? 507 : 500);
    if (status >= 500 && error.code !== 'storage_full' && error.code !== 'busy') console.error('[storage/uploads] error:', error.code || '', error.message);
    const body = { success: false, code: error.code || 'error', error: status === 500 ? 'Something went wrong. Try again.' : error.message };
    if (error.missing) body.missing = error.missing;
    if (error.code === 'storage_full') Object.assign(body, { usedBytes: error.usedBytes, allowanceBytes: error.allowanceBytes });
    res.status(status).json(body);
  };
  router.use(databaseMiddleware, authMiddleware);

  router.post('/', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const b = req.body || {};
      res.status(201).json({ success: true, session: await openUploadSession(req.db, { userId: req.user.id, workspaceId: b.workspace || null, name: b.name, mimeType: b.type, size: b.size, area: req.xenoArea ?? null }, opts) });
    } catch (error) { send(res, error); }
  });
  router.get('/:id', async (req, res) => {
    try { res.json({ success: true, session: await getUploadSession(req.db, { userId: req.user.id, id: req.params.id }, opts) }); }
    catch (error) { send(res, error); }
  });
  router.put('/:id/parts/:n', express.raw({ type: () => true, limit: MAX_PART_BYTES }), async (req, res) => {
    try { res.json({ success: true, part: await putUploadPart(req.db, { userId: req.user.id, id: req.params.id, partNumber: req.params.n, bytes: req.body }, opts) }); }
    catch (error) { send(res, error); }
  });
  router.post('/:id/complete', async (req, res) => {
    try { res.status(202).json({ success: true, session: await completeUploadSession(req.db, { userId: req.user.id, id: req.params.id }, opts) }); }
    catch (error) { send(res, error); }
  });
  router.delete('/:id', async (req, res) => {
    try { res.json({ success: true, session: await abortUploadSession(req.db, { userId: req.user.id, id: req.params.id }, opts) }); }
    catch (error) { send(res, error); }
  });
  router.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, code: 'too_large', error: 'A part is larger than allowed' });
    return send(res, error);
  });
  return router;
}

import express from 'express';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.js';
import { siteOrigin } from '../config/hosts.js';
import {
  createSignedLibraryContentPath,
  deleteLibraryItem,
  getManagedLibraryFile,
  isLibraryUuid,
  listLibraryItems,
  resolveManagedLibraryPath,
  verifySignedLibraryContentRequest,
} from '../services/libraryAssets.js';

const router = express.Router();

const streamAsset = async (req, res, userId, signed = false) => {
  try {
    const file = await getManagedLibraryFile(req.db, req.params.id, userId);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    const resolved = resolveManagedLibraryPath(file.storage_path);
    if (!resolved) return res.status(404).json({ success: false, error: 'File data not found' });
    const name = String(file.original_name || file.filename || 'download').replace(/[\r\n"]/g, '_');
    const inlineMime = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    const download = req.query.download === '1';
    const disposition = download || !inlineMime.has(file.mime_type) ? 'attachment' : 'inline';
    const stat = fs.statSync(resolved);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(file.file_size || stat.size));
    res.setHeader('Content-Disposition', `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (signed) {
      const remaining = Math.max(Number(req.query.expires) - Math.floor(Date.now() / 1000), 0);
      res.setHeader('Cache-Control', `public, max-age=${Math.min(remaining, 86400)}, immutable`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    } else {
      res.setHeader('Cache-Control', 'private, max-age=300');
    }
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    console.error('Failed to stream Library asset:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// A signed URL is a short-lived, asset- and account-bound capability. Without a
// valid signature this endpoint falls back to normal bearer authentication.
router.get('/assets/:id/content', async (req, res, next) => {
  const signed = req.query.v === 'v1' && verifySignedLibraryContentRequest({
    assetId: req.params.id,
    userId: String(req.query.uid || ''),
    expires: req.query.expires,
    download: req.query.download === '1',
    signature: req.query.sig,
  });
  if (signed) return streamAsset(req, res, String(req.query.uid), true);
  return authMiddleware(req, res, (error) => {
    if (error) return next(error);
    return streamAsset(req, res, req.user.id, false);
  });
});

router.use(authMiddleware);

router.get('/assets', async (req, res) => {
  try {
    const result = await listLibraryItems(req.db, req.user.id, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to list account Library:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/assets/:id/link', async (req, res) => {
  try {
    if (!isLibraryUuid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid asset id' });
    const file = await getManagedLibraryFile(req.db, req.params.id, req.user.id);
    if (!file) return res.status(404).json({ success: false, error: 'Library asset not found' });
    const download = req.body?.download === true;
    const contentPath = createSignedLibraryContentPath({
      assetId: req.params.id,
      userId: req.user.id,
      ttlSeconds: req.body?.ttl_seconds,
      download,
    });
    res.json({
      success: true,
      // Mint the platform's canonical public authority. `req.protocol` sees the
      // last trusted proxy hop and was emitting http:// behind CF -> nginx,
      // which makes browser drag targets downgrade and breaks strict consumers.
      url: `${siteOrigin()}${contentPath}`,
      content_path: contentPath,
      name: file.original_name || file.filename,
      mime_type: file.mime_type,
    });
  } catch (error) {
    console.error('Failed to sign Library link:', error);
    res.status(500).json({ success: false, error: 'Could not create Library link' });
  }
});

router.delete('/assets/:source/:id', async (req, res) => {
  try {
    const result = await deleteLibraryItem(req.db, req.user.id, String(req.params.source), req.params.id);
    if (result.invalid) return res.status(400).json({ success: false, error: 'Invalid Library item id' });
    if (result.unsupported) return res.status(400).json({ success: false, error: 'Unsupported Library source' });
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Library item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete Library item:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

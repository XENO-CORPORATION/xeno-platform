import express from 'express';
import fs from 'fs';
import sharp from 'sharp';
import { authMiddleware } from '../middleware/auth.js';
import { siteOrigin } from '../config/hosts.js';
import {
  createSignedLibraryContentPath,
  createAuthorizedLibraryContentPath,
  deleteLibraryItem,
  getManagedLibraryFile,
  getAuthorizedLibraryFile,
  isLibraryUuid,
  listLibraryItems,
  resolveManagedLibraryPath,
  verifySignedLibraryContentRequest,
  verifyAuthorizedLibraryContentRequest,
} from '../services/libraryAssets.js';
import { requireResourceRelation, sendChatAuthorityError } from '../services/chatProjectAuthority.js';

const router = express.Router();

const streamAsset = async (req, res, fileOrPrincipal, signed = false) => {
  try {
    const file = fileOrPrincipal?.storage_path
      ? fileOrPrincipal
      : await getAuthorizedLibraryFile(req.db, fileOrPrincipal, req.params.id);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (file.ingestion_safe === false) {
      return res.status(423).json({ success: false, error: 'File is still in security quarantine', code: 'asset_quarantined' });
    }
    const resolved = resolveManagedLibraryPath(file.storage_path);
    if (!resolved) return res.status(404).json({ success: false, error: 'File data not found' });
    const name = String(file.original_name || file.filename || 'download').replace(/[\r\n"]/g, '_');
    const inlineMime = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    const download = req.query.download === '1';
    const thumbnail = req.query.variant === 'thumbnail' && !download && inlineMime.has(file.mime_type);
    const disposition = download || !inlineMime.has(file.mime_type) ? 'attachment' : 'inline';
    const stat = fs.statSync(resolved);
    res.setHeader('Content-Type', thumbnail ? 'image/webp' : file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!thumbnail) res.setHeader('Content-Length', String(file.file_size || stat.size));
    res.setHeader('Content-Disposition', `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (signed) {
      const remaining = Math.max(Number(req.query.expires) - Math.floor(Date.now() / 1000), 0);
      res.setHeader('Cache-Control', `public, max-age=${Math.min(remaining, 86400)}, immutable`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    } else {
      res.setHeader('Cache-Control', 'private, max-age=300');
    }
    const input = fs.createReadStream(resolved);
    if (thumbnail) {
      input
        .pipe(sharp().rotate().resize(384, 384, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 78 }))
        .on('error', (error) => {
          console.error('Failed to create Library thumbnail:', error);
          if (!res.headersSent) res.status(500).end();
          else res.destroy(error);
        })
        .pipe(res);
      return;
    }
    input.pipe(res);
  } catch (error) {
    console.error('Failed to stream Library asset:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// A signed URL is a short-lived, asset- and account-bound capability. Without a
// valid signature this endpoint falls back to normal bearer authentication.
router.get('/assets/:id/content', async (req, res, next) => {
  if (req.query.v === 'v2') {
    const verified = await verifyAuthorizedLibraryContentRequest(req.db, {
      assetId: req.params.id,
      grantId: String(req.query.grant || ''),
      expires: req.query.expires,
      download: req.query.download === '1',
      signature: req.query.sig,
    });
    if (verified) return streamAsset(req, res, verified.file, true);
  }
  const signed = req.query.v === 'v1' && verifySignedLibraryContentRequest({
    assetId: req.params.id,
    userId: String(req.query.uid || ''),
    expires: req.query.expires,
    download: req.query.download === '1',
    signature: req.query.sig,
  });
  if (signed) {
    const file = await getManagedLibraryFile(req.db, req.params.id, String(req.query.uid));
    if (file) return streamAsset(req, res, file, true);
  }
  return authMiddleware(req, res, (error) => {
    if (error) return next(error);
    return streamAsset(req, res, { type: 'user', id: req.user.id }, false);
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
    const download = req.body?.download === true;
    const signed = await createAuthorizedLibraryContentPath(req.db, {
      assetId: req.params.id,
      principal: { type: 'user', id: req.user.id },
      ttlSeconds: req.body?.ttl_seconds,
      download,
      projectId: req.body?.project_id || null,
      workspaceId: req.body?.workspace_id || null,
    });
    if (!signed) return res.status(404).json({ success: false, error: 'Library asset not found' });
    const { path: contentPath, file } = signed;
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

router.post('/assets/:id/ingestions/retry', async (req, res) => {
  try {
    if (!isLibraryUuid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid asset id' });
    await requireResourceRelation(req.db, { type: 'user', id: req.user.id }, 'library_asset', req.params.id, 'editor');
    const { rows } = await req.db.query(
      `UPDATE library_asset_ingestions
       SET state = 'queued', attempt_count = 0, error_code = NULL, error_message = NULL,
           lease_owner = NULL, lease_expires_at = NULL, completed_at = NULL, updated_at = NOW()
       WHERE id = (
         SELECT id FROM library_asset_ingestions WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 1
       )
       RETURNING id, asset_id, state`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Ingestion not found' });
    res.json({ success: true, ingestion: rows[0] });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to retry Library ingestion:', error);
    res.status(500).json({ success: false, error: 'Could not retry Library ingestion' });
  }
});

router.delete('/assets/:source/:id', async (req, res) => {
  try {
    const result = await deleteLibraryItem(req.db, { type: 'user', id: req.user.id }, String(req.params.source), req.params.id);
    if (result.invalid) return res.status(400).json({ success: false, error: 'Invalid Library item id' });
    if (result.unsupported) return res.status(400).json({ success: false, error: 'Unsupported Library source' });
    if (result.conflict) return res.status(409).json({ success: false, error: 'Library asset is linked to an active project', code: 'asset_has_project_references', reference_count: result.referenceCount });
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Library item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete Library item:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

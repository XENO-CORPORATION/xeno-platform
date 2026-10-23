/**
 * /api/storage/projects/:app/:projectId — an app's project files, kept in XENO Storage (services/projectFolders.js).
 *
 *   PUT    /:app/:projectId                       { name, workspace? }  the project's folder, made on first use
 *   GET    /:app/:projectId/files                                       every path with its current version
 *   GET    /:app/:projectId/files/content?path=                         the bytes of one path
 *   PUT    /:app/:projectId/files/content?path=   raw body, If-Match?  write: new file or new version
 *   DELETE /:app/:projectId/files?path=                                 to the Storage trash
 *
 * Called AS THE PERSON. An app's own OIDC token reaches only that app's projects (its client id is the `:app`), so one
 * product cannot walk another's project folders; the person's own platform session may open any of theirs.
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { ProjectFolderError, ensureProjectFolder, listProjectFiles, readProjectFile, writeProjectFile, removeProjectFile } from '../services/projectFolders.js';

const MAX_BYTES = 100 * 1024 * 1024;   // the same ceiling as any Storage upload

export default function projectFolderRoutes({ uploadsDir }) {
  const router = express.Router();
  router.use(authMiddleware);
  router.use('/:app', (req, res, next) => {
    if (req.auth?.kind === 'oidc' && req.auth.clientId !== req.params.app) return res.status(403).json({ success: false, code: 'wrong_app', error: 'This app can only reach its own projects' });
    next();
  });
  const fail = (res, error) => {
    if (error instanceof ProjectFolderError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    if (error?.code === 'storage_full') return res.status(507).json({ success: false, code: 'storage_full', error: error.message, usedBytes: error.usedBytes, allowanceBytes: error.allowanceBytes });
    if (error?.code === 'version_conflict') return res.status(409).json({ success: false, code: 'version_conflict', error: error.message });
    console.error('[ProjectFolders]', error);
    return res.status(500).json({ success: false, error: 'Project storage failed' });
  };

  router.put('/:app/:projectId', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const workspaceId = req.body?.workspace ? String(req.body.workspace) : null;
      const out = await ensureProjectFolder(req.db, req.user.id, { app: req.params.app, projectId: req.params.projectId, name: req.body?.name, workspaceId });
      res.status(out.created ? 201 : 200).json({ success: true, created: out.created, folder: { id: out.folder.id, name: out.folder.name, workspaceId: out.folder.workspace_id || null, url: `/workspace/storage/f/${out.folder.id}` } });
    } catch (error) { fail(res, error); }
  });

  router.get('/:app/:projectId/files', async (req, res) => {
    try { res.json({ success: true, ...(await listProjectFiles(req.db, req.user.id, req.params.app, req.params.projectId)) }); }
    catch (error) { fail(res, error); }
  });

  router.get('/:app/:projectId/files/content', async (req, res) => {
    try {
      const row = await readProjectFile(req.db, req.user.id, req.params.app, req.params.projectId, String(req.query.path || ''));
      res.set({ 'Content-Type': row.mime_type || 'application/octet-stream', ETag: `"${row.content_sha256}"`, 'X-Content-Type-Options': 'nosniff', 'X-Xeno-File-Id': String(row.file_id) });
      res.sendFile(row.storage_path, (error) => { if (error && !res.headersSent) res.status(404).json({ success: false, code: 'bytes_missing', error: 'The file is being restored; try again shortly' }); });
    } catch (error) { fail(res, error); }
  });

  router.put('/:app/:projectId/files/content', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    try {
      const match = String(req.get('If-Match') || '').replace(/^W\//, '').replace(/"/g, '').trim();
      const out = await writeProjectFile(req.db, req.user.id, req.params.app, req.params.projectId, String(req.query.path || ''), {
        bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        mimeType: String(req.get('Content-Type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream',
        uploadsDir, ifMatch: match || null,
      });
      res.status(out.created ? 201 : 200).json({ success: true, ...out });
    } catch (error) { fail(res, error); }
  });

  router.delete('/:app/:projectId/files', async (req, res) => {
    try { res.json({ success: true, ...(await removeProjectFile(req.db, req.user.id, req.params.app, req.params.projectId, String(req.query.path || ''))) }); }
    catch (error) { fail(res, error); }
  });
  return router;
}

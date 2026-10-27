import { fileIdOf, listVersions, restoreVersion, revisionFor } from '../services/storageVersions.js';
import { run as runOperation, lookup as lookupOperation, keyFrom, IdempotencyError } from '../services/storageOperations.js';
/** The revision an If-Match names ("<id>", W/"<id>" or <id>), or null; '*' means any. */
export const ifMatchRevision = (req) => { const v = String(req.get('if-match') || '').trim().replace(/^W\//, '').replace(/"/g, ''); return v && v !== '*' ? v : null; };
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import { createFolderLink, folderLinkActivity, listFolderLinks, revokeFolderLink } from '../services/storageFolderLinks.js';
import { createLink, fileForLink, foldersSharedWith, listShares, revokeShare, shareWithPerson } from '../services/storageShares.js';
import { allFolders, createFolder, listFolders, moveItemToFolder, removeFolder, updateFolder } from '../services/storageFolders.js';
import { localLibraryPath } from '../services/storageObjects.js';
import { storageUsage } from '../services/storageAllowance.js';
import express from 'express';
import fs from 'fs';
import sharp from 'sharp';
import { authMiddleware } from '../middleware/auth.js';
import { siteOrigin, publicSiteOrigin } from '../config/hosts.js';
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
import {
  emptyLibraryTrash, placeLibraryItem, purgeLibraryItem, renameLibraryItem, restoreLibraryItem, starLibraryItem, trashLibraryItem,
} from '../services/libraryOrganise.js';
import { storageChanges } from '../services/storageChanges.js';
import { readArea, readAreaFilter } from '../utils/resourceArea.js';

const router = express.Router();

// XENO Storage: a file keeps one id through every version (storageVersions.revisionFor). Wherever a route names a
// file by `:id`, the file's id means its newest version and a version's own id means that exact version, so a link,
// a sync client or a canvas card that remembered the file keeps working after a new version is uploaded.
router.param('id', async (req, _res, next, id) => {
  try { req.params.id = await revisionFor(req.db, id); next(); } catch (error) { next(error); }
});

export const streamAsset = async (req, res, fileOrPrincipal, signed = false) => {
  try {
    const file = fileOrPrincipal?.storage_path
      ? fileOrPrincipal
      : await getAuthorizedLibraryFile(req.db, fileOrPrincipal, req.params.id);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (file.ingestion_safe === false) {
      return res.status(423).json({ success: false, error: 'File is still in security quarantine', code: 'asset_quarantined' });
    }
    const resolved = await localLibraryPath(req.db, file);   // the cached copy, or the bytes brought back from the object store
    if (!resolved) return res.status(404).json({ success: false, error: 'File data not found' });
    const name = String(file.original_name || file.filename || 'download').replace(/[\r\n"]/g, '_');
    const inlineMime = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    // the version served, as an entity tag a sync client compares, and the file it is a version of
    res.setHeader('ETag', `"${file.id}"`);
    if (file.file_id) res.setHeader('X-Xeno-File-Id', String(file.file_id));
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

// XENO Storage: a secret link to one file. Public by design: the link is the permission. The bytes go out
// through the same streamer the owner uses (scan state honoured; only plain images inline, the rest download).
router.get('/links/:token', async (req, res) => {
  try {
    const file = await fileForLink(req.db, req.params.token);
    if (!file) return res.status(404).json({ success: false, code: 'link_not_found', error: 'This link does not open anything. It may have expired or been turned off.' });
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return streamAsset(req, res, file, true);
  } catch (error) { console.error('Failed to serve a storage link:', error); return res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.use(authMiddleware);

// XENO Storage: what the account holds and what its plan includes (services/storageAllowance.js).
router.get('/storage', async (req, res) => {
  try { res.json({ success: true, storage: await storageUsage(req.db, req.user.id) }); }
  catch (error) { console.error('Failed to read storage usage:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// XENO Storage: folders (services/storageFolders.js). A folder is the signed-in person's own.
const folderReply = (res, result, body = {}) => {
  if (result.ok) return res.json({ success: true, ...body });
  if (result.invalid) return res.status(400).json({ success: false, code: result.code || 'invalid', error: 'That name can’t be used.' });
  if (result.notFound) return res.status(404).json({ success: false, code: 'not_found', error: 'Folder not found' });
  if (result.forbidden) return res.status(403).json({ success: false, code: 'forbidden', error: 'You can see this item but can’t move it' });
  if (result.conflict) return res.status(409).json({ success: false, code: result.code, error: { folder_exists: 'A folder with that name is already here.', folder_not_empty: 'Move or delete what is inside first.', folder_inside_itself: 'A folder can’t be moved into itself.', folder_other_place: 'That belongs to a different place. A team’s files stay in that team’s folders.' }[result.code] || 'Refused' });
  return res.status(500).json({ success: false, error: 'Internal server error' });
};
const folderId = (value) => (value === null || value === undefined || value === '' || value === 'root' ? null : String(value));
const folders = (run) => async (req, res) => { try { await run(req, res); } catch (error) { console.error('Storage folder request failed:', error); res.status(500).json({ success: false, error: 'Internal server error' }); } };
// The desktop drive asks which folders changed since its cursor (services/storageChanges.js), instead of relisting all.
router.get('/changes', folders(async (req, res) => { res.json({ success: true, ...(await storageChanges(req.db, req.user.id, req.query.since ? String(req.query.since) : null)) }); }));
router.get('/folders', folders(async (req, res) => {
  if (req.query.shared === 'true') return res.json({ success: true, folders: await foldersSharedWith(req.db, req.user.id), path: [] });   // folders other people shared with me
  const team = req.query.workspace ? String(req.query.workspace) : null;   // a workspace's team folders
  if (req.query.all === 'true') return res.json({ success: true, folders: await allFolders(req.db, req.user.id, team) });
  const result = await listFolders(req.db, req.user.id, folderId(req.query.parent), team);
  folderReply(res, result, { folders: result.folders, path: result.path, workspace: result.workspaceId, shared: result.shared === true });
}));
router.post('/folders', folders(async (req, res) => { const result = await createFolder(req.db, req.user.id, { name: req.body?.name, parentId: folderId(req.body?.parent), workspaceId: req.body?.workspace ? String(req.body.workspace) : null }); folderReply(res.status(result.ok ? 201 : res.statusCode), result, { folder: result.folder }); }));
router.patch('/folders/:id', folders(async (req, res) => {
  const result = await updateFolder(req.db, req.user.id, req.params.id, { name: req.body?.name, ...('parent' in (req.body || {}) ? { parentId: folderId(req.body.parent) } : {}) });
  folderReply(res, result, { folder: result.folder });
}));
router.delete('/folders/:id', folders(async (req, res) => { folderReply(res, await removeFolder(req.db, req.user.id, req.params.id)); }));

router.get('/assets', async (req, res) => {
  try {
    try { readAreaFilter(req.query.area); } catch (error) { return res.status(400).json({ success: false, code: 'invalid_area', error: error.message }); }
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

// Readiness of an asset's malware scan, so the composer can wait for it BEFORE a file is sent into a
// conversation (rather than showing "still scanning" after the fact). `ingestion_safe === false` is the
// quarantine window; null/true means the scan has cleared and the asset can be served and referenced.
router.get('/assets/:id/status', async (req, res) => {
  try {
    if (!isLibraryUuid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid asset id' });
    const file = await getAuthorizedLibraryFile(req.db, { type: 'user', id: req.user.id }, req.params.id);
    if (!file) return res.status(404).json({ success: false, error: 'Library asset not found' });
    // `blocked` is the one TERMINAL answer the composer needs besides `ready`: a file the scanner
    // flagged is never going to clear, so waiting for it would trap the composer forever. Every other
    // not-ready state (queued, scanning, a retry) means "keep waiting" — never "send it anyway".
    res.json({
      success: true,
      ready: file.ingestion_safe !== false,
      state: file.ingestion_state || 'queued',
      blocked: file.ingestion_error_code === 'malware_detected',
    });
  } catch (error) {
    console.error('Failed to read Library asset status:', error);
    res.status(500).json({ success: false, error: 'Could not read Library asset status' });
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

// ── Organise: rename, star, trash, restore, delete forever ─────────────────────────────────────────
// One answer shape for all of them. 404 covers both "no such item" and "you may not see it".
const sendOrganised = (res, result, body = {}) => {
  if (result.ok) return res.json({ success: true, ...body });
  if (result.invalid) return res.status(400).json({ success: false, error: result.code === 'invalid_name' ? 'That name can’t be used' : 'Invalid Library item', code: result.code || 'invalid_item' });
  if (result.unsupported) return res.status(400).json({ success: false, error: 'This kind of item can’t do that', code: result.code || 'unsupported' });
  if (result.notFound) return res.status(404).json({ success: false, error: 'Library item not found', code: 'not_found' });
  if (result.forbidden) return res.status(403).json({ success: false, error: 'You can see this item but can’t change it', code: 'forbidden' });
  if (result.conflict) return res.status(409).json({ success: false, error: 'The item’s state refuses this change', code: result.code, ...(result.referenceCount ? { reference_count: result.referenceCount } : {}) });
  return res.status(500).json({ success: false, error: 'Internal server error' });
};
const organise = (label, run) => async (req, res) => {
  try { await run(req, res, { type: 'user', id: req.user.id }, String(req.params.source), req.params.id); }
  catch (error) { console.error(`Failed to ${label} Library item:`, error); res.status(500).json({ success: false, error: 'Internal server error' }); }
};

router.patch('/assets/:source/:id', organise('rename', async (req, res, principal, source, id) => {
  const result = await renameLibraryItem(req.db, principal, source, id, req.body?.name);
  sendOrganised(res, result, { name: result.name });
}));
// AREA: move an item to another area, or to none ({ area: null }).
router.put('/assets/:source/:id/area', organise('place', async (req, res, principal, source, id) => {
  let to; try { to = readArea(req.body?.area); } catch (error) { return res.status(400).json({ success: false, code: 'invalid_area', error: error.message }); }
  if (!to.given) return res.status(400).json({ success: false, code: 'invalid_area', error: 'Say which area, or null for none.' });
  sendOrganised(res, await placeLibraryItem(req.db, principal, source, id, to.area), { area: to.area });
}));
// SHARING one file (services/storageShares.js). Only the owner shares; both kinds are read-only and revocable.
const shareReply = (res, result, body = {}) => {
  if (result.ok) return res.json({ success: true, ...body });
  if (result.invalid) return res.status(400).json({ success: false, code: result.code, error: { invalid_person: 'Give an email address or a username.', own_file: 'That is your own account.', invalid_expiry: 'A link can last 1 to 365 days.', invalid_role: 'Choose can view or can edit.' }[result.code] || 'Invalid' });
  if (result.notFound) return res.status(404).json({ success: false, code: result.code || 'not_found', error: result.code === 'person_not_found' ? 'No XENO account has that email or username.' : 'Not found' });
  return res.status(500).json({ success: false, error: 'Internal server error' });
};
router.get('/assets/file/:id/shares', folders(async (req, res) => { const r = await listShares(req.db, req.user.id, { fileId: req.params.id }); shareReply(res, r, { shares: r.shares }); }));
// a FOLDER is shared with people (never by link): everything in it and under it, now and later
router.get('/folders/:id/shares', folders(async (req, res) => { const r = await listShares(req.db, req.user.id, { folderId: req.params.id }); shareReply(res, r, { shares: r.shares }); }));
router.post('/folders/:id/shares', folders(async (req, res) => { const r = await shareWithPerson(req.db, req.user.id, { folderId: req.params.id }, req.body?.with, req.body?.role === 'editor' ? 'editor' : 'viewer'); shareReply(res, r, { share: r.share }); }));
router.post('/assets/file/:id/shares', folders(async (req, res) => {
  if (req.body?.link === true) { const r = await createLink(req.db, req.user.id, req.params.id, { expiresInDays: req.body?.expiresInDays ?? null }); return shareReply(res, r, r.ok ? { share: r.share, url: `${publicSiteOrigin()}/api/library/links/${r.token}` } : {}); }
  const r = await shareWithPerson(req.db, req.user.id, { fileId: req.params.id }, req.body?.with, req.body?.role === 'editor' ? 'editor' : 'viewer'); shareReply(res, r, { share: r.share });
}));
router.delete('/shares/:id', folders(async (req, res) => { shareReply(res, await revokeShare(req.db, req.user.id, req.params.id)); }));
// a FOLDER shared by a link that REQUIRES SIGN-IN (services/storageFolderLinks.js, routes/storageSharedRoutes.js):
// anyone the owner gives it to can open the folder read-only once signed in to a XENO account; every open and
// download is recorded; it is revocable at once. The token is shown ONCE.
router.get('/folders/:id/links', folders(async (req, res) => { const r = await listFolderLinks(req.db, req.user.id, req.params.id); shareReply(res, r, { links: r.links }); }));
router.post('/folders/:id/links', folders(async (req, res) => {
  const r = await createFolderLink(req.db, req.user.id, req.params.id, { expiresInDays: req.body?.expiresInDays ?? null, label: req.body?.label ?? null });
  shareReply(res, r, r.ok ? { link: r.link, url: `${publicSiteOrigin()}/storage/shared/${r.token}` } : {});
}));
router.get('/folder-links/:id/activity', folders(async (req, res) => { const r = await folderLinkActivity(req.db, req.user.id, req.params.id); shareReply(res, r, r.ok ? { link: r.link, events: r.events } : {}); }));
router.delete('/folder-links/:id', folders(async (req, res) => { shareReply(res, await revokeFolderLink(req.db, req.user.id, req.params.id)); }));
// VERSIONS of a file (services/storageVersions.js). A new version is uploaded at POST …/versions (index.js, with the upload handler).
router.get('/assets/file/:id/versions', folders(async (req, res) => { const r = await listVersions(req.db, req.user.id, req.params.id); if (r.notFound) return res.status(404).json({ success: false, code: 'not_found', error: 'File not found' }); res.json({ success: true, fileId: r.fileId, versions: r.versions }); }));
// RESTORE (xeno-storage/SPEC.md §7.3): an older version's bytes become the newest version. If-Match restores only on
// top of the version the caller last saw; Idempotency-Key makes a retry return the first outcome instead of a second
// restore.
router.post('/assets/file/:id/versions/:version/restore', folders(async (req, res) => {
  let key; try { key = keyFrom(req); } catch (e) { return res.status(e.status).json({ success: false, code: e.code, error: e.message }); }
  const expected = ifMatchRevision(req);
  try {
    const out = await runOperation(req.db, { userId: req.user.id, key, route: 'restore',
      // bound to the FILE id, not the revision the id resolved to: after a commit the same request resolves to the
      // new revision, and a retry must still be recognised as the same request
      binding: { fileId: (await fileIdOf(req.db, req.params.id)) || req.params.id, version: req.params.version, expected, workspace: null },
      apply: async () => {
        const r = await restoreVersion(req.db, req.user.id, req.params.id, req.params.version, registerManagedLibraryFile, { expectedRevision: expected });
        if (r.notFound) return { status: 404, body: { success: false, code: 'not_found', error: 'Version not found' } };
        if (r.stale) return { status: 412, body: { success: false, code: 'version_conflict', error: 'The file has a newer version than the one this restore was made on.', current: r.current } };
        if (r.conflict) return { status: 409, body: { success: false, code: r.code, error: 'That version’s content is no longer available.' } };
        return { status: 200, body: { success: true, file: r.file } };
      } });
    if (out.replayed) res.set('Idempotent-Replayed', 'true');
    return res.status(out.status).json(out.body);
  } catch (e) {
    if (e instanceof IdempotencyError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    if (e?.code === 'version_conflict') return res.status(412).json({ success: false, code: 'version_conflict', error: e.message });
    if (e?.code === 'storage_full') return res.status(507).json({ success: false, code: 'storage_full', error: e.message, usedBytes: e.usedBytes, allowanceBytes: e.allowanceBytes });
    throw e;
  }
}));
// what became of a write whose reply was lost: committed (with its response) or unknown. Never replays anything.
router.get('/operations/:key', folders(async (req, res) => {
  try { res.json({ success: true, operation: await lookupOperation(req.db, req.user.id, req.params.key) }); }
  catch (e) { if (e instanceof IdempotencyError) return res.status(e.status).json({ success: false, code: e.code, error: e.message }); throw e; }
}));
// FOLDER: put an item in one of your folders, or back at the top ({ folder: null }).
router.put('/assets/:source/:id/folder', organise('move', async (req, res, principal, source, id) => {
  const result = await moveItemToFolder(req.db, principal, source, id, folderId(req.body?.folder));
  sendOrganised(res, result, { folder: result.folderId ?? null });
}));
router.put('/assets/:source/:id/star', organise('star', async (req, res, principal, source, id) => {
  sendOrganised(res, await starLibraryItem(req.db, principal, source, id, true), { starred: true });
}));
router.delete('/assets/:source/:id/star', organise('unstar', async (req, res, principal, source, id) => {
  sendOrganised(res, await starLibraryItem(req.db, principal, source, id, false), { starred: false });
}));
router.post('/assets/:source/:id/trash', organise('trash', async (req, res, principal, source, id) => {
  const result = await trashLibraryItem(req.db, principal, source, id);
  sendOrganised(res, result, { trashed_at: result.trashedAt, purge_after: result.purgeAfter });
}));
router.post('/assets/:source/:id/restore', organise('restore', async (req, res, principal, source, id) => {
  sendOrganised(res, await restoreLibraryItem(req.db, principal, source, id));
}));
// Delete forever. Only for an item already in the trash: the two-step is the protection.
router.delete('/trash/:source/:id', organise('purge', async (req, res, principal, source, id) => {
  sendOrganised(res, await purgeLibraryItem(req.db, principal, source, id));
}));
router.delete('/trash', async (req, res) => {
  try {
    const result = await emptyLibraryTrash(req.db, { type: 'user', id: req.user.id });
    sendOrganised(res, result, { purged: result.purged });
  } catch (error) { console.error('Failed to empty Library trash:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
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

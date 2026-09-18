/**
 * /api/artifacts — the hosted home's API, used by XENO Agent CLI (`/artifacts
 * promote --cloud`, the `Artifact` tool's `home: "cloud"`) and by the viewer.
 *
 * Mounted behind databaseMiddleware + authMiddleware: every route here is
 * about one account's artifacts. Reads that must work for a stranger holding a
 * share link go through /a/… (artifactViewerRoutes.js), never this router.
 */
import express from 'express';
import {
  ArtifactError,
  addComment,
  createArtifact,
  deleteArtifact,
  getArtifactForOwner,
  listArtifactsForOwner,
  listComments,
  listRevisions,
  markCommentsDelivered,
  publicUrlFor,
  reviseArtifact,
  resolveReadable,
  setVisibility,
} from '../services/artifactService.js';
import { mintViewToken } from '../services/artifactViewToken.js';

const router = express.Router();

const originOf = (req) => (process.env.PUBLIC_ORIGIN?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`);

function fail(res, error) {
  if (error instanceof ArtifactError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('[artifacts]', error);
  return res.status(500).json({ error: 'Artifact request failed.', code: 'internal' });
}

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    fail(res, error);
  }
};

const withUrl = (req, artifact) => ({ ...artifact, url: publicUrlFor(artifact.id, originOf(req)) });

router.get('/', wrap(async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? '50'), 10) || 50;
  const artifacts = await listArtifactsForOwner(req.db, req.user.id, { limit });
  res.json({ artifacts: artifacts.map((a) => withUrl(req, a)) });
}));

router.post('/', wrap(async (req, res) => {
  const artifact = await createArtifact(req.db, {
    ownerUserId: req.user.id,
    body: req.body ?? {},
    sourceArtifactId: typeof req.body?.sourceArtifactId === 'string' ? req.body.sourceArtifactId.slice(0, 120) : undefined,
  });
  res.status(201).json({ artifact: withUrl(req, artifact) });
}));

router.get('/:id', wrap(async (req, res) => {
  const artifact = await getArtifactForOwner(req.db, req.params.id, req.user.id);
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  res.json({ artifact: withUrl(req, artifact), revisions: await listRevisions(req.db, artifact.id) });
}));

router.post('/:id/revisions', wrap(async (req, res) => {
  const artifact = await reviseArtifact(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, body: req.body ?? {} });
  res.status(artifact.unchanged ? 200 : 201).json({ artifact: withUrl(req, artifact) });
}));

router.delete('/:id', wrap(async (req, res) => {
  res.json(await deleteArtifact(req.db, { artifactId: req.params.id, ownerUserId: req.user.id }));
}));

/** Link sharing: { visibility: 'link' } mints a share token (shown ONCE); 'private' revokes every link. */
router.post('/:id/share', wrap(async (req, res) => {
  const result = await setVisibility(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, visibility: req.body?.visibility ?? 'link' });
  const { shareToken, ...artifact } = result;
  res.json({
    artifact: withUrl(req, artifact),
    ...(shareToken ? { shareToken, shareUrl: `${publicUrlFor(artifact.id, originOf(req))}?s=${shareToken}` } : {}),
  });
}));

/** A path-scoped token for the raw revision files — what the viewer iframe uses. */
router.post('/:id/view-token', wrap(async (req, res) => {
  const artifact = await resolveReadable(req.db, { artifactId: req.params.id, userId: req.user.id, shareToken: req.body?.shareToken });
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const token = mintViewToken({ artifactId: artifact.id, revision: artifact.currentRevision });
  res.json({ viewToken: token, revision: artifact.currentRevision, expiresInSeconds: 3600 });
}));

router.get('/:id/comments', wrap(async (req, res) => {
  const artifact = await resolveReadable(req.db, { artifactId: req.params.id, userId: req.user.id, shareToken: typeof req.query.s === 'string' ? req.query.s : undefined });
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const undeliveredOnly = req.query.undelivered === '1' || req.query.undelivered === 'true';
  if (undeliveredOnly && artifact.access !== 'owner') throw new ArtifactError(403, 'Only the owner reads the undelivered queue.', 'forbidden');
  res.json({ comments: await listComments(req.db, { artifactId: artifact.id, undeliveredOnly }) });
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const comment = await addComment(req.db, {
    artifactId: req.params.id,
    userId: req.user.id,
    body: req.body?.body,
    selector: req.body?.selector,
    access: { shareToken: typeof req.body?.shareToken === 'string' ? req.body.shareToken : undefined },
  });
  res.status(201).json({ comment });
}));

/** The publishing session acknowledges the comments it has taken into a turn. */
router.post('/:id/comments/delivered', wrap(async (req, res) => {
  res.json(await markCommentsDelivered(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, commentIds: req.body?.commentIds }));
}));

export default router;

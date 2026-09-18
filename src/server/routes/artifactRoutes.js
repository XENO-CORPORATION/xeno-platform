/**
 * /api/artifacts — the hosted home's API, used by XENO Agent CLI (`/artifacts
 * promote --cloud`, the `Artifact` tool's `home: "cloud"`) and by the viewer.
 *
 * Mounted behind databaseMiddleware + authMiddleware: every route here is
 * about one account's artifacts. Reads that must work for a stranger holding a
 * share link go through /a/… (artifactViewerRoutes.js), never this router.
 *
 * Governance: publish / share / delete are recorded as security events (the
 * platform's audit log); ARTIFACTS_ENABLED=false answers 503 on every write.
 */
import express from 'express';
import {
  ArtifactError,
  addAgentReply,
  addComment,
  applyRetentionPolicy,
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
import { recordSecurityEvent } from '../services/securityEvents.js';

const router = express.Router();

export function artifactsEnabled(env = process.env) {
  const raw = (env.ARTIFACTS_ENABLED ?? 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off');
}

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

/** The admin kill-switch: reads keep working (people can still open what exists); writes stop. */
const requireEnabled = (req, res, next) => {
  if (artifactsEnabled()) return next();
  res.status(503).json({ error: 'Artifacts are turned off for this platform.', code: 'artifacts_disabled' });
};

const withUrl = (req, artifact) => ({ ...artifact, url: publicUrlFor(artifact.id, originOf(req)) });

const audit = (req, type, artifactId, metadata = {}) => recordSecurityEvent(req.db, type, { userId: req.user.id, req, metadata: { artifactId, ...metadata } }).catch(() => undefined);

router.get('/', wrap(async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? '50'), 10) || 50;
  const artifacts = await listArtifactsForOwner(req.db, req.user.id, { limit });
  res.json({ artifacts: artifacts.map((a) => withUrl(req, a)), enabled: artifactsEnabled() });
}));

router.post('/', requireEnabled, wrap(async (req, res) => {
  const artifact = await createArtifact(req.db, {
    ownerUserId: req.user.id,
    body: req.body ?? {},
    sourceArtifactId: typeof req.body?.sourceArtifactId === 'string' ? req.body.sourceArtifactId.slice(0, 120) : undefined,
  });
  await applyRetentionPolicy(req.db, artifact.id);
  await audit(req, 'artifact_published', artifact.id, { revision: 1, title: artifact.title });
  res.status(201).json({ artifact: withUrl(req, await getArtifactForOwner(req.db, artifact.id, req.user.id)) });
}));

router.get('/:id', wrap(async (req, res) => {
  const artifact = await getArtifactForOwner(req.db, req.params.id, req.user.id);
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  res.json({ artifact: withUrl(req, artifact), revisions: await listRevisions(req.db, artifact.id) });
}));

router.post('/:id/revisions', requireEnabled, wrap(async (req, res) => {
  const artifact = await reviseArtifact(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, body: req.body ?? {} });
  if (!artifact.unchanged) await audit(req, 'artifact_published', artifact.id, { revision: artifact.currentRevision, title: artifact.title });
  res.status(artifact.unchanged ? 200 : 201).json({ artifact: withUrl(req, artifact) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const result = await deleteArtifact(req.db, { artifactId: req.params.id, ownerUserId: req.user.id });
  await audit(req, 'artifact_deleted', req.params.id);
  res.json(result);
}));

/**
 * Audience: { visibility: 'link' } mints a share token (shown ONCE); 'workspace' + workspaceId
 * opens it to that workspace's active members; 'private' revokes everything. `sharedRevision`
 * pins the revision viewers see (null = latest).
 */
router.post('/:id/share', requireEnabled, wrap(async (req, res) => {
  const result = await setVisibility(req.db, {
    artifactId: req.params.id,
    ownerUserId: req.user.id,
    visibility: req.body?.visibility ?? 'link',
    workspaceId: req.body?.workspaceId,
    sharedRevision: req.body?.sharedRevision,
  });
  await applyRetentionPolicy(req.db, req.params.id);
  const { shareToken, ...artifact } = result;
  await audit(req, 'artifact_shared', artifact.id, { visibility: artifact.visibility, ...(artifact.workspaceId ? { workspaceId: artifact.workspaceId } : {}), ...(artifact.sharedRevision ? { sharedRevision: artifact.sharedRevision } : {}) });
  res.json({
    artifact: withUrl(req, await getArtifactForOwner(req.db, artifact.id, req.user.id)),
    ...(shareToken ? { shareToken, shareUrl: `${publicUrlFor(artifact.id, originOf(req))}?s=${shareToken}` } : {}),
  });
}));

/** A path-scoped token for the raw revision files — what the viewer iframe uses. */
router.post('/:id/view-token', wrap(async (req, res) => {
  const artifact = await resolveReadable(req.db, { artifactId: req.params.id, userId: req.user.id, shareToken: req.body?.shareToken });
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const token = mintViewToken({ artifactId: artifact.id, revision: artifact.viewRevision });
  res.json({ viewToken: token, revision: artifact.viewRevision, expiresInSeconds: 3600 });
}));

router.get('/:id/comments', wrap(async (req, res) => {
  const artifact = await resolveReadable(req.db, { artifactId: req.params.id, userId: req.user.id, shareToken: typeof req.query.s === 'string' ? req.query.s : undefined });
  if (!artifact) throw new ArtifactError(404, 'Artifact not found.', 'not_found');
  const undeliveredOnly = req.query.undelivered === '1' || req.query.undelivered === 'true';
  if (undeliveredOnly && artifact.access !== 'owner') throw new ArtifactError(403, 'Only the owner reads the undelivered queue.', 'forbidden');
  res.json({ comments: await listComments(req.db, { artifactId: artifact.id, undeliveredOnly }) });
}));

router.post('/:id/comments', requireEnabled, wrap(async (req, res) => {
  const comment = await addComment(req.db, {
    artifactId: req.params.id,
    userId: req.user.id,
    body: req.body?.body,
    selector: req.body?.selector,
    parentId: req.body?.parentId,
    toAgent: req.body?.toAgent !== false,
    access: { shareToken: typeof req.body?.shareToken === 'string' ? req.body.shareToken : undefined },
  });
  res.status(201).json({ comment });
}));

/** The publishing session replies into a thread, attributed to the owner. */
router.post('/:id/comments/:commentId/reply', requireEnabled, wrap(async (req, res) => {
  const comment = await addAgentReply(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, parentId: req.params.commentId, body: req.body?.body });
  res.status(201).json({ comment });
}));

/** The publishing session acknowledges the comments it has taken into a turn. */
router.post('/:id/comments/delivered', wrap(async (req, res) => {
  res.json(await markCommentsDelivered(req.db, { artifactId: req.params.id, ownerUserId: req.user.id, commentIds: req.body?.commentIds }));
}));

export default router;

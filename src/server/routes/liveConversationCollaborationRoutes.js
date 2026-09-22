import express from 'express';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import {
  appendLiveEntry,
  assertLiveCollaborationAuthority,
  listLiveParticipants,
  readLiveEvents,
  registerAgentConversation,
  revokeLiveParticipant,
  revokeLiveShare,
  sendLiveCollaborationError,
  syncAgentConversationEvent,
} from '../services/liveConversationCollaboration.js';

const router = express.Router();

router.use(requireDpopIfBound);
router.use((req, res, next) => {
  try { assertLiveCollaborationAuthority(req); next(); }
  catch (error) { if (!sendLiveCollaborationError(res, error)) next(error); }
});

const handle = (operation) => async (req, res) => {
  try { await operation(req, res); }
  catch (error) {
    if (sendLiveCollaborationError(res, error)) return;
    console.error('Live conversation collaboration failed:', error);
    res.status(503).json({ success: false, error: 'Collaboration is temporarily unavailable.', code: 'collaboration_unavailable' });
  }
};

router.post('/agent-conversations/register', handle(async (req, res) => {
  const result = await registerAgentConversation(req.db, {
    localConversationId: req.body?.local_conversation_id,
    userId: req.user.id,
    clientId: req.auth.clientId,
    installationId: req.auth.dpopJkt,
    title: req.body?.title,
    modelId: req.body?.model_id ?? null,
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
}));

router.get('/conversations/:id/collaboration/events', handle(async (req, res) => {
  const result = await readLiveEvents(req.db, {
    conversationId: req.params.id,
    userId: req.user.id,
    after: Number(req.query.after || 0),
    limit: Number(req.query.limit || 100),
  });
  res.json({ success: true, ...result });
}));

const appendEntry = (strict) => handle(async (req, res) => {
  const result = await appendLiveEntry(req.db, {
    conversationId: req.params.id,
    userId: req.user.id,
    ...(strict ? { expectedActorId: req.body?.expected_actor_id } : {}),
    kind: req.body?.kind,
    content: req.body?.content,
    idempotencyKey: req.get('idempotency-key') || req.body?.idempotency_key,
    strict,
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
});

// v1 remains replay-compatible. New clients must use the explicit strict route;
// an old server returns 404 before it can mutate under weaker semantics.
router.post('/conversations/:id/collaboration/entries', appendEntry(false));
router.post('/conversations/:id/collaboration/v2/entries', appendEntry(true));

const appendOwnerEvent = (strict) => handle(async (req, res) => {
  const result = await syncAgentConversationEvent(req.db, {
    conversationId: req.params.id,
    userId: req.user.id,
    clientId: req.auth.clientId,
    installationId: req.auth.dpopJkt,
    eventId: req.get('idempotency-key') || req.body?.event_id,
    kind: req.body?.kind,
    content: req.body?.content ?? null,
    tool: req.body?.tool ?? null,
    sourceMessageId: req.body?.source_message_id,
    revision: req.body?.revision,
    expectedRevision: req.body?.expected_revision,
    state: req.body?.state,
    strict,
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
});

router.post('/conversations/:id/collaboration/owner-events', appendOwnerEvent(false));
router.post('/conversations/:id/collaboration/v2/owner-events', appendOwnerEvent(true));

router.get('/conversations/:id/collaborators', handle(async (req, res) => {
  res.json({ success: true, ...(await listLiveParticipants(req.db, {
    conversationId: req.params.id,
    ownerId: req.user.id,
  })) });
}));

router.delete('/conversations/:id/collaborators/:participantUserId', handle(async (req, res) => {
  res.json({ success: true, ...(await revokeLiveParticipant(req.db, {
    conversationId: req.params.id,
    participantUserId: req.params.participantUserId,
    ownerId: req.user.id,
  })) });
}));

router.delete('/conversations/:id/shares/:shareId/live', handle(async (req, res) => {
  res.json({ success: true, ...(await revokeLiveShare(req.db, {
    conversationId: req.params.id,
    shareId: req.params.shareId,
    ownerId: req.user.id,
  })) });
}));

export default router;

/**
 * XENO-WORKFORCE-01 RUN-05 / RUN-06 / RUN-08 -- the coordination API.
 *
 * childConversations (child sessions and tool-output previews), projectWorktree (goal -> milestone -> task with
 * evidence and review) and concurrentOwnership (file/task locks, isolated worktrees and reviewed integration) were
 * built and tested with no route.
 *   - projectWorktree and concurrentOwnership authorize the actor against the project themselves (ReBAC owner or
 *     editor, no self-acceptance, no self-integration); the adapter only binds the actor from the session.
 *   - childConversations take only conversation ids, so the adapter checks the actor holds the PARENT (opening,
 *     returning, closing) or the conversation (previews) first; a stranger's id answers not_found.
 *   - It throws plain Errors for its own validation; those are the caller's input (400), never a fault (503).
 */
import express from 'express';
import * as children from '../services/childConversations.js';
import * as goals from '../services/projectWorktree.js';
import * as owners from '../services/concurrentOwnership.js';
import { assertConversationAccess } from './workforceSessionRoutes.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

/** The child's parent, which is what authorizes acting on the child. */
async function parentOf(db, childConversationId) {
  if (typeof childConversationId !== 'string') refuse('bad_input', 'invalid_child');
  const link = (await db.query('SELECT parent_conversation_id FROM child_conversations WHERE child_conversation_id=$1', [childConversationId])).rows[0];
  if (!link) refuse('not_found', 'conversation_not_found');
  return link.parent_conversation_id;
}
const plainIsInput = (fn) => async (db, v) => {
  try { return await fn(db, v); } catch (e) { if (!e.code) refuse('bad_input', e.message); throw e; }
};

export function createWorkforceCoordinationRouter() {
  const router = express.Router();
  const route = (keys, service) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if (!keys.includes(k)) refuse('bad_input', 'unknown_field');
      return res.json({ success: true, result: await service(req.db, { ...body, actorUserId: req.workforceContext.actorUserId }) });
    } catch (error) {
      if (Object.hasOwn(STATUS, error?.code)) return res.status(STATUS[error.code]).json({ success: false, code: error.code, reason: error.reason || error.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  // RUN-05: child conversations, guarded by the parent
  router.post('/children/open', route(['parentConversationId', 'title'], async (db, v) => {
    await assertConversationAccess(db, v.actorUserId, v.parentConversationId, 'editor');
    return plainIsInput(children.openChild)(db, v);
  }));
  for (const [path, fn] of [['/children/return', children.returnToParent], ['/children/close', children.closeChild]]) {
    router.post(path, route(['childConversationId'], async (db, v) => {
      await assertConversationAccess(db, v.actorUserId, await parentOf(db, v.childConversationId), 'editor');
      return plainIsInput(fn)(db, { childConversationId: v.childConversationId });
    }));
  }
  router.post('/children/read', route(['childConversationId'], async (db, v) => {
    await assertConversationAccess(db, v.actorUserId, await parentOf(db, v.childConversationId), 'viewer');
    return children.readChildLink(db, v.childConversationId);
  }));
  router.post('/previews/read', route(['conversationId', 'toolCallId'], async (db, v) => {
    await assertConversationAccess(db, v.actorUserId, v.conversationId, 'viewer');
    return plainIsInput(children.readToolPreview)(db, { conversationId: v.conversationId, toolCallId: v.toolCallId });
  }));
  router.post('/previews/collapse', route(['conversationId', 'toolCallId', 'collapsed'], async (db, v) => {
    await assertConversationAccess(db, v.actorUserId, v.conversationId, 'editor');
    return plainIsInput(children.setPreviewCollapsed)(db, { conversationId: v.conversationId, toolCallId: v.toolCallId, collapsed: v.collapsed });
  }));
  // RUN-06: goal -> milestone -> task, evidence and review
  router.post('/goals', route(['projectId', 'title', 'successEvidence'], goals.createGoal));
  router.post('/milestones', route(['goalId', 'title', 'requiredEvidenceKinds', 'reviewerRequired', 'reviewerUserId'], goals.createMilestone));
  router.post('/tasks', route(['milestoneId', 'title', 'assigneeUserId'], goals.createTask));
  router.post('/tasks/evidence', route(['taskId', 'kind', 'ref'], goals.attachTaskEvidence));
  router.post('/tasks/complete', route(['taskId'], goals.completeTask));
  router.post('/tasks/accept', route(['taskId'], goals.acceptTask));
  router.post('/milestones/complete', route(['milestoneId'], goals.completeMilestone));
  router.post('/goals/complete', route(['goalId'], goals.completeGoal));
  // LIFE-08: objectives, the top of the same tree
  router.post('/objectives', route(['workspaceId', 'divisionId', 'title', 'successEvidence', 'ownerUserId', 'windowStart', 'windowEnd'], goals.createObjective));
  router.post('/objectives/link-goal', route(['goalId', 'objectiveId'], goals.linkGoalToObjective));
  router.post('/objectives/complete', route(['objectiveId'], goals.completeObjective));
  router.post('/objectives/read', route(['objectiveId'], goals.readObjective));
  router.post('/objectives/update', route(['objectiveId', 'title', 'successEvidence', 'ownerUserId', 'windowEnd'], goals.updateObjective));
  // The Objectives screen: a project's goals and its workspace's objectives, in one read
  router.post('/projects/tree', route(['projectId'], goals.readProjectTree));
  // RUN-08: concurrent ownership
  router.post('/ownership/files', route(['projectId', 'paths', 'taskRef', 'ttlSeconds'], owners.acquireFileOwnership));
  router.post('/ownership/files/release', route(['projectId', 'paths'], owners.releaseFileOwnership));
  router.post('/ownership/tasks', route(['projectId', 'taskRef', 'ttlSeconds'], owners.acquireTaskOwnership));
  router.post('/worktrees', route(['projectId', 'taskRef', 'branch', 'rootPrefix'], owners.createIsolatedWorktree));
  router.post('/worktrees/integrate', route(['worktreeId'], owners.integrateWorktree));
  router.post('/ownership/check', route(['projectId', 'path'], owners.checkWriteAllowed));
  return router;
}

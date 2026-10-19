/**
 * XENO-WORKFORCE-01 VIEW-04 / VIEW-05 -- the view API.
 *
 * scopedReads (revision-fenced reads and subscription polls) and viewConsistency (canonical id resolution,
 * per-view drafts and scroll) were built and tested with no route. scopedReads authorizes its own scope;
 * viewConsistency's resolvers take only an id, so the adapter checks the RESOLVED conversation against the actor
 * before answering -- a message or move the actor cannot see answers not_found, exactly like a missing one.
 * `mutateScoped` takes a server-side write callback and is a building block for other services, not an endpoint.
 */
import express from 'express';
import { readScoped, pollScoped } from '../services/scopedReads.js';
import * as views from '../services/viewConsistency.js';
import { assertConversationAccess } from './workforceSessionRoutes.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

export function createWorkforceViewRouter() {
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
  const resolved = (resolve, notFound) => async (db, v) => {
    let out;
    try { out = await resolve(db, v); } catch (e) { if (e.code === 'not_found') refuse('not_found', notFound); throw e; }
    try { await assertConversationAccess(db, v.actorUserId, out.conversationId, 'viewer'); }
    catch (e) { if (e.code === 'not_found') refuse('not_found', notFound); throw e; }
    return out;
  };
  // VIEW-05
  router.post('/read', route(['scope', 'key', 'knownRevision'], readScoped));
  router.post('/poll', route(['scope', 'key', 'fromRevision'], pollScoped));
  // VIEW-04
  router.post('/resolve/message', route(['messageId'], resolved(views.resolveMessageConversation, 'message_not_found')));
  router.post('/resolve/move', route(['moveId'], resolved(views.resolveMoveConversation, 'move_not_found')));
  router.post('/state', route(['view', 'draft', 'scrollOffset'], views.saveViewState));
  router.post('/state/read', route(['view'], views.readViewState));
  return router;
}

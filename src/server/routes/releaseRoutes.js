/**
 * /api/releases — the platform's release record (services/releaseRecord.js).
 *
 * Every route resolves the caller as a PRINCIPAL and calls the one service, which decides who may read or change what.
 * Staff reads answer 404 to anyone else, so the record cannot be probed.
 *
 *   GET   /whats-new                     the signed-in customer's notes (approved, live, enabled for them) — words only
 *   GET   /summary                       staff: counts
 *   GET   /deploys · /deploys/:id        staff
 *   GET   /features · /features/:id      staff (id or slug)
 *   PATCH /features/:id                  human staff: status, enabled scope/plans/workspaces, spec, proof
 *   GET   /notes?state=                  staff: the notes queue
 *   POST  /features/:id/notes            staff or a staff agent: draft {title, body}
 *   POST  /notes/:id/approve             human staff {title?, body?}
 *   POST  /notes/:id/withdraw            human staff
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as rel from '../services/releaseRecord.js';

const router = express.Router();

async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, role: p.role, kind: p.kind };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[releases] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof rel.ReleaseError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[releases]', e);
    return res.status(500).json({ success: false, error: 'The release record is unavailable right now' });
  }
};
const A = [authMiddleware, loadActor];
const b = (req) => req.body || {};

router.get('/whats-new', ...A, run(async (req) => ({ notes: await rel.whatsNew(req.db, req.actor, { limit: req.query.limit }) })));
router.get('/summary', ...A, run(async (req) => ({ summary: await rel.summary(req.db, req.actor) })));
router.get('/deploys', ...A, run(async (req) => ({ deploys: await rel.listDeploys(req.db, req.actor, { service: req.query.service, status: req.query.status, limit: req.query.limit, before: req.query.before }) })));
router.get('/deploys/:id', ...A, run(async (req) => ({ deploy: await rel.getDeploy(req.db, req.actor, req.params.id) })));
router.get('/features', ...A, run(async (req) => ({ features: await rel.listFeatures(req.db, req.actor, { repo: req.query.repo, status: req.query.status, q: req.query.q, limit: req.query.limit, offset: req.query.offset }) })));
router.get('/features/:id', ...A, run(async (req) => ({ feature: await rel.getFeature(req.db, req.actor, req.params.id) })));
router.patch('/features/:id', ...A, run(async (req) => ({ feature: await rel.updateFeature(req.db, req.actor, req.params.id, b(req)) })));
router.post('/features/:id/notes', ...A, run(async (req) => ({ note: await rel.draftNote(req.db, req.actor, req.params.id, { title: b(req).title, body: b(req).body }) })));
router.get('/notes', ...A, run(async (req) => ({ notes: await rel.listNotes(req.db, req.actor, { state: req.query.state }) })));
router.post('/notes/:id/approve', ...A, run(async (req) => ({ note: await rel.approveNote(req.db, req.actor, req.params.id, { title: b(req).title, body: b(req).body }) })));
router.post('/notes/:id/withdraw', ...A, run(async (req) => ({ note: await rel.withdrawNote(req.db, req.actor, req.params.id) })));

export default router;

/**
 * /api/v2/spawn/canvases — Spawn cloud canvases, the shared thing behind XENO Multiplayer's spawn.canvas/<id>
 * (services/spawnCanvases.js). Signed in; a key-bound (DPoP) token must bring its proof.
 *
 *   POST   /                          {id, name, machineId?, workspace?}  create (idempotent on id) — pressing Cloud
 *   GET    /:id                       {id, name, workspaceId, machineId, role, url}
 *   GET    /:id/invites               people invited to this canvas alone (owner)
 *   PUT    /:id/invites/:userId       {role: editor|viewer}  invite (owner, in person)
 *   DELETE /:id/invites/:userId       remove, and close their live connections
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as canvases from '../services/spawnCanvases.js';
import { revoke } from '../services/liveTickets.js';
import { ComputeError } from '../services/compute.js';

const router = express.Router();
async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof canvases.CanvasError || e instanceof ComputeError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[spawn-canvases]', e);
    return res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};
const A = [authMiddleware, requireDpopIfBound, loadActor];
const b = (req) => req.body || {};

router.post('/', ...A, run(async (req) => ({ canvas: await canvases.createCanvas(req.db, req.actor, b(req)) })));
router.get('/:id', ...A, run(async (req) => ({ canvas: await canvases.getCanvas(req.db, req.actor, req.params.id) })));
router.get('/:id/invites', ...A, run(async (req) => ({ invites: await canvases.listInvites(req.db, req.actor, req.params.id) })));
router.put('/:id/invites/:userId', ...A, run(async (req) => ({ invite: await canvases.invite(req.db, req.actor, req.params.id, { userId: req.params.userId, role: b(req).role }) })));
router.delete('/:id/invites/:userId', ...A, run(async (req) => ({ result: await canvases.uninvite(req.db, req.actor, req.params.id, req.params.userId, { revoke }) })));

export default router;

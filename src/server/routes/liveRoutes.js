/**
 * /api/live — XENO Multiplayer's platform half (services/liveTickets.js; xeno-multiplayer SPEC §2).
 *
 *   POST /tickets {resource: "<type>/<id>"}   a 60 s join ticket for one shared thing, after the platform checks access
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import { createTicket, LiveTicketError } from '../services/liveTickets.js';
import { ComputeError } from '../services/compute.js';
import { CanvasError } from '../services/spawnCanvases.js';

const router = express.Router();

router.post('/tickets', authMiddleware, requireDpopIfBound, async (req, res) => {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    const actor = { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
    res.json({ success: true, ...(await createTicket(req.db, actor, (req.body || {}).resource)) });
  } catch (e) {
    if (e instanceof LiveTicketError || e instanceof CanvasError || e instanceof ComputeError || e instanceof AgentIdentityError) {
      return res.status(e.statusCode || 400).json({ success: false, error: e.message, code: e.code });
    }
    console.error('[live] ticket', e);
    return res.status(500).json({ success: false, error: 'Could not issue a ticket' });
  }
});

export default router;

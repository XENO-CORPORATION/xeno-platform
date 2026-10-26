/**
 * /api/compute — XENO Compute's platform half (services/compute.js). Every route resolves the caller as a PRINCIPAL and
 * calls the one service; who may read or change what is decided there. `?workspace=<id>` (or body `workspace`) picks the
 * workspace, default the caller's Personal one. Same calls as the agent tools (computeMcp.js) and SPEC §6.
 *
 *   GET  /sizes                                  sizes and whether each is priced yet
 *   GET  /machines (?state=&agentId=)            machine.list
 *   POST /machines {name, size, purpose?, image?, agentId?, idempotencyKey?}   machine.create
 *   GET  /machines/:id                           machine.get (with its timeline)
 *   POST /machines/:id/start · /stop · DELETE /machines/:id
 *   GET  /usage (?from=&to=)                     machine.usage — by machine and by agent
 *   GET  /usage/split                            what the caller used: AI requests vs machine time (the quota view)
 *   GET  /caps · PUT /caps {scope, scopeId?, maxMachines?, maxSize?, monthlyCredits?}   budget.set (a person, admin)
 *   PUT  /rates/:size {creditsPerHour}           XENO staff only — the owner's prices, entered as data
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as compute from '../services/compute.js';

const router = express.Router();
async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[compute] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof compute.ComputeError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[compute]', e);
    return res.status(500).json({ success: false, error: 'XENO Compute is unavailable right now' });
  }
};
const A = [authMiddleware, loadActor];
const b = (req) => req.body || {};
const ws = (req) => b(req).workspace || req.query.workspace;

router.get('/sizes', ...A, run(async (req) => ({ sizes: await compute.sizes(req.db, req.actor) })));
router.get('/machines', ...A, run(async (req) => ({ machines: await compute.listMachines(req.db, req.actor, { workspace: ws(req), state: req.query.state, agentId: req.query.agentId }) })));
router.post('/machines', ...A, run(async (req) => ({ machine: await compute.createMachine(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.get('/machines/:id', ...A, run(async (req) => ({ machine: await compute.getMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/machines/:id/start', ...A, run(async (req) => ({ machine: await compute.startMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/machines/:id/stop', ...A, run(async (req) => ({ machine: await compute.stopMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.delete('/machines/:id', ...A, run(async (req) => ({ machine: await compute.deleteMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.get('/usage', ...A, run(async (req) => ({ usage: await compute.usage(req.db, req.actor, { workspace: ws(req), from: req.query.from, to: req.query.to }) })));
router.get('/usage/split', ...A, run(async (req) => ({ split: await compute.aiVsMachines(req.db, req.actor.kind === 'agent' && req.actor.owner ? req.actor.owner.id : req.actor.id, { from: req.query.from }) })));
router.get('/caps', ...A, run(async (req) => ({ caps: await compute.listCaps(req.db, req.actor, { workspace: ws(req) }) })));
router.put('/caps', ...A, run(async (req) => ({ caps: await compute.setCap(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.put('/rates/:size', ...A, run(async (req) => ({ size: await compute.setRate(req.db, req.actor, { size: req.params.size, creditsPerHour: b(req).creditsPerHour }) })));

export default router;

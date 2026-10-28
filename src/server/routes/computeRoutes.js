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
 *   POST /machines/:id/agent-tasks {prompt, access: listed|full, model?, folder?, timeoutMinutes?, maxCredits?}   machine.agent_run
 *   PUT  /machines/:id/idle-stop {idleStopMinutes: 5..1440 | null}   machine.idle_set
 *   GET  /usage (?from=&to=)                     machine.usage — by machine and by agent
 *   GET  /usage/split                            what the caller used: AI requests vs machine time (the quota view)
 *   GET  /caps · PUT /caps {scope, scopeId?, maxMachines?, maxSize?, monthlyCredits?}   budget.set (a person, admin)
 *   PUT  /rates/:size {creditsPerHour}           XENO staff only — the owner's prices, entered as data
 *   POST /machines/:id/port-tickets {port}       a one-use ticket to open wss …/machines/:id/ports/:port/ (services/computePorts.js)
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as compute from '../services/compute.js';
import { createTicket } from '../services/computePorts.js';

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
// A token bound to a key (DPoP) must bring its proof, as on every other bound-token route.
const A = [authMiddleware, requireDpopIfBound, loadActor];
const b = (req) => req.body || {};
const ws = (req) => b(req).workspace || req.query.workspace;

router.get('/sizes', ...A, run(async (req) => ({ sizes: await compute.sizes(req.db, req.actor) })));
router.get('/machines', ...A, run(async (req) => ({ machines: await compute.listMachines(req.db, req.actor, { workspace: ws(req), state: req.query.state, agentId: req.query.agentId }) })));
router.post('/machines', ...A, run(async (req) => ({ machine: await compute.createMachine(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.get('/machines/:id', ...A, run(async (req) => ({ machine: await compute.getMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/machines/:id/start', ...A, run(async (req) => ({ machine: await compute.startMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/machines/:id/agent-tasks', ...A, run(async (req) => ({ result: await compute.runAgentTask(req.db, req.actor, req.params.id, { ...b(req), workspace: ws(req) }) })));
router.put('/machines/:id/idle-stop', ...A, run(async (req) => ({ machine: await compute.setIdleStop(req.db, req.actor, req.params.id, { idleStopMinutes: b(req).idleStopMinutes, workspace: ws(req) }) })));
router.post('/machines/:id/stop', ...A, run(async (req) => ({ machine: await compute.stopMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.delete('/machines/:id', ...A, run(async (req) => ({ machine: await compute.deleteMachine(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/machines/:id/port-tickets', ...A, run(async (req) => ({ connect: await createTicket(req.db, req.actor, req.params.id, String(b(req).port || ''), { workspace: ws(req) }) })));
router.post('/machines/:id/exec', ...A, run(async (req) => ({ result: await compute.execMachine(req.db, req.actor, req.params.id, { ...b(req), workspace: ws(req) }) })));
// Streaming: the machine's NDJSON lines ({stream, data(base64)} … {done, exitCode}) passed through as they arrive.
router.post('/machines/:id/exec/stream', ...A, async (req, res) => {
  let upstream;
  try { upstream = await compute.execMachineStream(req.db, req.actor, req.params.id, { ...b(req), workspace: ws(req) }); }
  catch (e) {
    if (e instanceof compute.ComputeError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[compute] exec stream', e); return res.status(500).json({ success: false, error: 'XENO Compute is unavailable right now' });
  }
  res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const reader = upstream.body.getReader();
  req.on('close', () => reader.cancel().catch(() => {}));   // caller gone: the machine kills the command
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } }
  catch { /* upstream closed */ }
  res.end();
});
router.get('/machines/:id/files', ...A, async (req, res) => {
  try {
    const buf = await compute.readMachineFile(req.db, req.actor, req.params.id, { path: req.query.path, workspace: ws(req) });
    res.status(200).set({ 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).send(buf);
  } catch (e) {
    if (e instanceof compute.ComputeError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[compute] read file', e); return res.status(500).json({ success: false, error: 'XENO Compute is unavailable right now' });
  }
});
router.put('/machines/:id/files', ...A, express.raw({ type: () => true, limit: '25mb' }), run(async (req) => ({ file: await compute.writeMachineFile(req.db, req.actor, req.params.id, { path: req.query.path, content: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), workspace: req.query.workspace }) })));
router.get('/usage', ...A, run(async (req) => ({ usage: await compute.usage(req.db, req.actor, { workspace: ws(req), from: req.query.from, to: req.query.to }) })));
router.get('/usage/split', ...A, run(async (req) => ({ split: await compute.aiVsMachines(req.db, req.actor.kind === 'agent' && req.actor.owner ? req.actor.owner.id : req.actor.id, { from: req.query.from }) })));
router.get('/caps', ...A, run(async (req) => ({ caps: await compute.listCaps(req.db, req.actor, { workspace: ws(req) }) })));
router.put('/caps', ...A, run(async (req) => ({ caps: await compute.setCap(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.put('/rates/:size', ...A, run(async (req) => ({ size: await compute.setRate(req.db, req.actor, { size: req.params.size, creditsPerHour: b(req).creditsPerHour }) })));

export default router;

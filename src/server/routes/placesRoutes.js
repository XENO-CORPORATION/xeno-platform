/**
 * XENO Places REST — /api/places (mounted behind authMiddleware + requireActivated in index.js).
 *
 *   POST /api/places/ops/:op   body = the operation input → the contract envelope ("Places Backend Contract.md" §2)
 *   GET  /api/places           places.list           GET /api/places/:placeId   places.get
 *
 * One code path: every route is services/places.js `call`, the same function the XENO MCP `places` tools run.
 * `Idempotency-Key` is accepted as the requestId when the body names none.
 */
import express from 'express';
import * as places from '../services/places.js';
import * as live from '../services/placesLive.js';
import * as devices from '../services/placesDevices.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';

const router = express.Router();
router.use(express.json({ limit: '512kb' }));
router.use(async (req, res, next) => {
  try { const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p); req.me = { id: p.id, kind: p.kind, role: p.role, name: p.displayName || p.handle || 'Someone' }; next(); }
  catch (e) { res.status(403).json({ ok: false, error: { code: 'denied', reason: e.code || 'principal_unusable', message: e.message || 'Not allowed' } }); }
});
const send = (res, reply) => res.status(places.httpStatus(reply)).json(reply);
router.post('/ops/:op', async (req, res) => {
  const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : {};
  const key = req.get('idempotency-key');
  if (key && input.requestId == null) input.requestId = key;
  send(res, await places.call(req.db, req.me, req.params.op, input));
});
router.get('/needs-you', async (req, res) => send(res, await live.needsYou(req.db, req.me)));
router.post('/:placeId/presence', async (req, res) => send(res, await live.beat(req.db, req.me, req.params.placeId, req.body || {})));
/**
 * GET /api/places/:placeId/events — SSE. Every tick the viewer's SCOPED frame is rebuilt from the live records and
 * only the difference is sent, so a closed floor's activity can never appear: it is not in their frame. Access is
 * re-checked on every tick; losing it ends the stream with an `ended` event.
 */
router.get('/:placeId/events', async (req, res) => {
  const first = await live.frame(req.db, req.me, req.params.placeId);
  if (!first.ok) return send(res, first);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let id = 0, prev = null, closed = false;
  const write = (events) => { for (const e of events) res.write(`id: ${id += 1}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); };
  const tick = async (f) => {
    if (closed) return;
    const r = f || await live.frame(req.db, req.me, req.params.placeId);
    if (!r.ok) { write([{ type: 'ended', reason: r.error.reason }]); closed = true; clearInterval(timer); return res.end(); }
    write(live.diffFrames(prev, r.result)); prev = r.result;
  };
  const ms = Math.max(500, Number(process.env.PLACES_STREAM_INTERVAL_MS) || 3000);
  const timer = setInterval(() => { tick().catch(() => {}); res.write(': keepalive\n\n'); }, ms);
  req.on('close', () => { closed = true; clearInterval(timer); live.leave(req.params.placeId, req.me.id); });
  await tick(first);
});
// the building's devices (services/placesDevices.js): the desk computer, its monitor, the floor TV
router.get('/:placeId/agents/:pid', async (req, res) => send(res, await devices.agentBrief(req.db, req.me, req.params.placeId, req.params.pid)));
router.get('/:placeId/occupants/:pid/computer', async (req, res) => send(res, await devices.computer(req.db, req.me, req.params.placeId, req.params.pid)));
router.get('/:placeId/floors/:divisionId/board', async (req, res) => send(res, await devices.floorBoard(req.db, req.me, req.params.placeId, req.params.divisionId)));
router.get('/', async (req, res) => send(res, await places.call(req.db, req.me, 'places.list', {})));
router.get('/:placeId', async (req, res) => send(res, await places.call(req.db, req.me, 'places.get', { placeId: req.params.placeId })));

/**
 * POST /api/places/:placeId/agents/:pid/turn — one chat turn with the agent at that desk (the desk computer).
 * Mounted in index.js ahead of this router, behind the LLM limiter. The body is checked and rebuilt here (the agent's
 * instructions are added server-side), then handed to the platform's OWN /api/ai/chat/stream handler: the same
 * routing, metering, entitlement check and SSE events as every chat, so there is no second inference path.
 */
export function agentTurn(aiRouter) {
  return async (req, res, next) => {
    try {
      const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p);
      const meNow = { id: p.id, kind: p.kind, role: p.role, name: p.displayName || p.handle || 'Someone' };
      const r = await devices.prepareAgentTurn(req.db, meNow, req.params.placeId, req.params.pid, req.body || {});
      if (!r.ok) return send(res, r);
      req.body = r.result.body;
      req.url = '/chat/stream';
      return aiRouter(req, res, next);
    } catch (e) { res.status(403).json({ ok: false, error: { code: 'denied', reason: e.code || 'principal_unusable', message: e.message || 'Not allowed' } }); }
  };
}
export default router;

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
  let id = 0, prev = null, closed = false, cursor = null;
  const write = (events) => { for (const e of events) res.write(`id: ${id += 1}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); };
  const tick = async (f) => {
    if (closed) return;
    const r = f || await live.frame(req.db, req.me, req.params.placeId);
    if (!r.ok) { write([{ type: 'ended', reason: r.error.reason }]); closed = true; clearInterval(timer); return res.end(); }
    write(live.diffFrames(prev, r.result)); prev = r.result;
    // §15: workforce activity in the building, from the one event stream (scoped per row, closed floors excluded)
    const act = await live.activity(req.db, req.me, r.result, cursor).catch(() => null);
    if (act && !closed) { cursor = act.cursor; write(act.events.map((event) => ({ type: 'workforce', event }))); }
  };
  const ms = Math.max(500, Number(process.env.PLACES_STREAM_INTERVAL_MS) || 3000);
  const timer = setInterval(() => { tick().catch(() => {}); res.write(': keepalive\n\n'); }, ms);
  req.on('close', () => { closed = true; clearInterval(timer); live.leave(req.params.placeId, req.me.id); });
  await tick(first);
});
router.get('/', async (req, res) => send(res, await places.call(req.db, req.me, 'places.list', {})));
router.get('/:placeId', async (req, res) => send(res, await places.call(req.db, req.me, 'places.get', { placeId: req.params.placeId })));
export default router;

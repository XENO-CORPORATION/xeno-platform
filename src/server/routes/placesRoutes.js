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
router.get('/', async (req, res) => send(res, await places.call(req.db, req.me, 'places.list', {})));
router.get('/:placeId', async (req, res) => send(res, await places.call(req.db, req.me, 'places.get', { placeId: req.params.placeId })));
export default router;

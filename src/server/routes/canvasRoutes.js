/**
 * /api/canvases — canvases where tasks, notes, links and groups sit together. Rules: services/canvases.js.
 *
 *   GET    /api/canvases?projectId=&area=        the canvases the caller can see
 *   POST   /api/canvases {name, projectId?, area?, content?}
 *   GET    /api/canvases/:id                     the canvas (JSON Canvas 1.0) + every task it shows, read live
 *   PUT    /api/canvases/:id {content, revision, name?}   save; 409 if it changed since it was loaded
 *   DELETE /api/canvases/:id
 *   POST   /api/canvases/open-as {kind: project|division, id}   its map: the same canvas each time, made on first open
 */
import express from 'express';
import * as canvases from '../services/canvases.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

router.use(async (req, res, next) => {
  try { const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p); req.me = { id: p.id, kind: p.kind, role: p.role, name: p.displayName || p.handle || 'Someone' }; next(); }
  catch (e) { res.status(e.statusCode || 403).json({ success: false, error: e.message || 'Not allowed', code: e.code || 'not_allowed' }); }
});
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof canvases.CanvasError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[canvases]', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/', handled(async (req, res) => { res.json({ success: true, canvases: await canvases.listCanvases(req.db, req.me, { projectId: req.query.projectId, area: req.query.area }) }); }));
router.post('/', handled(async (req, res) => { res.status(201).json({ success: true, canvas: await canvases.createCanvas(req.db, req.me, req.body || {}) }); }));
router.post('/open-as', handled(async (req, res) => { const r = await canvases.openAsCanvas(req.db, req.me, req.body || {}); res.status(r.created ? 201 : 200).json({ success: true, ...r }); }));
router.get('/:id', handled(async (req, res) => { res.json({ success: true, canvas: await canvases.getCanvas(req.db, req.me, req.params.id) }); }));
router.put('/:id', handled(async (req, res) => { res.json({ success: true, canvas: await canvases.saveCanvas(req.db, req.me, req.params.id, req.body || {}) }); }));
router.delete('/:id', handled(async (req, res) => { res.json({ success: true, ...(await canvases.deleteCanvas(req.db, req.me, req.params.id)) }); }));

export default router;

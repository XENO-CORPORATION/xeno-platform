/**
 * /api/fonts — XENO Fonts, Studio › Libraries (services/fonts.js). `workspace` in query or body; absent = Personal.
 *
 *   GET    /catalogue?q=&category=    the open catalogue, with pairings
 *   GET    /face.css?ids=a,b          @font-face rules for catalogue families
 *   GET    /                          this workspace's fonts: catalogue families and uploads
 *   POST   /families {family}         add a family from the catalogue · DELETE /families/:family
 *   DELETE /uploads/:id               remove an upload from the workspace
 *   POST   /uploads/:id/takedown {reason}    XENO staff, for a rights holder's complaint
 *   POST   /uploads (multipart: font, workspace, rightsConfirmed) is in index.js, with the upload handler
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireActivated } from '../services/accountActivation.js';
import * as F from '../services/fonts.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const b = (req) => req.body || {};
export const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human', role: req.user.role };
};
export const fail = (res, e) => {
  if (e instanceof F.FontError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
  console.error('Fonts failed:', e); return res.status(500).json({ success: false, error: 'Internal server error' });
};
const run = (fn) => async (req, res) => { try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); } catch (e) { fail(res, e); } };
router.use(authMiddleware, requireActivated);

router.get('/catalogue', (req, res) => res.json({ success: true, ...F.searchCatalogue({ q: req.query.q, category: req.query.category }) }));
router.get('/face.css', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60);
  const weights = String(req.query.weights || '').split(',').map(Number).filter(Boolean);
  res.type('text/css').set('Cache-Control', 'private, max-age=3600').send(F.faceCss(ids, { weights: weights.length ? weights : null }));
});
router.get('/', run((req, a) => F.listWorkspaceFonts(req.db, a, { workspace: ws(req) })));
router.post('/families', run((req, a) => F.addFamily(req.db, a, { workspace: ws(req), family: b(req).family })));
router.delete('/families/:family', run((req, a) => F.removeFamily(req.db, a, { workspace: ws(req), family: req.params.family })));
router.delete('/uploads/:id', run((req, a) => F.removeUpload(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/uploads/:id/takedown', run((req, a) => F.takeDown(req.db, a, { id: req.params.id, reason: b(req).reason })));

export default router;

/**
 * /api/brand-kits — XENO Assets, Studio › Libraries (services/brandKits.js). Every route takes `workspace` (query or body;
 * absent = the person's Personal workspace).
 *
 *   GET    /                         the kits · POST / {name, description?, voice?, modes?}
 *   GET    /:id                      the draft, its problems, whether it has unpublished changes
 *   PATCH  /:id {name?, description?, voice?, modes?} · DELETE /:id (an admin) · POST /:id/restore
 *   PUT    /:id/tokens {path, value, valuesByMode?, description?}
 *   POST   /:id/logos {name, fileId}  an image in this workspace's Library
 *   DELETE /:id/items?path=
 *   POST   /:id/import {tokens, confirm?}   a DTCG file; a dry run unless `confirm`
 *   POST   /:id/publish {note?}       a person's act · GET /:id/versions
 *   GET    /:id/versions/:version     a frozen version ("latest" = the newest published)
 *   GET    /:id/export?format=dtcg|css|tailwind|canvas&version=
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireActivated } from '../services/accountActivation.js';
import * as K from '../services/brandKits.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const b = (req) => req.body || {};
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const fail = (res, e) => {
  if (e instanceof K.BrandKitError) return res.status(e.status).json({ success: false, code: e.code, error: e.message, ...(e.details ? { details: e.details } : {}) });
  console.error('Brand kits failed:', e); return res.status(500).json({ success: false, error: 'Internal server error' });
};
const run = (fn) => async (req, res) => { try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); } catch (e) { fail(res, e); } };
router.use(authMiddleware, requireActivated);

router.get('/', run((req, a) => K.listKits(req.db, a, { workspace: ws(req) })));
router.post('/', run((req, a) => K.createKit(req.db, a, { ...b(req), workspace: ws(req) })));
router.get('/:id', run((req, a) => K.getKit(req.db, a, { workspace: ws(req), id: req.params.id })));
router.patch('/:id', run((req, a) => K.updateKit(req.db, a, { ...b(req), workspace: ws(req), id: req.params.id })));
router.delete('/:id', run((req, a) => K.deleteKit(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/:id/restore', run((req, a) => K.restoreKit(req.db, a, { workspace: ws(req), id: req.params.id })));
router.put('/:id/tokens', run((req, a) => K.putToken(req.db, a, { ...b(req), workspace: ws(req), id: req.params.id })));
router.post('/:id/logos', run((req, a) => K.addLogo(req.db, a, { workspace: ws(req), id: req.params.id, name: b(req).name, fileId: b(req).fileId })));
router.delete('/:id/items', run((req, a) => K.removeItem(req.db, a, { workspace: ws(req), id: req.params.id, path: req.query.path })));
router.post('/:id/import', run((req, a) => K.importDtcg(req.db, a, { workspace: ws(req), id: req.params.id, tokens: b(req).tokens, confirm: b(req).confirm === true })));
router.post('/:id/publish', run((req, a) => K.publish(req.db, a, { workspace: ws(req), id: req.params.id, note: b(req).note })));
router.get('/:id/versions', run((req, a) => K.listVersions(req.db, a, { workspace: ws(req), id: req.params.id })));
router.get('/:id/versions/:version', run((req, a) => K.readVersion(req.db, a, { workspace: ws(req), id: req.params.id, version: req.params.version })));
router.get('/:id/export', async (req, res) => {
  try {
    const r = await K.exportKit(req.db, await actorOf(req), { workspace: ws(req), id: req.params.id, version: req.query.version, format: req.query.format || 'dtcg' });
    res.set({ 'Content-Type': `${r.type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${r.filename}"`, 'X-Xeno-Kit-Version': String(r.version), 'X-Xeno-Kit-Digest': r.digest, 'X-Content-Type-Options': 'nosniff' }).send(r.body);
  } catch (e) { fail(res, e); }
});

export default router;

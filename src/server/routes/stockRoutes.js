/**
 * /api/stock — XENO Stock, Studio › Libraries (services/stock.js). `workspace` in query or body; absent = Personal.
 *
 *   GET  /search?q=&kind=&collection=&offset=   the catalogue
 *   GET  /items/:id                             one item, with its licence and where that was read
 *   GET  /saved                                 what this workspace saved
 *   POST /saved {id}                            copy an item into this workspace's Library
 *   POST /items/:id/withdraw {reason}           XENO staff, for a rights holder's complaint
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireActivated } from '../services/accountActivation.js';
import * as S from '../services/stock.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const b = (req) => req.body || {};
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human', role: req.user.role };
};
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof S.StockError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    console.error('Stock failed:', e); return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
router.use(authMiddleware, requireActivated);

router.get('/search', run((req) => S.search(req.db, { q: req.query.q, kind: req.query.kind, collection: req.query.collection, offset: req.query.offset })));
router.get('/items/:id', run((req) => S.getItem(req.db, { id: req.params.id })));
router.get('/saved', run((req, a) => S.listSaved(req.db, a, { workspace: ws(req) })));
router.post('/saved', run((req, a) => S.save(req.db, a, { workspace: ws(req), id: b(req).id })));
router.post('/items/:id/withdraw', run((req, a) => S.withdraw(req.db, a, { id: req.params.id, reason: b(req).reason })));

export default router;

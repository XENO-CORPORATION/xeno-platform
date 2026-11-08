/**
 * /api/projects/:projectId/items/:kind/:itemId/people — who is on a file, a chat or a generation in a project.
 * Rules: services/projectItemPeople.js (the one service; XENO MCP and the canvas call it too). Off unless
 * PROJECT_ITEM_PEOPLE=true.
 *
 *   GET  …/people                      { item, people[], before[] }
 *   PUT  …/people { principalId|null } set the person (one at a time), or clear it
 *   GET  /api/projects/item-people/enabled   { enabled }   so a screen knows whether to use it
 */
import express from 'express';
import * as people from '../services/projectItemPeople.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

router.use(async (req, res, next) => {
  try { const p = await resolvePrincipal(req.db, req.user.id); assertPrincipalUsable(p); req.me = { id: p.id, kind: p.kind, role: p.role }; next(); }
  catch (e) { res.status(e.statusCode || 403).json({ success: false, error: e.message || 'Not allowed', code: e.code || 'not_allowed' }); }
});
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof people.ItemPeopleError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[item-people]', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const args = (req) => ({ projectId: req.params.projectId, kind: req.params.kind, itemId: req.params.itemId });

router.get('/item-people/enabled', (_req, res) => res.json({ success: true, enabled: people.enabled() }));
router.get('/:projectId/items/:kind/:itemId/people', handled(async (req, res) => { res.json({ success: true, ...(await people.itemPeople(req.db, req.me, args(req))) }); }));
router.put('/:projectId/items/:kind/:itemId/people', handled(async (req, res) => { res.json({ success: true, ...(await people.setPerson(req.db, req.me, { ...args(req), principalId: (req.body || {}).principalId ?? null })) }); }));

export default router;

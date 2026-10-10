/**
 * /api/workspace — reads across everything a person has in the XENO workspace (services/workspaceArea.js).
 *
 *   GET /api/workspace/search?q=…&area=<id>|none     chats (titles and messages), projects and Library items
 *   GET /api/workspace/needs?area=<id>|none           what is waiting on the person
 *   GET /api/workspace/pins?area=<id>|none            what the person pinned (chats, projects, starred files)
 *
 * `area` absent means everything (Overview). A malformed one is refused, never ignored: a search that silently
 * widened would show a person results from places they did not ask about.
 */
import express from 'express';
import { listNeedsYou, listPins, searchWorkspace, SEARCH_MIN } from '../services/workspaceArea.js';
import { readAreaFilter } from '../utils/resourceArea.js';

const router = express.Router();   // mounted behind authMiddleware in index.js

const areaOr400 = (req, res) => {
  try { return readAreaFilter(req.query.area); }
  catch (error) { res.status(400).json({ success: false, code: 'invalid_area', error: error.message }); return null; }
};

router.get('/search', async (req, res) => {
  const areaFilter = areaOr400(req, res); if (!areaFilter) return;
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim().length < SEARCH_MIN) return res.json({ success: true, query: q.trim(), results: [], counts: { chat: 0, project: 0, file: 0 }, too_short: true });
    const out = await searchWorkspace(req.db, req.user.id, { query: q, areaFilter, limit: req.query.limit });
    res.json({ success: true, ...out, area: areaFilter.filter ? areaFilter.area : undefined });
  } catch (error) {
    console.error('Workspace search failed:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/needs', async (req, res) => {
  const areaFilter = areaOr400(req, res); if (!areaFilter) return;
  try {
    res.json({ success: true, ...(await listNeedsYou(req.db, req.user.id, { areaFilter })) });
  } catch (error) {
    console.error('Workspace needs failed:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/pins', async (req, res) => {
  const areaFilter = areaOr400(req, res); if (!areaFilter) return;
  try {
    res.json({ success: true, ...(await listPins(req.db, req.user.id, { areaFilter })) });
  } catch (error) {
    console.error('Workspace pins failed:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;

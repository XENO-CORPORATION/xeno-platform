/**
 * /api/v2/authz/* — centralized ReBAC (Arch §3, §7). Mounted behind oidcAuth +
 * OIDC_ENABLED. `check` is the hot path every branch calls; `write` mutates
 * tuples and is gated so a caller can't grant themselves authority they lack.
 */
import express from 'express';
import { check, writeTuples, listObjectTuples } from '../utils/authzReBAC.js';

const router = express.Router();

// POST /api/v2/authz/check { object, relation, subject? }
// subject defaults to the authenticated user (user:<id>).
router.post('/check', async (req, res) => {
  try {
    const b = req.body || {};
    const subject = b.subject || `user:${req.user.id}`;
    res.json(await check(req.db, { object: b.object, relation: b.relation, subject }));
  } catch (e) {
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: e.message } });
  }
});

// POST /api/v2/authz/write { writes:[{object,relation,subject}], deletes:[...] }
// Gate: the caller must be admin+ on every touched object, UNLESS the object has
// no tuples yet (bootstrap: first writer claims it).
router.post('/write', async (req, res) => {
  try {
    const b = req.body || {};
    const me = `user:${req.user.id}`;
    const objects = [...(b.writes || []), ...(b.deletes || [])].map((t) => t.object);
    for (const object of new Set(objects)) {
      const existing = await listObjectTuples(req.db, object);
      if (existing.length === 0) continue; // bootstrap
      const can = await check(req.db, { object, relation: 'admin', subject: me });
      if (!can.allowed) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `not an admin of ${object}` } });
      }
    }
    res.json(await writeTuples(req.db, { writes: b.writes, deletes: b.deletes }));
  } catch (e) {
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: e.message } });
  }
});

// GET /api/v2/authz/objects/:type/:id — list tuples on an object
router.get('/objects/:type/:id', async (req, res) => {
  try {
    res.json({ tuples: await listObjectTuples(req.db, `${req.params.type}:${req.params.id}`) });
  } catch (e) {
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: e.message } });
  }
});

export default router;

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
// Gate: the caller must be admin+ on every touched object. The ONLY bootstrap
// exception (an object with zero tuples) is the legitimate "claim my own new
// resource" case: every tuple touching that object must be a WRITE that makes
// the REQUESTER the owner. Anything else on an unclaimed object — granting other
// subjects, other relations, deletes — is a cross-tenant capture and is refused
// (pre-fix, any authed user could write arbitrary tuples on ANY zero-tuple object,
// e.g. claim another tenant's not-yet-tupled workspace/run/project by id).
router.post('/write', async (req, res) => {
  try {
    const b = req.body || {};
    const me = `user:${req.user.id}`;
    const writes = b.writes || [];
    const deletes = b.deletes || [];
    const objects = [...writes, ...deletes].map((t) => t.object);
    for (const object of new Set(objects)) {
      const existing = await listObjectTuples(req.db, object);
      // Bootstrap is NEVER allowed for system:* (a random user must not be able
      // to claim system:credits, etc.).
      const isSystem = String(object).startsWith('system:');
      if (existing.length === 0 && !isSystem) {
        const touchingWrites = writes.filter((t) => t.object === object);
        const touchingDeletes = deletes.filter((t) => t.object === object);
        const isSelfOwnerClaim =
          touchingDeletes.length === 0 &&
          touchingWrites.length > 0 &&
          touchingWrites.every((t) => t.relation === 'owner' && t.subject === me);
        if (isSelfOwnerClaim) continue;
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: `cannot bootstrap ${object}: an unclaimed object only accepts owner=self` },
        });
      }
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

// GET /api/v2/authz/objects/:type/:id — list tuples on an object. Requires the
// caller to be at least a member of the object (any relation, incl. viewer via
// hierarchy) — pre-fix this listed ANY object's members/roles to ANY authed user.
router.get('/objects/:type/:id', async (req, res) => {
  try {
    const object = `${req.params.type}:${req.params.id}`;
    const can = await check(req.db, { object, relation: 'member', subject: `user:${req.user.id}` });
    if (!can.allowed) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `not a member of ${object}` } });
    }
    res.json({ tuples: await listObjectTuples(req.db, object) });
  } catch (e) {
    res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: e.message } });
  }
});

export default router;

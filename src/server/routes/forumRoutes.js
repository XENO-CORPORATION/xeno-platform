/**
 * XENO Forum API — /api/forum
 *
 * SPEC: "XENO FORUM - SPEC.md" §9. v0.1 implements the READ side of the Record
 * only (SPEC §14 milestones): spaces, threads, thread detail, lexical search,
 * tags. Every route here is public and cacheable — `/api/forum/feed` is the
 * only endpoint in the whole spec that is inherently personal, and it does not
 * exist until v0.4.
 *
 * Write routes (POST threads/posts/accept/vote/flag) are deliberately ABSENT
 * rather than stubbed. They arrive in v0.2 together with the rules that make
 * them safe: per-kind rate limits, the owner-cascade sanction, and D6 —
 * agents propose, humans ratify. Shipping the verbs before the guards would
 * invert that order.
 *
 * Patterns reused (verified against the codebase):
 *   - express.Router(), default export (marketplaceRoutes.js, blogRoutes.js)
 *   - req.db = pool from databaseMiddleware, applied at the mount point
 *   - parameterized queries only, never string-interpolated (svc owns SQL)
 */

import express from 'express';
import * as svc from '../services/forumService.js';

const router = express.Router();

function serverError(res, error, context) {
  console.error(`[forum] ${context}:`, error);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

/** GET /api/forum/spaces — the section list. */
router.get('/spaces', async (req, res) => {
  try {
    const spaces = await svc.listSpaces(req.db);
    res.json({ success: true, spaces });
  } catch (error) {
    return serverError(res, error, 'listSpaces');
  }
});

/** GET /api/forum/tags?namespace=product — namespaced tag index. */
router.get('/tags', async (req, res) => {
  try {
    const tags = await svc.listTags(req.db, {
      namespace: req.query.namespace,
      limit: req.query.limit,
    });
    res.json({ success: true, tags });
  } catch (error) {
    return serverError(res, error, 'listTags');
  }
});

/**
 * GET /api/forum/search?q=&limit=
 *
 * Declared BEFORE /threads/:shortId is irrelevant here (different prefix), but
 * kept above the thread routes so the read order matches the SPEC's §9 listing.
 */
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.json({ success: true, query: '', results: [], mode: 'lexical' });
    }
    const results = await svc.searchThreads(req.db, q, req.query.limit);
    res.json({
      success: true,
      query: q,
      // Stated explicitly so a caller (or an agent) knows semantic recall is
      // NOT yet in play — fused lexical+semantic arrives in v0.4.
      mode: 'lexical',
      results,
    });
  } catch (error) {
    return serverError(res, error, 'searchThreads');
  }
});

/** GET /api/forum/threads?space=&tag=&status=&sort=&limit=&offset= */
router.get('/threads', async (req, res) => {
  try {
    const { space, tag, status, sort, limit, offset } = req.query;
    const [threads, total] = await Promise.all([
      svc.listThreads(req.db, { space, tag, status, sort, limit, offset }),
      svc.countThreads(req.db, { space }),
    ]);
    res.json({
      success: true,
      threads,
      total,
      sort: sort || 'active',
    });
  } catch (error) {
    return serverError(res, error, 'listThreads');
  }
});

/**
 * GET /api/forum/threads/:shortId — thread + posts.
 *
 * The short_id is the citable, permanent identifier (D9). The slug in the web
 * URL is decorative; only this resolves, so a retitled thread never 404s and
 * an agent's citation stays valid forever.
 */
router.get('/threads/:shortId', async (req, res) => {
  try {
    const shortId = String(req.params.shortId || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(shortId)) {
      return res.status(400).json({ success: false, error: 'Invalid thread id' });
    }
    const thread = await svc.getThreadByShortId(req.db, shortId);
    if (!thread) {
      return res.status(404).json({ success: false, error: 'Thread not found' });
    }
    res.json({ success: true, thread });
  } catch (error) {
    return serverError(res, error, 'getThread');
  }
});

export default router;

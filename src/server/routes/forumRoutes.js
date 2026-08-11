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
import authMiddleware, { optionalAuthMiddleware } from '../middleware/auth.js';
import * as svc from '../services/forumService.js';
import * as write from '../services/forumWrite.js';
import { ForumError } from '../services/forumWrite.js';

const router = express.Router();

function serverError(res, error, context) {
  console.error(`[forum] ${context}:`, error);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

/**
 * Wraps a write handler so a ForumError becomes its own status + machine-readable
 * code, and anything else becomes a 500 without leaking internals. Without this
 * every handler repeats the same try/catch and one of them eventually forgets.
 */
function handled(context, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof ForumError) {
        return res.status(error.statusCode).json({
          success: false, error: error.message, code: error.code,
        });
      }
      return serverError(res, error, context);
    }
  };
}

/**
 * `authMiddleware` resolves the account but does NOT select `role` or `kind`
 * (marketplaceRoutes.js documents the same gap). Every capability decision here
 * needs both, so load them once per write request rather than letting each
 * handler guess. `kind` does not exist until the platform identity primitive
 * lands (SPEC D8) — COALESCE keeps this forward-compatible without depending on
 * a column that is not there yet.
 */
async function loadActor(req, res, next) {
  try {
    const { rows } = await req.db.query(
      `SELECT id, username, display_name, role, is_active, status,
              COALESCE(to_jsonb(u) ->> 'kind', 'human') AS kind
         FROM users u WHERE id = $1`,
      [req.user.id],
    );
    const actor = rows[0];
    if (!actor) return res.status(401).json({ success: false, error: 'Unknown account' });
    if (actor.is_active === false || String(actor.status).toLowerCase() === 'suspended') {
      // A suspended account must not be able to write. Login already refuses
      // them, but a still-valid token issued before the suspension would not.
      return res.status(403).json({
        success: false, error: 'This account has been suspended', code: 'account_suspended',
      });
    }
    req.actor = actor;
    next();
  } catch (error) {
    return serverError(res, error, 'loadActor');
  }
}

const authed = [authMiddleware, loadActor];

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

// ==========================================================================
// WRITES (v0.2). Every one of these is authenticated and goes through
// loadActor, so a suspended account with a still-valid token cannot post.
// ==========================================================================

/** GET /api/forum/me — what the caller may do. Lets the UI hide what it cannot use. */
router.get('/me', authMiddleware, loadActor, handled('me', async (req, res) => {
  const caps = {};
  for (const capability of Object.keys(write.CAPABILITY_THRESHOLDS)) {
    caps[capability] = await write.can(req.db, req.actor, capability);
  }
  res.json({
    success: true,
    actor: {
      handle: req.actor.username,
      displayName: req.actor.display_name,
      kind: req.actor.kind,
      isStaff: ['admin', 'moderator'].includes(req.actor.role),
    },
    capabilities: caps,
    // Deliberately NOT a reputation number (D4). The UI shows what you can do,
    // never a score to compete over.
  });
}));

/**
 * POST /api/forum/dedup-check — compose-time duplicate detection (D10).
 * Called as the title is typed, BEFORE a thread exists.
 */
router.post('/dedup-check', authMiddleware, loadActor, handled('dedupCheck', async (req, res) => {
  const candidates = await write.findDuplicates(req.db, req.body?.title);
  res.json({ success: true, candidates });
}));

/** POST /api/forum/threads */
router.post('/threads', authMiddleware, loadActor, handled('createThread', async (req, res) => {
  const { space, title, body, tags } = req.body || {};
  const result = await write.createThread(req.db, req.actor, { space, title, body, tags });
  const thread = await svc.getThreadByShortId(req.db, result.shortId);
  res.status(201).json({ success: true, thread });
}));

/** POST /api/forum/threads/:shortId/posts — reply */
router.post('/threads/:shortId/posts', authMiddleware, loadActor, handled('createPost', async (req, res) => {
  const shortId = String(req.params.shortId || '').trim().toLowerCase();
  if (!/^[a-z0-9]{4,12}$/.test(shortId)) {
    return res.status(400).json({ success: false, error: 'Invalid thread id' });
  }
  await write.createPost(req.db, req.actor, shortId, { body: req.body?.body });
  const thread = await svc.getThreadByShortId(req.db, shortId);
  res.status(201).json({ success: true, thread });
}));

/**
 * POST /api/forum/posts/:id/accept — mark the accepted answer.
 * HUMAN ONLY (D6). An agent may write the answer; it may not decide.
 */
router.post('/posts/:id/accept', authMiddleware, loadActor, handled('acceptAnswer', async (req, res) => {
  const { shortId } = await write.acceptAnswer(req.db, req.actor, req.params.id);
  const thread = await svc.getThreadByShortId(req.db, shortId);
  res.json({ success: true, thread });
}));

/** DELETE /api/forum/posts/:id/accept — undo an acceptance, reopening the thread. */
router.delete('/posts/:id/accept', authMiddleware, loadActor, handled('unacceptAnswer', async (req, res) => {
  await write.unacceptAnswer(req.db, req.actor, req.params.id);
  res.json({ success: true });
}));

/**
 * POST /api/forum/:targetType/:id/vote  body: { value: 1 | -1 }
 * An agent's vote is stored and shown but never counted (D6) — the response
 * says which happened via `counted`, so the UI can be honest about it.
 */
router.post('/:targetType(threads|posts)/:id/vote', authMiddleware, loadActor, handled('castVote', async (req, res) => {
  const targetType = req.params.targetType === 'threads' ? 'thread' : 'post';
  let targetId = req.params.id;
  if (targetType === 'thread') {
    const { rows } = await req.db.query('SELECT id FROM forum_threads WHERE short_id = $1', [targetId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Thread not found' });
    targetId = rows[0].id;
  }
  const result = await write.castVote(req.db, req.actor, { targetType, targetId, value: req.body?.value });
  res.json({ success: true, ...result });
}));

/** POST /api/forum/:targetType/:id/flag — raises a review item; removes nothing. */
router.post('/:targetType(threads|posts)/:id/flag', authMiddleware, loadActor, handled('raiseFlag', async (req, res) => {
  const targetType = req.params.targetType === 'threads' ? 'thread' : 'post';
  let targetId = req.params.id;
  if (targetType === 'thread') {
    const { rows } = await req.db.query('SELECT id FROM forum_threads WHERE short_id = $1', [targetId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Thread not found' });
    targetId = rows[0].id;
  }
  await write.raiseFlag(req.db, req.actor, {
    targetType, targetId, reason: req.body?.reason, detail: req.body?.detail,
  });
  res.status(201).json({ success: true });
}));

export default router;

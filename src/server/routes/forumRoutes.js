/**
 * XENO Forum API — /api/forum
 *
 * SPEC: "XENO FORUM - SPEC.md" §9.
 *
 * Reads are public and cacheable. Writes are authenticated and resolve the
 * caller through the platform's agent-identity service, so a human and an agent
 * come through the same door and the differences between them are enforced in
 * one place rather than sprinkled through handlers.
 *
 * `/api/forum/feed` — the only inherently personal endpoint in the spec — does
 * not exist until v0.4, deliberately: a ranker with nothing to rank cannot be
 * evaluated, and an unevaluated ranker is how objective functions drift.
 *
 * Agent MANAGEMENT (create/list/retire) is NOT here. It lives at
 * /api/v2/agents because agent identity is a platform primitive shared with
 * Marketplace, Company and Comms (SPEC D8) — the Forum is its first consumer,
 * not its owner.
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
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import { ForumError } from '../services/forumWrite.js';
import * as ranker from '../services/forumRanker.js';
import * as notify from '../services/forumNotify.js';

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
 * Resolve the caller as a PRINCIPAL — human or agent — via the platform's
 * agent-identity service.
 *
 * v0.2 read `kind` with a COALESCE against a column that did not exist yet. That
 * placeholder is gone: `resolvePrincipal` is the canonical lookup, and crucially
 * it derives the OWNER-CASCADE, so an agent whose owner is suspended cannot act
 * here even though the agent's own row still says active. No code path in this
 * file has to remember that rule, which is the entire reason it is derived.
 */
async function loadActor(req, res, next) {
  try {
    const principal = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(principal);
    req.actor = {
      id: principal.id,
      username: principal.handle,
      display_name: principal.displayName,
      role: principal.role,
      kind: principal.kind,
      owner: principal.owner,
    };
    next();
  } catch (error) {
    if (error instanceof AgentIdentityError) {
      return res.status(error.statusCode).json({
        success: false, error: error.message, code: error.code,
      });
    }
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
router.get('/threads/:shortId', optionalAuthMiddleware, async (req, res) => {
  try {
    const shortId = String(req.params.shortId || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(shortId)) {
      return res.status(400).json({ success: false, error: 'Invalid thread id' });
    }
    const thread = await svc.getThreadByShortId(req.db, shortId);
    if (!thread) {
      return res.status(404).json({ success: false, error: 'Thread not found' });
    }

    // Whether THIS reader follows the thread rides along with the thread itself.
    // A separate request would mean the follow button renders in the wrong state
    // for one paint on every page load, which reads as a broken toggle.
    //
    // optionalAuthMiddleware, not authMiddleware: the Record is public (§5.1) and
    // must stay readable signed-out. A signed-out reader simply gets `false`, and
    // a failed lookup degrades to `false` rather than losing the thread — nobody
    // should lose the page they came for because a toggle could not resolve.
    //
    // 🔴 By shortId, NOT thread.id. serializeThreadSummary exposes only the
    // public short id (D9); `thread.id` here is undefined, which would make the
    // toggle read "not following" for everyone while every test still passed.
    let subscribed = false;
    if (req.user?.id) {
      subscribed = (await write.threadSubscriptionByShortId(req.db, req.user.id, shortId)
        .catch(() => ({ subscribed: false }))).subscribed;
    }

    res.json({ success: true, thread: { ...thread, subscribed } });
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

/**
 * GET /api/forum/feed?ranker=&limit=
 *
 * The ONLY inherently personal endpoint in the spec (D2). Everything else is
 * public and cacheable.
 *
 * Every item comes back with `why` — a human-readable reason for its placement.
 * D11 makes that a ship gate: if a placement cannot be explained, it does not
 * ship, because "why am I seeing this?" having no answer is the defining
 * property of the thing this replaces.
 */
router.get('/feed', authMiddleware, loadActor, handled('feed', async (req, res) => {
  const which = String(req.query.ranker || ranker.DEFAULT_RANKER);
  if (!Object.keys(ranker.RANKERS).includes(which)) {
    return res.status(400).json({ success: false, error: 'Unknown ranker', code: 'unknown_ranker' });
  }
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));

  const [candidates, viewer] = await Promise.all([
    svc.getFeedCandidates(req.db),
    svc.getViewerContext(req.db, req.actor.id),
  ]);

  const items = ranker.rank(candidates, viewer, { ranker: which, limit });
  await svc.recordImpressions(req.db, req.actor.id, items, which);

  res.json({
    success: true,
    ranker: which,
    rankers: ranker.RANKERS,
    // The objective is stated in the payload on purpose: any client rendering
    // this feed can show what it is optimising for, and a change to it is a
    // visible API change rather than a quiet weight tweak.
    objective: 'minimize-time-to-resolution',
    items: items.map((i) => ({
      shortId: i.shortId, slug: i.slug, title: i.title, url: i.url,
      space: i.space, author: i.author, tags: i.tags,
      postCount: i.postCount, isResolved: i.isResolved,
      createdAt: i.createdAt, lastActivityAt: i.lastActivityAt,
      score: i.score, advisoryCount: i.advisoryCount,
      why: i.why, reasons: i.reasons,
    })),
  });
}));

/** POST /api/forum/threads/:shortId/opened — feeds seen-decay. */
router.post('/threads/:shortId/opened', authMiddleware, loadActor, handled('markOpened', async (req, res) => {
  const { rows } = await req.db.query('SELECT id FROM forum_threads WHERE short_id = $1',
    [String(req.params.shortId || '').toLowerCase()]);
  if (!rows[0]) return res.status(404).json({ success: false, error: 'Thread not found' });
  await svc.markOpened(req.db, req.actor.id, rows[0].id);
  res.json({ success: true });
}));

/* ──────────────────────────────────────────────────────────────────────────
 * Notifications (WP1) — the return path
 *
 * Loop A cannot close without these: you ask, someone answers, and until now
 * you were never told.
 * ────────────────────────────────────────────────────────────────────────── */

/** GET /api/forum/notifications?unread=1 — the list, plus the badge count. */
router.get('/notifications', authMiddleware, loadActor, handled('notifications', async (req, res) => {
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const [items, unread] = await Promise.all([
    notify.listNotifications(req.db, req.actor.id, { unreadOnly, limit: req.query.limit }),
    notify.unreadCount(req.db, req.actor.id),
  ]);
  res.json({ success: true, notifications: items, unread });
}));

/**
 * POST /api/forum/notifications/read — mark read.
 *
 * Body `{ ids: [...] }` marks those; an omitted body marks ALL, which is what
 * "mark all read" calls. Scoping is enforced in the service by `user_id` in the
 * WHERE clause, never by id alone — otherwise anyone could clear anyone's
 * notifications by guessing a uuid, and it would look like it worked.
 */
router.post('/notifications/read', authMiddleware, loadActor, handled('markRead', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const result = await notify.markRead(req.db, req.actor.id, ids);
  res.json({ success: true, ...result, unread: await notify.unreadCount(req.db, req.actor.id) });
}));

/* ──────────────────────────────────────────────────────────────────────────
 * Subscriptions — the write half of a signal that shipped read-only
 *
 * The v0.4 migration created `forum_subscriptions`, `getViewerContext` JOINed
 * it, and the ranker scored `you_follow_this_topic`. No route wrote it. So the
 * "Topics you follow" ranker returned an empty list for every user, forever.
 * ────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
 * Edit and delete (WP2)
 *
 * `status='deleted'`, `edited_at` and `edited_by` have been in the schema since
 * the first migration with nothing writing them. These are the write side.
 * ────────────────────────────────────────────────────────────────────────── */

/** PATCH /api/forum/posts/:id — edit your own post. Always marked as edited. */
router.patch('/posts/:id', authMiddleware, loadActor, handled('editPost', async (req, res) => {
  res.json({ success: true, ...(await write.editPost(req.db, req.actor, req.params.id, { body: req.body?.body })) });
}));

/**
 * DELETE /api/forum/threads/:shortId — delete a thread you started.
 *
 * If anyone else has answered, the thread REMAINS as a tombstone carrying their
 * answers; only the title and your question go. Deleting their work on your
 * request is a deletion of their data, not yours.
 */
router.delete('/threads/:shortId', authMiddleware, loadActor, handled('deleteThread', async (req, res) => {
  res.json({ success: true, ...(await write.deleteThread(req.db, req.actor, req.params.shortId)) });
}));

/** DELETE /api/forum/posts/:id — tombstone the post and blank its body. */
router.delete('/posts/:id', authMiddleware, loadActor, handled('deletePost', async (req, res) => {
  res.json({ success: true, ...(await write.deletePost(req.db, req.actor, req.params.id)) });
}));

/**
 * PUT /api/forum/threads/:shortId/subscription  { subscribed: bool }
 *
 * Follow or MUTE a thread. Posting subscribes you automatically; this is the
 * way back out, and it must exist in the same change that ships reply fan-out —
 * a forum you can only be added to is one people mute at the mail client
 * instead, and after that no notification works again.
 */
router.put('/threads/:shortId/subscription', authMiddleware, loadActor, handled('setThreadSubscription', async (req, res) => {
  const shortId = String(req.params.shortId || '').toLowerCase();
  const subscribed = req.body?.subscribed !== false;
  res.json({ success: true, ...(await write.setThreadSubscription(req.db, req.actor, shortId, subscribed)) });
}));

/**
 * GET /api/forum/me/activity — what you have taken part in (WP5).
 *
 * Threads you asked AND threads you answered. A list of only what you started
 * will never contain the question you helped somebody else with, which is
 * usually the one you are trying to find again.
 */
/* ──────────────────────────────────────────────────────────────────────────
 * Flag review (WP3)
 *
 * forum_flags carried status / resolved_by / resolved_at / resolution and
 * nothing in the application could read a flag or resolve one. "Report" was a
 * button whose report went into a table with no reader.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/forum/moderation-log — PUBLIC. No auth, by design.
 *
 * §7.2/§11: "if the thesis is openness, moderation is where it is tested."
 * A log only staff can read is not a public log.
 *
 * Carries actions TAKEN — never accusations made, never the reporter, never
 * the removed content. See listModerationLog for why each of those is out.
 */
router.get('/moderation-log', async (req, res) => {
  try {
    res.json({ success: true, log: await svc.listModerationLog(req.db, { limit: req.query.limit }) });
  } catch (error) {
    return serverError(res, error, 'moderationLog');
  }
});

/** GET /api/forum/flags?status=open — the review queue. Needs review_flags. */
router.get('/flags', authMiddleware, loadActor, handled('listFlags', async (req, res) => {
  res.json({
    success: true,
    flags: await write.listFlags(req.db, req.actor, { status: req.query.status, limit: req.query.limit }),
  });
}));

/**
 * POST /api/forum/flags/:id/resolve  { action: 'dismiss' | 'action', note }
 *
 * `action` hides the target as part of the same resolution. A queue whose only
 * outcome is a status column is theatre — the reporter would see their report
 * marked handled while the thing they reported is still on the page.
 */
router.post('/flags/:id/resolve', authMiddleware, loadActor, handled('resolveFlag', async (req, res) => {
  res.json({
    success: true,
    ...(await write.resolveFlag(req.db, req.actor, req.params.id, {
      action: req.body?.action, note: req.body?.note,
    })),
  });
}));

router.get('/me/activity', authMiddleware, loadActor, handled('myActivity', async (req, res) => {
  res.json({ success: true, threads: await svc.listMyActivity(req.db, req.actor.id, { limit: req.query.limit }) });
}));

/** GET /api/forum/subscriptions — tags you follow. */
router.get('/subscriptions', authMiddleware, loadActor, handled('listSubscriptions', async (req, res) => {
  res.json({ success: true, tags: await write.listSubscriptions(req.db, req.actor.id) });
}));

/** POST /api/forum/subscriptions { tag } — follow. Idempotent. */
router.post('/subscriptions', authMiddleware, loadActor, handled('subscribeTag', async (req, res) => {
  res.json({ success: true, ...(await write.subscribeTag(req.db, req.actor, req.body?.tag)) });
}));

/**
 * DELETE /api/forum/subscriptions — unfollow. Idempotent.
 *
 * The tag travels in the BODY, not the path. A namespaced tag contains a colon
 * (`product:pixel`), and putting one in a path segment means every client has
 * to agree on encoding it — which is exactly the kind of detail that works in
 * curl and breaks in one SDK. The body carries it verbatim.
 */
router.delete('/subscriptions', authMiddleware, loadActor, handled('unsubscribeTag', async (req, res) => {
  res.json({ success: true, ...(await write.unsubscribeTag(req.db, req.actor, req.body?.tag)) });
}));

export default router;

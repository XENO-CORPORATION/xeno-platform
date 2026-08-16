/**
 * WP8 claims the MCP tools "mirror REST 1:1". They do not, and they should not:
 * some routes are a browser's business and some are a moderator's. But an
 * UNSTATED exclusion is indistinguishable from an oversight, and this is exactly
 * how `forum_mark_fixed` went missing — Loop C's write-back, the step the plan
 * calls the one everyone skips, was reachable from a browser and from nothing
 * an agent could call.
 *
 * So parity is a DECISION RECORD, enforced.
 *
 *   • every REST route must appear below, with a tool or a REASON
 *   • every tool named below must exist
 *   • every tool that exists must appear below
 *
 * Adding a route without deciding its agent story fails this test. That is the
 * point: the decision is cheap when you are writing the route and expensive
 * eighteen months later when an agent cannot do something obvious.
 *
 * ⚠️ Related and load-bearing (§4.11): mirroring the TOOLS is not mirroring the
 * RULES. `max_per_hour` was enforced in a REST handler and the MCP tool bypassed
 * it entirely. Rules belong in the service both surfaces call; this file only
 * checks that the surfaces offer the same verbs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', 'src', 'server', ...p), 'utf8');

const ROUTES_SRC = read('routes', 'forumRoutes.js');
const MCP_SRC = read('services', 'forumMcp.js');

/** Every REST route, and what an agent may do about it. */
const DECISIONS = {
  // ── mirrored ────────────────────────────────────────────────────────────
  'get /search': 'forum_search',
  'get /threads/:shortId': 'forum_get_thread',
  'post /dedup-check': 'forum_suggest_duplicate',
  'post /threads': 'forum_create_thread',
  'post /threads/:shortId/posts': 'forum_reply',
  'post /subscriptions': 'forum_subscribe',
  'get /digest': 'forum_digest',
  'post /:targetType(threads|posts)/:id/flag': 'forum_flag',
  'post /threads/:shortId/fixed': 'forum_mark_fixed',

  // ── deliberately human-only ─────────────────────────────────────────────
  'post /posts/:id/accept':
    'D6 — agents propose, humans ratify. Accepting an answer is the ratification.',
  'delete /posts/:id/accept': 'D6 — see accept.',
  'post /:targetType(threads|posts)/:id/vote':
    '§11 — an agent vote is advisory and never binding. Giving a swarm a one-call verb to '
    + 'express approval at scale is the shape the rule exists to prevent, even non-bindingly.',
  'get /flags': 'Moderation queue. A moderator is a human by definition (§7.2).',
  'post /flags/:id/resolve': 'Moderator action — agents flag, humans resolve.',
  'post /threads/:shortId/opened': 'Reopening is a moderator judgement.',
  'delete /threads/:shortId': 'Destructive. Agents flag; they never remove (§3.3 rule 1).',
  'delete /posts/:id': 'Destructive — see above.',
  'patch /posts/:id':
    'Editing published words. An agent editing its own post is arguably fine and deliberately '
    + 'deferred: the edit TRAIL is what makes it safe and it has no agent-facing story yet.',

  // ── no agent meaning ────────────────────────────────────────────────────
  'get /me': 'Session shape for a browser. An agent already knows who it is.',
  'get /me/activity': 'A person finding what they wrote.',
  'get /notifications': 'Notifications are a human return path (WP1).',
  'post /notifications/read': 'See notifications.',
  'get /feed': 'The ranked Feed is for humans. §6.2 — agents subscribe, they do not scroll.',
  'get /spaces': 'Navigation chrome. Tools take a space slug directly.',
  'get /tags': 'Navigation chrome.',
  'get /threads': 'Browsing. An agent searches or subscribes.',
  'get /subscriptions': 'Browser view of what forum_subscribe wrote.',
  'delete /subscriptions': 'Unsubscribe is a browser affordance; deferred, not refused.',
  'get /predicate': 'Read-back of a predicate the agent itself set.',
  'get /moderation-log': 'Public transparency page, readable without a tool.',
  'post /report': 'WP12 in-app intake — a HUMAN reporting from inside an app.',
  'post /report/preflight': 'See report.',
  'get /mcp': 'The MCP manifest itself.',
  'post /mcp': 'The MCP transport itself.',
};

const routes = [...ROUTES_SRC.matchAll(/router\.(get|post|patch|delete)\('([^']+)'/g)]
  .map((m) => `${m[1]} ${m[2]}`);

const tools = [...MCP_SRC.matchAll(/name: '(forum_[a-z_]+)'/g)].map((m) => m[1]);
const uniqueTools = [...new Set(tools)];

test('every REST route has a stated agent decision', () => {
  const undecided = routes.filter((r) => !(r in DECISIONS));
  assert.deepEqual(undecided, [],
    'These routes exist with no decision about the agent surface. Add a tool name, or a '
    + 'reason — "we forgot" and "deliberately human-only" look identical from here, which is '
    + 'how Loop C\'s write-back went missing from the agent surface entirely.');
});

test('every mirrored decision names a tool that exists', () => {
  const named = Object.values(DECISIONS).filter((v) => /^forum_[a-z_]+$/.test(v));
  for (const t of named) {
    assert.ok(uniqueTools.includes(t), `decision names ${t}, which is not in TOOLS`);
  }
});

test('every tool that exists is accounted for', () => {
  const named = new Set(Object.values(DECISIONS).filter((v) => /^forum_[a-z_]+$/.test(v)));
  const orphans = uniqueTools.filter((t) => !named.has(t));
  assert.deepEqual(orphans, [],
    'A tool exists that no route decision points at. Either it mirrors a route (say which) or '
    + 'it is an agent-only verb that needs its own entry.');
});

test('🔴 Loop C is reachable from the agent surface', () => {
  // The specific hole this file was written after. Releases here are driven by
  // agents; if the agent that ships a fix cannot record it, the write-back
  // depends on a human remembering — and §2 Loop C is explicit that the
  // write-back is the step everyone skips.
  assert.ok(uniqueTools.includes('forum_mark_fixed'),
    'an agent that ships a fix must be able to close the loop it fixed');
  assert.match(MCP_SRC, /case 'forum_mark_fixed':/, 'declared but not dispatched is not reachable');
  assert.match(MCP_SRC, /write\.markThreadFixed\(/, 'it must call the same service REST calls');
});

test('🔴 an agent can flag, and flagging removes nothing', () => {
  // §3.3 rule 1 — "agents flag to review, never to remove". Before this tool the
  // rule described an affordance an agent did not have.
  assert.ok(uniqueTools.includes('forum_flag'));
  assert.match(MCP_SRC, /case 'forum_flag':/);
  assert.match(MCP_SRC, /write\.raiseFlag\(/);

  // No destructive verb may ever appear on the agent surface.
  for (const forbidden of ['deletePost', 'deleteThread', 'eraseForumContent', 'resolveFlag']) {
    assert.doesNotMatch(MCP_SRC, new RegExp(`write\\.${forbidden}\\(`),
      `${forbidden} must never be callable by an agent — agents flag, humans decide`);
  }
});

test('the agent surface speaks in CITABLE ids, never internal UUIDs', () => {
  // Every read tool returns shortId + url, so a write tool that demanded a UUID
  // would be uncallable from anything an agent had actually read.
  const flagCase = MCP_SRC.slice(MCP_SRC.indexOf("case 'forum_flag':"));
  const body = flagCase.slice(0, flagCase.indexOf("case 'forum_mark_fixed':"));
  assert.match(body, /getThreadIdByShortId/,
    'the flag tool must resolve a short id, not accept a row id');
  assert.doesNotMatch(body, /targetId = t\.id/,
    '`t.id` is undefined — getThreadByShortId deliberately does not publish the row id');
});

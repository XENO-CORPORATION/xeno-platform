/**
 * WP3 — flag review.
 *
 * `forum_flags` carried status / resolved_by / resolved_at / resolution — the
 * ENTIRE review workflow, modelled — while `raiseFlag` INSERTed into it and
 * nothing in the application could read a flag or resolve one. "Report" was a
 * button whose report went into a table with no reader.
 *
 * Seventh instance of that shape in this codebase, so these lead with
 * reachability and with the thing that makes a queue real: an outcome.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WRITE = codeOnly(readFileSync(src('services', 'forumWrite.js'), 'utf8'));
const ROUTES = codeOnly(readFileSync(src('routes', 'forumRoutes.js'), 'utf8'));
const fn = (name) => {
  const s = WRITE.slice(WRITE.indexOf(`export async function ${name}`));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
};

test('a flag can finally be READ and RESOLVED over HTTP', () => {
  assert.match(ROUTES, /router\.get\(\s*['"]\/flags['"]/,
    'no GET /flags — reports keep going into a table nothing reads.');
  assert.match(ROUTES, /router\.post\(\s*['"]\/flags\/:id\/resolve['"]/, 'no resolve route.');
  assert.match(ROUTES, /write\.listFlags/);
  assert.match(ROUTES, /write\.resolveFlag/);
});

test('🔴 "actioned" HIDES the content — a status-only queue is theatre', () => {
  // If upholding a report does not remove what was reported, the reporter sees
  // their report marked handled while the thing is still on the page. That is
  // worse than no queue: it teaches people reporting is pointless AND tells
  // them so officially.
  const body = fn('resolveFlag');

  // ⚠️ WHITESPACE-TOLERANT, AND THAT IS THE POINT. These assertions used to pin
  // the exact one-line SQL `UPDATE forum_threads SET status = 'locked'`. Adding
  // `locked_by`/`locked_at` — so a locked thread can say who locked it and when
  // — reformatted the statement across lines and broke the test, while making
  // the property it describes STRICTLY STRONGER.
  //
  // Fourth time a test in this repo has pinned a mechanism and then blocked an
  // improvement to the thing it guards. Pin WHAT: the statement updates that
  // table, to that status.
  assert.match(body, /UPDATE\s+forum_posts\s+SET[\s\S]{0,120}?status\s*=\s*'hidden'/,
    'upholding a flag on a post must hide it.');
  assert.match(body, /UPDATE\s+forum_threads\s*[\s\S]{0,40}?SET[\s\S]{0,120}?status\s*=\s*'locked'/,
    'upholding a flag on a thread must lock it.');
});

test("a moderator hiding something is not the author deleting it", () => {
  // 'hidden', never 'deleted'. Both are invisible to readers; only one is the
  // author's own choice, and a public moderation log has to tell them apart.
  const body = fn('resolveFlag');
  assert.doesNotMatch(body, /UPDATE forum_posts SET status = 'deleted'/,
    "moderation must not masquerade as the author retracting their own post.");
});

test('every flag on the same target resolves together', () => {
  // Three people reporting one post is ONE decision. Leaving the other two open
  // shows a reviewer a queue of work that has already been done.
  const body = fn('resolveFlag');

  // 🔴 THIS TEST ASSERTED THE BROKEN QUERY. It pinned the literal placeholder
  // numbers `$5`/`$6` as a proxy for "resolves by target" — and those numbers
  // were only what they were because a `flagId` sat unused at `$1`, which made
  // the statement fail to prepare and meant NO MODERATOR COULD EVER RESOLVE A
  // FLAG. The test was green throughout, and would have blocked the fix.
  //
  // Placeholder numbering is a MECHANISM. The property is: the UPDATE selects
  // by TARGET and does not narrow to a single flag row.
  const update = body.slice(body.indexOf('UPDATE forum_flags'));
  assert.match(update, /WHERE target_type = \$\d+ AND target_id = \$\d+/,
    'the resolution must apply to the target, not just the one flag id.');
  assert.match(update, /status IN \('open', 'reviewing'\)/,
    'and only to flags that are still open.');
  assert.doesNotMatch(update.slice(0, 400), /(WHERE|AND) id = \$/,
    'narrowing to one flag row would leave the other reports on the same target open.');
});

test('an already-resolved flag cannot be resolved again', () => {
  const body = fn('resolveFlag');
  assert.match(body, /flag_already_resolved/,
    're-resolving would overwrite who decided and when.');
});

test('reviewing needs the capability, and the action is validated', () => {
  assert.match(fn('listFlags'), /assertCan\(db, user, 'review_flags'\)/,
    'the queue exposes reporters and unpublished content.');
  assert.match(fn('resolveFlag'), /assertCan\(db, user, 'review_flags'\)/);
  assert.match(fn('resolveFlag'), /\['dismiss', 'action'\]\.includes\(action\)/,
    'an unrecognised action must be refused, never treated as a dismiss.');
});

test('reviewers see who reported — readers never will', () => {
  // A flag is an accusation, and an anonymous accusation cannot be weighed: the
  // same person reporting the same author six times is the most useful signal
  // in a moderation queue. The PUBLIC log carries decisions, never reporters.
  const body = fn('listFlags');
  assert.match(body, /reporter_name/, 'the queue must show the reporter.');
  assert.match(body, /reporter_kind/,
    'and their kind — an agent may flag-to-review, never flag-to-remove (§7.2).');
});

test('the queue is bounded and its status filter is validated', () => {
  const body = fn('listFlags');
  assert.match(body, /Math\.min\(200/, 'bounded.');
  assert.match(body, /\['open', 'reviewing', 'actioned', 'dismissed'\]\.includes\(status\)/,
    'an unknown status must fall back, not interpolate into the query.');
});

// ── the public moderation log (§7.2, §11) ─────────────────────────────────

const SERVICE = codeOnly(readFileSync(src('services', 'forumService.js'), 'utf8'));
const logFn = () => {
  const s = SERVICE.slice(SERVICE.indexOf('export async function listModerationLog'));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
};

test('the log is PUBLIC — no auth', () => {
  // "If the thesis is openness, moderation is where it is tested." A log only
  // staff can read is not a public log.
  const route = ROUTES.slice(ROUTES.indexOf("router.get('/moderation-log'"));
  const decl = route.slice(0, route.indexOf('\n'));
  assert.doesNotMatch(decl, /authMiddleware/,
    'gating the moderation log behind auth defeats its entire purpose.');
});

test('🔴 ACTIONS taken, never ACCUSATIONS made — dismissals stay private', () => {
  // Publishing a dismissed flag creates a permanent public record that a named
  // person was reported for "abuse" and cleared. That is a worse outcome for an
  // innocent author than the report ever was, and it turns the log into a
  // weapon: anyone could put a neighbour into the public record by reporting
  // them.
  const body = logFn();
  assert.match(body, /WHERE f\.status = 'actioned'/,
    'only upheld decisions may be published.');
  assert.doesNotMatch(body, /'dismissed'/,
    'a dismissed report must never reach the public log.');
});

test('never the reporter', () => {
  // Naming the accuser publicly makes reporting an act of open conflict, and
  // the people most in need of the report button can least afford that.
  const body = logFn();
  assert.doesNotMatch(body, /reporter_id|reporter_name|reporter_kind/,
    'the public log must not carry who reported.');
});

test('never the removed content', () => {
  // Republishing what was hidden defeats hiding it, and would make the log the
  // most reliable place to find exactly the material moderation removes.
  const body = logFn();
  assert.doesNotMatch(body, /p\.body|post_excerpt|detail/,
    'the log states that something was removed, never what it said.');
});

test('one decision per target, not one row per report', () => {
  // Three people reporting one post produced three flag rows and ONE moderator
  // decision. Listing it three times misrepresents both the volume of
  // moderation and how much trouble a single author caused.
  const body = logFn();
  assert.match(body, /const seen = new Set\(\)/, 'must dedup by target.');
});

test('the outcome distinguishes a moderator hide from an author deletion', () => {
  // "removed" flattens a moderator decision and a retraction into one word.
  const body = logFn();
  assert.match(body, /outcome: r\.target_status/,
    'the log must state hidden / locked, not a generic "removed".');
});

test('and it is bounded', () => {
  assert.match(logFn(), /Math\.min\(200/);
  assert.match(logFn(), /LIMIT \$1/);
});

/**
 * WP7 — Loop C's write-back.
 *
 * The release plan calls this the step everyone skips, and says why: a user who
 * reports something and never learns it mattered never reports again, and the
 * archive fills with open threads describing bugs fixed a year ago — actively
 * misleading the next reader AND the next agent, which is exactly the asset the
 * Forum exists to build.
 *
 * ⚠️ Authored as a file, not a heredoc, and every mutation of it run through
 * scratchpad/mutate.cjs — both because a silently-unapplied change reads
 * identically to a passing gate.
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
const MIG = readFileSync(
  src('database', 'migrations', '20260816120000-forum-fixed-in.sql'), 'utf8');

const fn = () => {
  const s = WRITE.slice(WRITE.indexOf('export async function markThreadFixed'));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
};

test('the write-back is reachable', () => {
  assert.match(ROUTES, /router\.post\(\s*['"]\/threads\/:shortId\/fixed['"]/,
    'no route — the loop would close only for whoever runs SQL by hand.');
  assert.match(ROUTES, /write\.markThreadFixed/);
});

test('🔴 a shipped fix is its OWN fact, not a fake accepted answer', () => {
  // `resolved_at`/`resolved_by`/`answer_post_id` already mean "a human accepted
  // an answer". A shipped fix is different: nobody answered, the PRODUCT
  // changed. Collapsing them would show a reader an accepted answer that does
  // not exist, and make Loop D's one question — "what did we ship fixes for" —
  // unanswerable.
  const body = fn();
  assert.match(body, /fixed_in_version = \$2, fixed_at = NOW\(\)/,
    'the fix must be recorded in its own columns.');
  assert.doesNotMatch(body, /answer_post_id\s*=/,
    'marking a thread fixed must NOT set an accepted answer.');
  assert.doesNotMatch(body, /resolved_by\s*=/,
    'resolved_by means a human accepted something — leave it alone.');
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS fixed_in_version TEXT/);
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS fixed_at TIMESTAMPTZ/);
});

test('THE LOOP CLOSES — the reporter and the followers are told', () => {
  // Without this the whole feature is a status column. The notification is the
  // product; the column is bookkeeping.
  const body = fn();
  assert.match(body, /userId: thread\.author_id/,
    'the person who reported it must hear that it shipped.');
  assert.match(body, /threadReplyRecipients\(/,
    'so must everyone else following the thread.');
  assert.match(body, /exceptUserId: user\.id/,
    'the staff member who marked it fixed does not need telling.');
});

test('a release note is a real POST, not just a flag on the thread', () => {
  // The column is for machines. The post is for the person who reported it —
  // it is what they land on when they follow the notification, and it is what
  // the next reader (and the next agent) finds in the archive.
  const body = fn();
  assert.match(body, /INSERT INTO forum_posts/, 'the fix must leave a visible trace.');
  assert.match(body, /'release'/,
    "source='release' — so a release note is distinguishable from a human reply.");
});

test('idempotent for the SAME version', () => {
  // A runbook that retries, or two pipeline steps that both call this, must not
  // post twice and must not notify twice. A second "your report was fixed" is
  // the fastest way to teach someone to ignore the one message that matters.
  const body = fn();
  assert.match(body, /if \(thread\.fixed_in_version === clean\)/,
    're-recording the same version must be a no-op.');
  assert.match(body, /alreadyRecorded: true/, 'and must say so rather than pretending to act.');
});

test('staff only — and that includes an agent whose OWNER is staff', () => {
  // The platform caps an agent's effective role at its owner's rather than
  // special-casing agents, which is what lets a release pipeline or a product's
  // dev agent close the loop without a second authorization model.
  const body = fn();
  assert.match(body, /\['admin', 'moderator'\]\.includes\(user\.role\)/);
  assert.match(body, /staff_required/, 'and the refusal must be typed.');
  assert.match(body, /assertNotService\(user\)/);
});

test('NOT rate-limited — a release that fixed twelve things writes back twelve times', () => {
  const body = fn();
  assert.doesNotMatch(body, /assertWithinRateLimit/,
    'this is a release action, not participation.');
  assert.doesNotMatch(body, /assertCan\(db, user, 'post'\)/,
    'and it must not require earned reputation.');
});

test('a version is required and bounded', () => {
  const body = fn();
  assert.match(body, /version_required/, 'an empty version would post "Fixed in ." ');
  assert.match(body, /clean\.length > 64/, 'and an unbounded string is a free text field in a title position.');
});

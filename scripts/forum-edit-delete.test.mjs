/**
 * WP2 — edit and delete.
 *
 * `forum_posts.status IN ('visible','hidden','deleted')`, `edited_at` and
 * `edited_by` have been in the schema since the first migration. `edited_at` is
 * serialized by forumService and typed in ForumThread.tsx — the READ side was
 * complete top to bottom and nothing ever wrote any of them. Sixth instance of
 * that shape here, so these gates lead with reachability.
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
  return s.slice(0, s.indexOf('\nexport '));
};

// ── reachability ───────────────────────────────────────────────────────────

test('edit and delete are REACHABLE over HTTP', () => {
  assert.match(ROUTES, /router\.patch\(\s*['"]\/posts\/:id['"]/,
    'no PATCH /posts/:id — edit would exist as a function nobody can call.');
  assert.match(ROUTES, /router\.delete\(\s*['"]\/posts\/:id['"]/,
    'no DELETE /posts/:id.');
  assert.match(ROUTES, /write\.editPost/, 'the route must call the service.');
  assert.match(ROUTES, /write\.deletePost/, 'the route must call the service.');
});

// ── the Record stays honest ────────────────────────────────────────────────

test('EVERY edit is marked — there is no grace period', () => {
  // Discourse hides edits made in the first few minutes. Friendlier, and wrong
  // here: the Record is permanent and public (§5.1), and its worth to the next
  // reader — and to an agent citing it — depends on it not having been quietly
  // rewritten. This matters most for an ACCEPTED answer, where an unmarked edit
  // means the archive shows a vouched-for answer nobody vouched for.
  const body = fn('editPost');
  assert.match(body, /edited_at = NOW\(\)/,
    'an edit that does not stamp edited_at rewrites history silently.');
  assert.doesNotMatch(body, /INTERVAL|grace|withinMinutes/i,
    'no grace window — every edit is visible.');
  assert.match(body, /edited_by = \$3/,
    'record WHO edited, so a moderator edit is not mistaken for the author '
    + 'changing their mind.');
});

test('delete removes the CONTENT, not just the visibility', () => {
  // Keeping the body would mean "delete" leaves your words in the database,
  // which is not what the word means to the person clicking it.
  const body = fn('deletePost');
  assert.match(body, /status = 'deleted'/, 'the row must be tombstoned.');
  assert.match(body, /body = ''/,
    "blanking the body is what makes this a delete rather than a hide — and "
    + 'because search_vector is GENERATED ALWAYS from body, it is also what '
    + 'removes the post from the search index, with no separate reindex to forget.');
});

test('the row SURVIVES — deletion is a tombstone, never a DELETE', () => {
  const body = fn('deletePost');
  assert.doesNotMatch(body, /DELETE FROM forum_posts/,
    'removing the row renumbers positions and orphans the replies that quote '
    + 'it, so the thread reads as if the conversation never made sense.');
});

test('deleting the ACCEPTED answer reopens the thread', () => {
  // Leaving answer_post_id pointing at a tombstone shows a resolved question
  // whose resolution is blank — worse than an open one, because it stops
  // anybody answering it.
  const body = fn('deletePost');
  assert.match(body, /answer_post_id = NULL/, 'the pointer must be cleared.');
  assert.match(body, /status = 'open'/, 'the thread must reopen.');
  assert.match(body, /recomputeReputationForThread/,
    'reputation earned by an answer that no longer exists must be recomputed.');
  assert.match(body, /is_answer = FALSE/, 'the post must stop claiming to be the answer.');
});

test('the question itself cannot be deleted this way', () => {
  // Position 1 IS the question; deleting it leaves answers to nothing. Refused
  // explicitly rather than half-done — thread deletion is its own change.
  const body = fn('deletePost');
  assert.match(body, /position === 1/, 'position 1 must be handled.');
  assert.match(body, /cannot_delete_first_post/,
    'the refusal must be a typed code, not a generic 400 the UI cannot explain.');
});

// ── authorization ──────────────────────────────────────────────────────────

test('only the author or a moderator may edit or delete', () => {
  for (const name of ['editPost', 'deletePost']) {
    const body = fn(name);
    assert.match(body, /String\(post\.author_id\) === String\(user\.id\)/,
      `${name} must compare the author as a string — a uuid vs string mismatch `
      + 'here fails OPEN in the wrong direction if it is ever ===\'d loosely.');
    assert.match(body, /\['admin', 'moderator'\]\.includes\(user\.role\)/,
      `${name} must allow staff.`);
    assert.match(body, /assertNotService\(user\)/,
      `${name} must refuse service principals — no owner, nobody accountable.`);
  }
});

test('an already-deleted post cannot be edited or re-deleted', () => {
  for (const name of ['editPost', 'deletePost']) {
    assert.match(fn(name), /status === 'deleted'/,
      `${name} must treat a tombstone as absent, or a deleted post could be `
      + 'edited back into existence.');
  }
});

test('a locked thread refuses edits', () => {
  assert.match(fn('editPost'), /thread_locked/,
    'locking a thread must stop edits too, or moderation is cosmetic.');
});

// ── the audit columns exist ────────────────────────────────────────────────

test('who deleted a post, and when, is recorded', () => {
  const mig = readFileSync(
    src('database', 'migrations', '20260815140000-forum-post-deletion.sql'), 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS deleted_at/, 'when.');
  assert.match(mig, /deleted_by UUID REFERENCES users\(id\) ON DELETE SET NULL/,
    'who — and SET NULL, because if the moderator later leaves, the deletion is '
    + 'still a fact that happened. CASCADE would erase the audit trail as a side '
    + 'effect of an unrelated account closure.');
  assert.match(fn('deletePost'), /deleted_at = NOW\(\), deleted_by/,
    'the service must actually write them.');
});

// ── the UI half — a delete API with no button is the same defect ───────────

const THREAD = codeOnly(readFileSync(
  join(__dirname, '..', 'src', 'pages', 'ForumThread.tsx'), 'utf8'));
const CLIENT = codeOnly(readFileSync(
  join(__dirname, '..', 'src', 'components', 'forum', 'api.ts'), 'utf8'));

test('the thread page can actually edit and delete', () => {
  assert.match(CLIENT, /editPost\s*=/, 'api.ts must expose editPost.');
  assert.match(CLIENT, /deletePost\s*=/, 'api.ts must expose deletePost.');
  assert.match(THREAD, /api\.editPost\(/, 'ForumThread must call it.');
  assert.match(THREAD, /api\.deletePost\(/, 'ForumThread must call it.');
});

test('ownership is decided by a NON-NULL handle', () => {
  // 🔴 Agents and seeded posts carry `handle: null`. A bare
  // `p.author.handle === me.handle` makes every reader the owner of every
  // seeded post the moment their own handle is also null — a comparison that
  // looks obviously fine and is a privilege escalation.
  const fnSrc = THREAD.slice(THREAD.indexOf('const ownsPost'));
  const body = fnSrc.slice(0, fnSrc.indexOf('}, ['));
  assert.match(body, /Boolean\(mine && p\.author\?\.handle &&/,
    'ownsPost must require both handles to be non-null before comparing them.');
});

test('the question itself offers no delete control', () => {
  // The server refuses it; the UI must not offer a button that always errors.
  assert.match(THREAD, /ownsPost\(post\) && post\.position !== 1/,
    'position 1 must not render edit/delete — a control that always fails is '
    + 'worse than an absent one.');
});

test('deleting takes two clicks, and not via window.confirm', () => {
  assert.match(THREAD, /'really delete\?' : 'delete'/,
    'the second click is the commitment.');
  const del = THREAD.slice(THREAD.indexOf("confirmDelete === post.id ? doDelete"));
  assert.doesNotMatch(del.slice(0, 200), /window\.confirm/,
    'a native confirm hands the decision to a dialog nobody reads.');
});

test('"edited" is finally RENDERED — the field existed and never appeared', () => {
  // editedAt has been serialized by the API and typed in this file since v0.2
  // with nothing writing it, so the marker never showed. An unmarked edit on an
  // accepted answer means the archive shows something nobody vouched for.
  assert.match(THREAD, /post\.editedAt &&/,
    'the edited marker must render.');
  assert.match(THREAD, /Edits are shown publicly/,
    'the editor should say so before you save, not after.');
});

// ── GDPR erasure: the forum's half ─────────────────────────────────────────

const ERASE = codeOnly(readFileSync(src('utils', 'gdprErasure.js'), 'utf8'));

test('erasure actually reaches forum content', () => {
  // gdprErasure tombstones the BYLINE. A post body is free text written by the
  // subject and routinely contains their own personal data — anonymising the
  // author while leaving "my number is …" published is not erasure.
  assert.match(ERASE, /eraseForumContent\(client, userId\)/,
    'eraseSubject never touches forum content: every post and thread body the '
    + 'subject wrote stays published after they ask to be erased.');
  assert.match(ERASE, /import \{ eraseForumContent \}/, 'and it must import it.');
});

test('forum erasure runs INSIDE the erasure transaction', () => {
  // A failure here must roll back the identity tombstone too, rather than
  // reporting a half-erased subject as erased.
  const i = ERASE.indexOf('eraseForumContent(client, userId)');
  const commit = ERASE.indexOf("client.query('COMMIT')");
  assert.ok(i > 0 && commit > i,
    'eraseForumContent must be called before COMMIT, on the same client.');
});

test('erasure is SCOPED to the subject', () => {
  // The failure mode is not subtle: an UPDATE missing its WHERE blanks the
  // entire forum on one person's erasure request.
  const body = fn('eraseForumContent');
  const updates = body.match(/UPDATE forum_(posts|threads)[\s\S]*?(?=`)/g) || [];
  assert.ok(updates.length >= 3, 'expected the posts, titles and reopen updates');
  for (const u of updates) {
    assert.match(u, /author_id = \$1|author_id = \(SELECT|WHERE t\.answer_post_id IN|t\.id IN \(SELECT/,
      `an UPDATE in eraseForumContent is not scoped to the subject:\n${u.slice(0, 120)}`);
  }
});

test('the subject\'s words go; OTHER PEOPLE\'S posts stay', () => {
  const body = fn('eraseForumContent');
  assert.match(body, /body = ''/,
    "blanking the body is the erasure — and because search_vector is GENERATED "
    + 'ALWAYS from body, it also drops the post out of the full-text index.');
  assert.doesNotMatch(body, /thread_id IN \(SELECT id FROM forum_threads WHERE author_id[\s\S]{0,80}(DELETE|body = '')/,
    'erasing a thread must NOT blank the answers other people wrote in it — '
    + 'that is third-party data, destroyed on one person\'s request.');
  assert.match(body, /title = '\[removed\]'/,
    'a title is free text too, and the most-indexed sentence in the product.');
});

test('an erased accepted answer reopens its thread', () => {
  const body = fn('eraseForumContent');
  assert.match(body, /answer_post_id = NULL, status = 'open'/,
    'a thread pointing at a blanked answer shows a resolved question with no '
    + 'resolution, which stops anyone answering it.');
  assert.match(body, /post_count = \(SELECT COUNT/,
    'counts must be recomputed or threads claim replies that are gone.');
});

test('erasure takes a CLIENT, not a pool', () => {
  assert.match(WRITE, /export async function eraseForumContent\(client, userId\)/,
    'taking a pool would open a second connection outside the transaction, so a '
    + 'failure would leave the identity erased and the content published.');
});

// ── thread deletion, and the read-side leak it could have caused ───────────

const SERVICE = codeOnly(readFileSync(src('services', 'forumService.js'), 'utf8'));

test('🔴 NO read path still uses the bare `<> archived` filter', () => {
  // This is the gate that matters in this change. Every thread read filtered
  // `t.status <> 'archived'` — a blocklist of exactly ONE value, in four
  // separate places. Adding 'deleted' to the CHECK without updating all four
  // produces deleted threads that are still listed everywhere, on a feature
  // whose entire purpose is that they are not.
  //
  // "Remember to update the other three" is not a mechanism. This is.
  assert.doesNotMatch(SERVICE, /status\s*<>\s*'archived'/,
    "a read path still filters only 'archived'. Deleted threads leak through it.");
  const filters = SERVICE.match(/status NOT IN \([^)]*\)/g) || [];
  assert.ok(filters.length >= 4, `expected 4+ status filters, found ${filters.length}`);
  for (const f of filters) {
    assert.match(f, /'deleted'/, `a status filter does not exclude deleted: ${f}`);
  }
});

test('deleting a thread is reachable', () => {
  assert.match(ROUTES, /router\.delete\(\s*['"]\/threads\/:shortId['"]/,
    'no DELETE /threads/:shortId.');
  assert.match(ROUTES, /write\.deleteThread/, 'the route must call the service.');
});

test('a thread nobody answered goes; one with answers becomes a tombstone', () => {
  // A thread stops being only yours the moment somebody answers it. Their
  // answer is their work, and usually the reason the thread has value at all.
  const body = fn('deleteThread');
  assert.match(body, /author_id IS DISTINCT FROM/,
    'must count posts by OTHER authors — IS DISTINCT FROM, because author_id is '
    + 'nullable and `<> NULL` is never true, which would report every thread as '
    + 'having other voices and make full deletion unreachable.');
  assert.match(body, /position > 1/, "the author's own question does not count as another voice.");
  assert.match(body, /status = 'visible'/,
    'a reply the author already deleted must not keep their thread alive forever.');
  assert.match(body, /CASE WHEN \$3::boolean THEN status ELSE 'deleted' END/,
    'with other voices the thread KEEPS its status; without them it is deleted.');
});

test("the author's own content goes either way", () => {
  const body = fn('deleteThread');
  assert.match(body, /SET body = '', status = 'deleted'[\s\S]*?position = 1/,
    'the question body must be blanked in both branches.');
  assert.match(body, /title = '\[removed\]'/, 'the title is free text too.');
});

test('only the author or staff may delete a thread', () => {
  const body = fn('deleteThread');
  assert.match(body, /String\(thread\.author_id\) === String\(user\.id\)/);
  assert.match(body, /\['admin', 'moderator'\]\.includes\(user\.role\)/);
  assert.match(body, /assertNotService\(user\)/);
});

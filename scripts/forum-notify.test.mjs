/**
 * WP1 notifications — reachability + behaviour gates.
 *
 * 🔴 Read this before adding a test here.
 *
 * The defect this file exists to prevent is NOT "notify() is wrong". It is
 * "nothing calls notify()". This codebase has shipped that exact shape three
 * times — xeno-workflow's 76 node types (defined, barrel-exported, fully
 * unit-tested, registered nowhere), xeno-tools' `install` IPC that no code path
 * invoked, and the Forum's own subscriptions, where the ranker scored
 * `you_follow_this_topic` while nothing in the app could write a subscription.
 *
 * Every one of those had green unit tests. A unit test proves a function is
 * correct; it never proves the application can reach it. So the first three
 * tests here read SOURCE and assert the call sites exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { notify, markRead, listNotifications, unreadCount } from '../src/server/services/forumNotify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);

/** Strip comments — call sites are DISCUSSED in prose all over these files. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const WRITE = codeOnly(readFileSync(src('services', 'forumWrite.js'), 'utf8'));
const ROUTES = codeOnly(readFileSync(src('routes', 'forumRoutes.js'), 'utf8'));
const NOTIFY = codeOnly(readFileSync(src('services', 'forumNotify.js'), 'utf8'));

// ── 1. reachability: the write paths must actually CALL notify ─────────────

test('createPost notifies the thread author — the answer path is WIRED', () => {
  const fn = WRITE.slice(WRITE.indexOf('export async function createPost'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.match(
    body, /notify\(/,
    'createPost does not call notify(). The notifications table would exist, the '
    + 'API would work, and NOBODY would ever be told their question was answered '
    + '— which is the entire point of WP1.',
  );
  assert.match(body, /kind:\s*['"]answer['"]/, "createPost must send kind 'answer'.");
});

test('acceptAnswer notifies the answer author — the accepted path is WIRED', () => {
  const fn = WRITE.slice(WRITE.indexOf('export async function acceptAnswer'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.match(
    body, /notify\(/,
    'acceptAnswer does not call notify(). "Your answer was accepted" is the only '
    + 'message this product sends that says the work was USED.',
  );
  assert.match(body, /kind:\s*['"]accepted['"]/, "acceptAnswer must send kind 'accepted'.");

  // ⚠️ This assertion is scoped to the notify() CALL, not the whole function.
  // The first version matched /answer_author/ anywhere in the body — which the
  // SELECT satisfies (`p.author_id AS answer_author`) no matter who the call
  // actually notifies. Mutating the recipient to post.thread_author left that
  // gate GREEN. Caught by mutation-checking; a gate that cannot fail is not
  // evidence.
  const call = body.slice(body.indexOf('notify('));
  const args = call.slice(0, call.indexOf('}'));
  assert.match(
    args, /userId:\s*post\.answer_author/,
    'acceptAnswer must notify the ANSWER author. Notifying post.thread_author '
    + 'instead is invisible in testing: the thread author is the one doing the '
    + 'accepting, so notify() suppresses it as a self-notification and the '
    + 'feature simply never fires.',
  );
});

test('the notifications can be READ back over HTTP', () => {
  assert.match(ROUTES, /router\.get\(\s*['"]\/notifications['"]/,
    'no GET /notifications — notifications would be written and unreadable.');
  assert.match(ROUTES, /router\.post\(\s*['"]\/notifications\/read['"]/,
    'no POST /notifications/read — the badge could never be cleared.');
});

// ── 2. the rules that make a notification system tolerable ─────────────────

/** A db stub that FAILS if touched — proves suppression happens before any query. */
const forbiddenDb = { query: () => { throw new Error('db must not be queried'); } };

test('you are never notified about your own action', async () => {
  // The single most important rule here. Self-notification is how a product
  // trains people to ignore the badge inside a day.
  const result = await notify(forbiddenDb, {
    userId: 'user-1', kind: 'answer', actor: { id: 'user-1', kind: 'human' },
  });
  assert.equal(result, null);
});

test('...and the check is cheap — it short-circuits BEFORE hitting the database', async () => {
  // If this ever regresses to querying first, every self-reply costs a round
  // trip to discover it should do nothing. forbiddenDb throwing would surface as
  // a rejected promise rather than null.
  await assert.doesNotReject(() => notify(forbiddenDb, {
    userId: 'u', kind: 'answer', actor: { id: 'u' },
  }));
});

test('a notification with no recipient is a no-op, not a crash', async () => {
  // Seeded/system threads have author_id IS NULL. Answering one must not throw.
  assert.equal(await notify(forbiddenDb, { userId: null, kind: 'answer' }), null);
});

test('re-accepting an answer cannot re-notify', () => {
  // Enforced by a partial unique index + ON CONFLICT DO NOTHING, not by a
  // read-then-write race. A notification you can farm is one people learn to
  // ignore.
  assert.match(NOTIFY, /ON CONFLICT DO NOTHING/,
    'notify() must swallow the unique-index conflict for kind=accepted.');
  const mig = readFileSync(
    src('database', 'migrations', '20260815120000-forum-notifications.sql'), 'utf8');
  assert.match(mig, /CREATE UNIQUE INDEX[\s\S]*?WHERE kind = 'accepted'/,
    'the once-only guarantee must be a DB constraint, not application politeness.');
});

// ── 3. the security property ───────────────────────────────────────────────

test('markRead is always scoped by user_id, never by id alone', () => {
  // Marking by id without the owner check lets anyone clear anyone's
  // notifications by guessing a uuid — and it would look like it worked.
  const fn = NOTIFY.slice(NOTIFY.indexOf('export async function markRead'));
  const updates = fn.match(/UPDATE forum_notifications[\s\S]*?(?=\[|`)/g) || [];
  assert.ok(updates.length >= 2, 'expected both the by-ids and the mark-all UPDATE');
  for (const u of updates) {
    assert.match(u, /WHERE[\s\S]*user_id = \$1/,
      `an UPDATE in markRead is not scoped to the caller:\n${u}`);
  }
});

test('markRead with an empty id list does nothing rather than marking all', async () => {
  // `ids = []` must NOT fall through to the mark-all branch. A UI that sends the
  // current selection would silently clear the entire inbox when nothing is
  // selected.
  assert.deepEqual(await markRead(forbiddenDb, 'user-1', []), { updated: 0 });
});

// ── 4. the read path shapes data the UI can actually render ────────────────

test('listNotifications joins the thread so the panel cannot N+1', () => {
  const fn = NOTIFY.slice(NOTIFY.indexOf('export async function listNotifications'));
  assert.match(fn, /LEFT JOIN forum_threads/,
    'the list must carry thread title + url, or every row costs another request.');
  assert.match(fn, /LIMIT \$2/, 'the list must be bounded.');
});

test('a deleted actor anonymises rather than deleting the notification', () => {
  const mig = readFileSync(
    src('database', 'migrations', '20260815120000-forum-notifications.sql'), 'utf8');
  assert.match(mig, /actor_id\s+UUID REFERENCES users\(id\) ON DELETE SET NULL/,
    'actor_id must be SET NULL: if the person who answered you deletes their '
    + 'account you must not silently lose the fact that you HAVE an answer. '
    + 'CASCADE here would delete history that is not theirs to take.');
  assert.match(mig, /user_id\s+UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    'user_id must CASCADE: deleting your account removes what you were owed.');
});

test('exports are actually named what the routes import', () => {
  // Cheap, but this is a live wire: forumRoutes.js does `import * as notify`
  // and calls notify.listNotifications / notify.unreadCount / notify.markRead.
  for (const fn of [notify, markRead, listNotifications, unreadCount]) {
    assert.equal(typeof fn, 'function');
  }
  for (const name of ['listNotifications', 'unreadCount', 'markRead']) {
    assert.match(ROUTES, new RegExp(`notify\\.${name}\\(`),
      `routes reference notify.${name} — keep the export name in step.`);
  }
});

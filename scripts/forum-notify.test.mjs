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

// ── 5. reply fan-out, and the way out of it ────────────────────────────────
//
// "Someone replied" is the notification that turns a forum into noise. It is
// only safe to ship alongside the mute, so these gates check both halves and
// the exclusion rule between them.

const MIGRATIONS = join(__dirname, '..', 'src', 'server', 'database', 'migrations');

test('posting subscribes you to the thread — both write paths', () => {
  for (const fnName of ['createThread', 'createPost']) {
    const fn = WRITE.slice(WRITE.indexOf(`export async function ${fnName}`));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    assert.match(body, /autoSubscribeThread\(/,
      `${fnName} does not subscribe the author to the thread. Without a row there `
      + 'is nothing for the mute toggle to write to, so "stop notifying me" has '
      + 'nothing to act on.');
  }
});

test('the auto-subscribe can never UN-MUTE an explicit mute', () => {
  // The single most annoying bug this feature can have: you mute a thread, post
  // in it once more, and it starts shouting at you again. ON CONFLICT DO NOTHING
  // is what prevents it — DO UPDATE would silently reset muted.
  const fn = WRITE.slice(WRITE.indexOf('export async function autoSubscribeThread'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.match(body, /ON CONFLICT[\s\S]*?DO NOTHING/,
    'autoSubscribeThread must DO NOTHING on conflict. DO UPDATE would un-mute '
    + 'someone who explicitly asked to stop.');
  assert.doesNotMatch(body, /DO UPDATE/,
    'DO UPDATE in the auto path defeats the mute.');
});

test('mute is a FLAG, not a deleted row', () => {
  const mig = readFileSync(join(MIGRATIONS, '20260815130000-forum-thread-subscriptions.sql'), 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE/,
    'deleting the row on unsubscribe means the next post silently re-subscribes '
    + 'you — the auto-subscribe cannot tell "never subscribed" from "asked to stop".');
  assert.match(mig, /CREATE UNIQUE INDEX[\s\S]*?user_id, thread_id/,
    'auto-subscribe is idempotent at the DB, not by a read-then-write race.');
});

test('the thread author never gets BOTH answer and reply for one post', () => {
  // They get the richer 'answer'. Excluded in SQL rather than deduped after, so
  // a long thread does not pull every subscriber into memory to discard them.
  const fn = WRITE.slice(WRITE.indexOf('export async function threadReplyRecipients'));
  assert.match(fn, /muted = FALSE/, 'muted subscribers must be filtered in SQL.');
  assert.match(fn, /user_id <> /, 'the actor and thread author must be excluded in SQL.');

  const post = WRITE.slice(WRITE.indexOf('export async function createPost'));
  const body = post.slice(0, post.indexOf('\nexport '));
  assert.match(body, /threadAuthorId:\s*thread\.author_id/,
    'createPost must pass the thread author so the fan-out excludes them.');
  assert.match(body, /exceptUserId:\s*user\.id/,
    'you must not be notified about your own post.');
});

test('the mute is REACHABLE over HTTP, in the same change as the fan-out', () => {
  assert.match(ROUTES, /router\.put\(\s*['"]\/threads\/:shortId\/subscription['"]/,
    'reply fan-out shipped without a way to turn it off. A forum you can only be '
    + 'added to is one people mute at the mail client — and after that, no '
    + 'notification from this product works again.');
  assert.match(ROUTES, /write\.setThreadSubscription/,
    'the route must call the service.');
});

// ── 6. the follow toggle's state, and the bug that nearly shipped ──────────

test('thread subscription is resolved by shortId, NOT by thread.id', () => {
  // 🔴 The obvious version was wrong. serializeThreadSummary deliberately
  // exposes only `shortId` — the citable public identifier (D9) — and never the
  // internal uuid. `thread.id` in that route is undefined, so the lookup matches
  // nothing and the follow button reads "not following" for EVERY user, forever,
  // while every test passes and no error is logged.
  const route = ROUTES.slice(ROUTES.indexOf("router.get('/threads/:shortId'"));
  const body = route.slice(0, route.indexOf('\nrouter.'));
  assert.match(body, /threadSubscriptionByShortId\(req\.db, req\.user\.id, shortId\)/,
    'the subscription lookup must use shortId. Using thread.id yields undefined '
    + 'and silently renders every thread as un-followed.');
  assert.doesNotMatch(body, /threadSubscription\(req\.db, req\.user\.id, thread\.id\)/,
    'thread.id does not exist on the serialized thread.');
});

test('the Record stays readable signed-out', () => {
  // §5.1 — the Record is public. Gating the thread route behind authMiddleware to
  // get the follow state would make every thread 401 for anonymous readers, which
  // is the whole archive.
  const route = ROUTES.slice(ROUTES.indexOf("router.get('/threads/:shortId'"));
  const decl = route.slice(0, route.indexOf('\n'));
  assert.match(decl, /optionalAuthMiddleware/,
    'the thread route must use optionalAuthMiddleware.');
  assert.doesNotMatch(decl, /[^l]authMiddleware,/,
    'authMiddleware here would 401 the public archive for signed-out readers.');
});

// ── 7. mentions — real behaviour, not source reading ───────────────────────
//
// parseMentions is pure, so unlike the rest of this file these are actual
// behavioural assertions. Each one is a bug someone ships.

const { parseMentions, MAX_MENTIONS } = await import('../src/server/services/forumWrite.js');

test('a plain mention is found', () => {
  assert.deepEqual(parseMentions('thanks @alice, that worked'), ['alice']);
});

test('EMAIL ADDRESSES are not mentions', () => {
  // "mail foo@example.com" contains @example. Getting this wrong pages a
  // stranger every time somebody pastes a support address.
  assert.deepEqual(parseMentions('mail foo@example.com for support'), []);
  assert.deepEqual(parseMentions('me@my.co and @alice'), ['alice']);
});

test('mentions inside CODE do not notify anyone', () => {
  // A shell snippet full of user@host, or a docs example using @tag, is
  // legitimate text everywhere else — no regex fixes this, the code has to be
  // stripped first.
  assert.deepEqual(parseMentions('```\nssh @alice\n```'), []);
  assert.deepEqual(parseMentions('~~~\n@alice\n~~~'), []);
  assert.deepEqual(parseMentions('use `@alice` as the flag'), []);
  assert.deepEqual(parseMentions('```\n@bob\n```\nbut @alice is real'), ['alice']);
});

test('the same person twice is one notification, case-insensitively', () => {
  assert.deepEqual(parseMentions('@alice @Alice @ALICE'), ['alice']);
});

test('one post cannot notify everybody', () => {
  const many = Array.from({ length: 40 }, (_, i) => `@user${i}`).join(' ');
  assert.equal(parseMentions(many).length, MAX_MENTIONS);
});

test('trailing punctuation is not part of the handle', () => {
  assert.deepEqual(parseMentions('cc @alice.'), ['alice']);
  assert.deepEqual(parseMentions('(@alice)'), ['alice']);
  assert.deepEqual(parseMentions('@alice, @bob!'), ['alice', 'bob']);
});

test('handles containing dots, dashes and underscores survive', () => {
  assert.deepEqual(parseMentions('@a.b @c-d @e_f'), ['a.b', 'c-d', 'e_f']);
});

test('an empty or absent body is not an error', () => {
  assert.deepEqual(parseMentions(''), []);
  assert.deepEqual(parseMentions(null), []);
  assert.deepEqual(parseMentions(undefined), []);
});

test('mentions are WIRED into both write paths', () => {
  for (const fnName of ['createThread', 'createPost']) {
    const fn = WRITE.slice(WRITE.indexOf(`export async function ${fnName}`));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    assert.match(body, /notifyMentions\(/,
      `${fnName} does not call notifyMentions — @handle would parse correctly and `
      + 'notify nobody.');
  }
});

test('being mentioned in a thread you follow is ONE notification, not two', () => {
  // The mention is the more specific of the pair, so it wins and the reply
  // fan-out excludes whoever it already reached.
  const fn = WRITE.slice(WRITE.indexOf('export async function createPost'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.match(body, /filter\(\(uid\) => !mentioned\.includes\(uid\)\)/,
    'the reply fan-out must exclude people the mention already notified.');
  assert.ok(body.indexOf('notifyMentions(') < body.indexOf('threadReplyRecipients('),
    'mentions must be resolved BEFORE the fan-out, or there is nothing to exclude.');
});

test('mention has a template — it is no longer skipped by the mailer', () => {
  const bridge = codeOnly(readFileSync(src('services', 'forumNotifyEmail.js'), 'utf8'));
  assert.match(bridge, /mention:\s*'forum_mention'/,
    'the bridge must map mention to its template.');
  const email = readFileSync(src('services', 'emailService.js'), 'utf8');
  assert.match(email, /forum_mention:\s*\(/,
    'forum_mention template missing — the bridge would map to a template that '
    + 'does not exist and sendEmail throws "Unknown email template".');
});

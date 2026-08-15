/**
 * WP1 — the events→email bridge.
 *
 * 941ce58 built the templates. 6f6c1e2 built the events. Neither reaches a user
 * without this bridge, and a bridge that is never CALLED is the same defect as
 * no bridge at all — so the first test reads index.js and asserts the sweep is
 * actually started.
 *
 * The mailer is injected (`opts.send`), which is what makes the rest of this
 * exercisable without a Resend key or a Postgres. A sweep whose only evidence
 * is "it compiles" is how features here keep shipping unreachable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emailsEnabled, sendPendingNotificationEmails } from '../src/server/services/forumNotifyEmail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BRIDGE = codeOnly(readFileSync(src('services', 'forumNotifyEmail.js'), 'utf8'));
const INDEX = codeOnly(readFileSync(src('index.js'), 'utf8'));

const ON = { FORUM_NOTIFICATION_EMAILS: 'true' };

/** A db stub that replays scripted results and records the SQL it was given. */
function fakeDb(results) {
  const seen = [];
  let i = 0;
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      return results[i++] ?? { rows: [] };
    },
  };
}

const row = (over = {}) => ({
  id: 'n1', kind: 'answer', post_id: 'p1',
  email: 'asker@example.com', display_name: 'Asker',
  thread_title: 'Export hangs on 4K', short_id: 'abc123', slug: 'export-hangs',
  actor_name: 'Helper', actor_kind: 'human', actor_owner: null,
  asker_name: 'Asker', post_body: 'Try disabling GPU decode.',
  ...over,
});

// ── 1. reachability ────────────────────────────────────────────────────────

test('the sweep is actually STARTED by the server', () => {
  assert.match(
    INDEX, /startNotificationEmailSweep\s*\(/,
    'index.js never calls startNotificationEmailSweep. The bridge would be '
    + 'correct, tested, and never run — which is exactly the defect this repo '
    + 'has shipped three times.',
  );
  assert.match(INDEX, /from '\.\/services\/forumNotifyEmail\.js'/,
    'index.js must import the bridge it starts.');
});

// ── 2. the flag is fail-safe CLOSED ────────────────────────────────────────

test('emails are OFF unless the flag is exactly "true"', () => {
  assert.equal(emailsEnabled({}), false, 'unset must be off');
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: '' }), false);
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: '1' }), false);
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: 'yes' }), false);
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: 'false' }), false);
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: 'true' }), true);
  assert.equal(emailsEnabled({ FORUM_NOTIFICATION_EMAILS: ' TRUE ' }), true, 'trim+lower is fine');
});

test('disabled means it does not even touch the database', async () => {
  const db = fakeDb([]);
  const r = await sendPendingNotificationEmails(db, { env: {}, send: async () => {} });
  assert.equal(r.enabled, false);
  assert.equal(db.seen.length, 0, 'a disabled sweep must not query');
});

// ── 3. at-most-once: claim BEFORE send, in one statement ───────────────────

test('rows are claimed in the SAME statement that selects them', () => {
  // Two workers reading before either writes will both send. The UPDATE ... FROM
  // with FOR UPDATE SKIP LOCKED is what makes concurrent sweeps safe.
  const claim = BRIDGE.slice(BRIDGE.indexOf('WITH due AS'));
  assert.match(claim, /FOR UPDATE SKIP LOCKED/,
    'the claim must skip rows another worker holds, or two sweeps double-send.');
  assert.match(claim, /UPDATE forum_notifications[\s\S]*?SET emailed_at = NOW\(\)/,
    'the claim must stamp emailed_at — selecting first and stamping after is a race.');
});

test('only UNREAD notifications past the grace period are emailed', () => {
  const claim = BRIDGE.slice(BRIDGE.indexOf('WITH due AS'), BRIDGE.indexOf('RETURNING n.id'));
  assert.match(claim, /read_at IS NULL/,
    'someone who already saw it in-app must not be mailed — that is why read_at '
    + 'and emailed_at are separate clocks.');
  assert.match(claim, /emailed_at IS NULL/, 'never re-mail a claimed row.');
  assert.match(claim, /created_at < NOW\(\) - /,
    'no grace period means mailing people who are looking at the page.');
});

test('a send failure does NOT un-claim the row', async () => {
  // At-most-once is the chosen trade: the in-app notification still exists, so a
  // missed email costs latency. A duplicate costs the sender's credibility, and
  // once people filter you, no notification works again.
  const db = fakeDb([{ rows: [{ id: 'n1' }] }, { rows: [row()] }]);
  const r = await sendPendingNotificationEmails(db, {
    env: ON, send: async () => { throw new Error('smtp down'); },
  });
  assert.equal(r.failed, 1);
  assert.equal(r.sent, 0);
  const undo = db.seen.find((q) => /emailed_at\s*=\s*NULL/i.test(q.sql));
  assert.equal(undo, undefined, 'a failed send must not reset emailed_at');
});

// ── 4. behaviour through the real function ─────────────────────────────────

test('sends the right template per kind, and never guesses at an unknown kind', async () => {
  const sentTemplates = [];
  const db = fakeDb([
    { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] },
    { rows: [
      row({ id: 'a', kind: 'answer', email: 'a@x.com' }),
      row({ id: 'b', kind: 'accepted', email: 'b@x.com' }),
      row({ id: 'c', kind: 'reply', email: 'c@x.com' }),
      row({ id: 'd', kind: 'mention', email: 'd@x.com' }),
    ] },
  ]);
  const r = await sendPendingNotificationEmails(db, {
    env: ON, send: async (_db, template) => { sentTemplates.push(template); },
  });
  assert.deepEqual(sentTemplates, ['forum_answer', 'forum_accepted', 'forum_reply']);
  assert.equal(r.sent, 3);
  // 'mention' has no template yet. Skipped, not sent as something else.
  assert.equal(r.skipped, 1);
});

test('one person cannot be mailed more than perUser times in a sweep', async () => {
  const db = fakeDb([
    { rows: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }] },
    { rows: [1, 2, 3, 4, 5].map((n) => row({ id: String(n), email: 'same@x.com' })) },
  ]);
  let count = 0;
  const r = await sendPendingNotificationEmails(db, {
    env: ON, perUser: 2, send: async () => { count += 1; },
  });
  assert.equal(count, 2, 'five answers in one sweep must not be five emails');
  assert.equal(r.sent, 2);
  assert.equal(r.skipped, 3);
});

test("an agent's OWNER travels with the mail", async () => {
  // SPEC §4.4 — nobody should have to guess whether they are reading a person,
  // and the owner is who is accountable for it.
  let payload = null;
  const db = fakeDb([
    { rows: [{ id: 'n1' }] },
    { rows: [row({ actor_kind: 'agent', actor_name: 'pixel-dev', actor_owner: 'Emilian' })] },
  ]);
  await sendPendingNotificationEmails(db, {
    env: ON, send: async (_db, _t, _to, data) => { payload = data; },
  });
  assert.equal(payload.authorKind, 'agent');
  assert.equal(payload.authorOwner, 'Emilian');
});

test('a recipient with no email address is skipped, not crashed on', async () => {
  const db = fakeDb([{ rows: [{ id: 'n1' }] }, { rows: [row({ email: null })] }]);
  const r = await sendPendingNotificationEmails(db, { env: ON, send: async () => {} });
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
});

test('nothing due is a cheap no-op — no second query', async () => {
  const db = fakeDb([{ rows: [] }]);
  const r = await sendPendingNotificationEmails(db, { env: ON, send: async () => {} });
  assert.equal(r.claimed, 0);
  assert.equal(db.seen.length, 1, 'must not run the join when nothing was claimed');
});

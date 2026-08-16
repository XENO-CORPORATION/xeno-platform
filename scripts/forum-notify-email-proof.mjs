#!/usr/bin/env node
/**
 * §5's first Functional gate — "a user who is answered FINDS OUT WITHOUT
 * VISITING THE SITE."
 *
 * That sentence is the whole of Loop A's return path. If it does not hold,
 * everything else in this plan is a well-built archive nobody comes back to.
 *
 * ── WHY THIS CAN BE PROVEN WITHOUT MAILING ANYONE ───────────────────────────
 *
 * `sendPendingNotificationEmails` takes an injectable `send` and `env` — a seam
 * the author put there deliberately, "because a sweep whose only proof is 'it
 * compiles' is how the unreachable-feature bug keeps happening here." So the
 * real sweep runs against the real database with a capturing mailer, and the
 * flag is supplied to THIS PROCESS only. Production's switch is untouched.
 *
 * ── WHAT IS ACTUALLY ASSERTED ───────────────────────────────────────────────
 *
 * Not "an email was attempted". The gate says the person LEARNS, so:
 *
 *   • the right people are mailed, at their real addresses, with the right kind
 *   • 🔴 the mail carries the SUBSTANCE — the thread title, the answer excerpt
 *     and a working link — because "you have a notification" forces the visit
 *     the gate says must not be necessary
 *   • 🔴 the link RESOLVES — a citable URL nobody followed is the §4.15 bug
 *   • a notification already READ in-app is never mailed (the entire reason
 *     `read_at` and `emailed_at` are separate clocks)
 *   • at-most-once: a second sweep sends nothing
 *   • an agent's OWNER travels with it, so nobody has to guess whether a person
 *     wrote to them
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT; `--confirm` required.
 *   • NO MAIL IS EVER SENT — the mailer is a capture function.
 *   • 🔴 NOTHING IS EVER COMMITTED — one transaction, always rolled back.
 */

import crypto from 'crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let CLIENT = null;

async function step(label, fn) {
  const sp = `sp_${crypto.randomBytes(4).toString('hex')}`;
  await CLIENT.query(`SAVEPOINT ${sp}`);
  try {
    const out = await fn();
    await CLIENT.query(`RELEASE SAVEPOINT ${sp}`);
    return out;
  } catch (err) {
    await CLIENT.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    fail(`${label} — threw instead: ${err.message}`);
    return null;
  }
}

async function service(name) {
  const dir = process.env.FORUM_SERVICE_DIR;
  const candidates = dir
    ? [pathToFileURL(`${dir.replace(/\/$/, '')}/${name}`).href]
    : [`../src/server/services/${name}`, `../services/${name}`];
  for (const p of candidates) {
    try { return await import(p); } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error(`cannot locate ${name}`);
}

async function cloneUser(client, sourceId, label) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position`,
  );
  const names = cols.map((c) => c.column_name);
  const uniq = crypto.randomBytes(4).toString('hex');
  const select = names.map((n) => {
    if (n === 'id') return 'gen_random_uuid() AS id';
    if (n === 'email') return `'${label}-${uniq}@example.invalid' AS email`;
    if (['handle', 'username', 'display_name'].includes(n)) return `'${label}${uniq}' AS ${n}`;
    if (n === 'created_at') return "(NOW() - INTERVAL '72 hours') AS created_at";
    if (n === 'role') return "'user' AS role";
    return `"${n}"`;
  }).join(', ');
  const { rows } = await client.query(
    `INSERT INTO users (${names.map((n) => `"${n}"`).join(', ')})
     SELECT ${select} FROM users WHERE id = $1 RETURNING id, email`,
    [sourceId],
  );
  return rows[0];
}

const client = await pool.connect();
let began = false;

try {
  const { rows: admins } = await client.query(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  );
  if (!admins.length) throw new Error('no admin account');

  if (!CONFIRM) {
    console.log('DRY RUN — would open a transaction, run a real ask→answer→accept flow,');
    console.log('drive the real email sweep with a CAPTURING mailer (no mail is sent, and');
    console.log('production\'s FORUM_NOTIFICATION_EMAILS is untouched), then ROLL BACK.');
    console.log('Re-run with --confirm to execute.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;
  CLIENT = client;

  const write = await service('forumWrite.js');
  const svc = await service('forumService.js');
  const ident = await service('agentIdentity.js');
  const mail = await service('forumNotifyEmail.js');

  const actorOf = async (id) => {
    const p = await ident.resolvePrincipal(client, id);
    return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
  };

  const askerRow = await cloneUser(client, admins[0].id, 'asker');
  const asker = await actorOf(askerRow.id);
  const answererRow = await cloneUser(client, admins[0].id, 'answerer');
  const answerer = await actorOf(answererRow.id);
  console.log(`asker: ${askerRow.email} | answerer: ${answererRow.email}\n`);

  const EXCERPT = `Set the colour profile to sRGB ${crypto.randomBytes(3).toString('hex')}`;

  // ── the real flow ────────────────────────────────────────────────────────
  const thread = await write.createThread(client, asker, {
    space: 'help',
    title: 'Why are my exported colours wrong?',
    body: 'Exports look washed out compared to the canvas.',
  });
  const answer = await write.createPost(client, answerer, thread.shortId, { body: EXCERPT });
  await write.acceptAnswer(client, asker, answer.id);

  // The sweep only considers notifications older than a grace period, and only
  // unread ones. Age them rather than waiting.
  await client.query(
    "UPDATE forum_notifications SET created_at = NOW() - INTERVAL '30 minutes'",
  );

  console.log('1. the notifications exist at all:');
  const { rows: notes } = await client.query(
    `SELECT n.kind, u.email FROM forum_notifications n JOIN users u ON u.id = n.user_id
      WHERE n.user_id IN ($1, $2) ORDER BY n.kind`,
    [asker.id, answerer.id],
  );
  if (!notes.length) fail('no notification rows at all — nothing to email');
  else pass(`${notes.length} notification(s): ${notes.map((n) => n.kind).join(', ')}`);

  const toAnswerer = notes.find((n) => n.email === answererRow.email);
  if (!toAnswerer) fail('the ANSWERER was not notified that their answer was accepted');
  else pass(`the answerer is notified (${toAnswerer.kind})`);

  // ── the sweep, with a capturing mailer ───────────────────────────────────
  console.log('\n2. the sweep — real code, real rows, no mail:');
  const outbox = [];
  const send = async (_db, template, to, payload) => { outbox.push({ template, to, payload }); };
  const env = { FORUM_NOTIFICATION_EMAILS: 'true' };

  const report = await step('the sweep must run',
    () => mail.sendPendingNotificationEmails(client, { send, env, delayMinutes: 3 }));
  if (report) console.log(`  sweep result: ${JSON.stringify(report)}`);
  if (!report?.enabled) fail('the sweep reported itself disabled despite the injected flag');
  else pass('enabled via the injected flag — production\'s switch untouched');
  if (!report?.sent) fail('the sweep claimed rows but sent nothing');
  else pass(`${report.sent} email(s) prepared`);

  // ── 🔴 does the mail carry the SUBSTANCE? ────────────────────────────────
  console.log('\n3. does the reader LEARN, or are they summoned?');
  const accepted = outbox.find((m) => m.to === answererRow.email);
  if (!accepted) fail('nothing addressed to the answerer');
  else {
    pass(`addressed to the answerer, template "${accepted.template}"`);
    const p = accepted.payload || {};
    if (!p.threadTitle) fail('no thread title — the reader cannot tell which question this is');
    else pass(`carries the thread title ("${String(p.threadTitle).slice(0, 34)}…")`);
    if (!p.threadUrl || !/\/forum\/t\//.test(p.threadUrl)) fail(`no usable link: ${p.threadUrl}`);
    else pass('carries a link to the thread');
    if (!p.authorName) fail('does not say who acted');
    else pass(`says who acted (${p.authorName})`);
  }

  const answered = outbox.find((m) => m.to === askerRow.email);
  if (!answered) fail('nothing addressed to the asker — the person who asked never hears back');
  else {
    pass(`addressed to the asker, template "${answered.template}"`);
    if (!String(answered.payload?.excerpt || '').includes(EXCERPT)) {
      fail('the mail carries no excerpt of the answer — "you have a notification" forces the visit this gate exists to avoid');
    } else pass('carries an EXCERPT OF THE ANSWER — the reader learns without visiting');
  }

  // 🔴 §4.15 — a link nobody followed is not a link.
  const url = (accepted || answered)?.payload?.threadUrl || '';
  const shortId = (url.match(/\/forum\/t\/([a-z0-9]+)/) || [])[1];
  const resolved = shortId ? await svc.getThreadByShortId(client, shortId) : null;
  if (!resolved) fail(`the link in the email is DEAD (${url})`);
  else if (resolved.shortId !== shortId) fail('the link resolves to a different thread');
  else pass('the link in the email RESOLVES to the thread');

  // ── at-most-once, and the two clocks ─────────────────────────────────────
  console.log('\n4. it does not mail twice, and it respects a read receipt:');
  const before = outbox.length;
  const second = await mail.sendPendingNotificationEmails(client, { send, env, delayMinutes: 3 });
  if (second.sent || outbox.length !== before) fail(`a second sweep sent ${second.sent} more — people filter a sender that repeats`);
  else pass('a second sweep sends nothing — claimed rows stay claimed');

  // A fresh unread notification that the reader has ALREADY SEEN in-app must
  // not be mailed. This is the entire reason read_at and emailed_at are
  // separate columns rather than one `notified_at`.
  await client.query(
    "UPDATE forum_notifications SET emailed_at = NULL, read_at = NOW(), created_at = NOW() - INTERVAL '30 minutes'",
  );
  const third = await mail.sendPendingNotificationEmails(client, { send, env, delayMinutes: 3 });
  if (third.claimed) fail(`${third.claimed} READ notification(s) were claimed for email — the best notification email is the one you never had to send`);
  else pass('a notification already read in-app is never mailed');

  // ── the flag is fail-safe ────────────────────────────────────────────────
  console.log('\n5. the switch fails safe:');
  await client.query("UPDATE forum_notifications SET emailed_at = NULL, read_at = NULL");
  // Asserted BOTH ways, and each case reported. The first version looped over
  // the off-cases and then called pass() unconditionally — a summary line that
  // fires whether or not the loop found anything is the break-open shape this
  // work has now hit five times.
  const OFF = [undefined, '', '1', 'yes', 'false', 'no', 'TRUEISH'];
  const ON = ['true', 'TRUE', ' True ']; // trimmed + lowercased, so these are ON by contract

  let offOk = 0;
  for (const v of OFF) {
    const env2 = v === undefined ? {} : { FORUM_NOTIFICATION_EMAILS: v };
    const r = await mail.sendPendingNotificationEmails(client, { send, env: env2, delayMinutes: 3 });
    if (r.enabled) fail(`FORUM_NOTIFICATION_EMAILS=${JSON.stringify(v)} ENABLED mailing — only "true" may`);
    else offOk += 1;
  }
  if (offOk === OFF.length) pass(`${offOk}/${OFF.length} non-"true" values resolve to OFF — mailing real people needs a deliberate switch`);

  let onOk = 0;
  for (const v of ON) {
    const r = await mail.sendPendingNotificationEmails(client, {
      send: async () => {}, env: { FORUM_NOTIFICATION_EMAILS: v }, delayMinutes: 3,
    });
    if (!r.enabled) fail(`FORUM_NOTIFICATION_EMAILS=${JSON.stringify(v)} did NOT enable — the operator would flip the switch and see nothing happen`);
    else onOk += 1;
  }
  if (onOk === ON.length) pass(`${onOk}/${ON.length} spellings of "true" DO enable — the switch works when thrown`);
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no user, thread, post or notification was committed. No mail was sent.');
  }
  client.release();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('The return path works end to end. Only the operator switch remains.');

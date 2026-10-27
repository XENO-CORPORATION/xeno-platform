#!/usr/bin/env node
/**
 * Account erasure reaches PRIVATE REPORTS — not only Forum posts and threads.
 *
 * A private report is a ticket (XENO REPORT R2/R4), and a report carries more personal data than a post: a body, the OS
 * string, diagnostics folded into the body, and evidence bytes (screenshots, recordings). `eraseSubject` tombstones the
 * users row instead of deleting it, so the `ON DELETE` rules on the ticket and report tables never fire: until
 * `eraseForumContent` learned about them, every one of those rows outlived the erasure.
 *
 * What this proves, on real Postgres with the tables built from the real forum migrations:
 *   - the subject's ticket keeps its shell (product, status) and loses title, body and OS;
 *   - the subject's evidence bytes and submission receipts are gone;
 *   - the subject's reply on SOMEONE ELSE'S ticket is blanked, and that ticket is untouched;
 *   - a staff reply on the subject's ticket, and a bystander's own ticket, evidence and receipt, all SURVIVE;
 *   - the marker phrase is found nowhere in the four tables afterwards (findability, not a flag).
 *
 * SAFETY: one transaction, ALWAYS rolled back. The tables are created in a private schema inside it, so this runs safely
 * against any database, including a throwaway one. Dry run unless --confirm.
 *
 *   TEST_DATABASE_URL=postgres://… node scripts/report-erasure-proof.mjs --confirm
 */
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { eraseForumContent } from '../src/server/services/forumWrite.js';

const MIGRATIONS = 'src/server/database/migrations';
const MARK = `zqx${crypto.randomBytes(4).toString('hex')}`;
let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

if (!process.argv.includes('--confirm')) {
  console.log('DRY RUN: would open one transaction, build the forum tables from their migrations in a private schema,');
  console.log('file reports for a subject and a bystander, erase the subject, check both halves, and ROLL BACK.');
  process.exit(0);
}
if (!process.env.TEST_DATABASE_URL) { console.error('Set TEST_DATABASE_URL.'); process.exit(2); }

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const schema = `report_erasure_${crypto.randomBytes(4).toString('hex')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema}, public`);
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public').catch(() => {});
  await client.query(`CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT, display_name TEXT, role TEXT DEFAULT 'user')`);
  // Every forum migration, in order, UP half only: the same SQL production ran.
  for (const f of readdirSync(MIGRATIONS).filter((n) => /forum/.test(n) && n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').split(/^-- DOWN\b/m)[0];
    await client.query(sql);
  }

  const user = async (name) => (await client.query('INSERT INTO users (username) VALUES ($1) RETURNING id', [name])).rows[0].id;
  const subject = await user('subject'), bystander = await user('bystander'), staff = await user('staff');
  const ticket = async (reporter, short, words) => (await client.query(
    `INSERT INTO forum_tickets (short_id, reporter_id, product, kind, title, body, os)
     VALUES ($1, $2, 'spawn', 'bug', $3, $4, $5) RETURNING id`,
    [short, reporter, `Title ${words}`, `Body ${words} with recent diagnostics`, `win32 ${words}`])).rows[0].id;
  const reply = (t, author, kind, body) => client.query(
    'INSERT INTO forum_ticket_posts (ticket_id, author_id, author_kind, body) VALUES ($1, $2, $3, $4) RETURNING id', [t, author, kind, body]);
  const evidence = (reporter, t, bytes) => client.query(
    `INSERT INTO forum_report_evidence (id, reporter_id, ticket_id, name, content_type, size_bytes, sha256, content)
     VALUES (gen_random_uuid(), $1, $2, 'shot.png', 'image/png', $3, $4, $5)`,
    [reporter, t, bytes.length, crypto.createHash('sha256').update(bytes).digest('hex'), bytes]);
  const receipt = (reporter, short) => client.query(
    `INSERT INTO forum_report_submissions (reporter_id, submission_id, request_hash, receipt) VALUES ($1, gen_random_uuid(), $2, $3)`,
    [reporter, 'h', JSON.stringify({ shortId: short, private: true })]);

  const mine = await ticket(subject, 'sub1', MARK);
  const theirs = await ticket(bystander, 'oth1', 'bystander report');
  const staffReply = (await reply(mine, staff, 'human', 'Staff: thanks, looking into it')).rows[0].id;
  const myReplyElsewhere = (await reply(theirs, subject, 'human', `Me too, ${MARK}`)).rows[0].id;
  await evidence(subject, mine, Buffer.from(`png bytes ${MARK}`));
  await evidence(bystander, theirs, Buffer.from('bystander png bytes'));
  await receipt(subject, 'sub1'); await receipt(bystander, 'oth1');

  const result = await eraseForumContent(client, subject);
  console.log(`erased: ${JSON.stringify(result)}\n`);

  const one = async (sql, args) => (await client.query(sql, args)).rows[0];
  const t1 = await one('SELECT title, body, os, product, status FROM forum_tickets WHERE id = $1', [mine]);
  if (!t1) fail('the subject\'s ticket was deleted; its shell (and the staff replies on it) should remain');
  else {
    if (t1.title !== '[removed]' || t1.body !== '' || t1.os !== null) fail(`the subject's ticket still carries their words: ${JSON.stringify(t1)}`);
    else pass('the subject\'s ticket lost its title, body and OS');
    if (t1.product === 'spawn' && t1.status === 'open') pass('and kept its product and status (a shell, not a hole)');
    else fail('the ticket shell changed beyond the subject\'s words');
  }
  const sr = await one('SELECT body FROM forum_ticket_posts WHERE id = $1', [staffReply]);
  if (sr?.body === 'Staff: thanks, looking into it') pass('a staff reply on their ticket survives (third-party words)');
  else fail(`the staff reply was changed: ${JSON.stringify(sr)}`);
  const mr = await one('SELECT body FROM forum_ticket_posts WHERE id = $1', [myReplyElsewhere]);
  if (mr?.body === '[removed]') pass('the subject\'s reply on someone else\'s ticket is blanked');
  else fail(`the subject's reply elsewhere survived: ${JSON.stringify(mr)}`);
  const t2 = await one('SELECT title, body, os FROM forum_tickets WHERE id = $1', [theirs]);
  if (t2?.title === 'Title bystander report' && t2.body.includes('bystander report') && t2.os) pass('the bystander\'s ticket is untouched');
  else fail(`the bystander's ticket was changed: ${JSON.stringify(t2)}`);
  const ev = await one('SELECT count(*) FILTER (WHERE reporter_id = $1)::int AS mine, count(*) FILTER (WHERE reporter_id = $2)::int AS theirs FROM forum_report_evidence', [subject, bystander]);
  if (ev.mine === 0) pass('the subject\'s evidence bytes are deleted'); else fail(`${ev.mine} evidence rows of the subject survived`);
  if (ev.theirs === 1) pass('the bystander\'s evidence survives'); else fail('the bystander\'s evidence was deleted');
  const rc = await one('SELECT count(*) FILTER (WHERE reporter_id = $1)::int AS mine, count(*) FILTER (WHERE reporter_id = $2)::int AS theirs FROM forum_report_submissions', [subject, bystander]);
  if (rc.mine === 0) pass('the subject\'s submission receipts are deleted'); else fail(`${rc.mine} receipts of the subject survived`);
  if (rc.theirs === 1) pass('the bystander\'s receipt survives'); else fail('the bystander\'s receipt was deleted');
  // Findability: the marker must be nowhere in the four tables, in any text, JSON or bytes column.
  const found = await one(`SELECT
      (SELECT count(*) FROM forum_tickets t WHERE t::text LIKE '%' || $1 || '%')
    + (SELECT count(*) FROM forum_ticket_posts p WHERE p::text LIKE '%' || $1 || '%')
    + (SELECT count(*) FROM forum_report_submissions s WHERE s::text LIKE '%' || $1 || '%')
    + (SELECT count(*) FROM forum_report_evidence e WHERE position(convert_to($1, 'UTF8') in e.content) > 0) AS n`, [MARK]);
  if (Number(found.n) === 0) pass(`the marker "${MARK}" is found nowhere in tickets, replies, receipts or evidence`);
  else fail(`the marker survives in ${found.n} row(s)`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  console.log('\nROLLED BACK — nothing was committed.');
  client.release();
  await pool.end();
}
if (failures) { console.log(`${failures} check(s) failed.`); process.exit(1); }
console.log('A private report is erased with its reporter; other people\'s words and reports remain.');

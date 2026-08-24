/**
 * EVERY STATUS THE CODE WRITES MUST BE A STATUS THE SCHEMA ALLOWS.
 *
 * This gate exists because the two drifted, and the drift was invisible in a
 * specific and expensive way.
 *
 * `emailService.js` has a deliberate branch for "no email provider configured":
 * the message goes to the console and nowhere else, and the row is marked
 * 'skipped'. That branch was added because the code previously fell through to
 * 'sent', so `email_logs` recorded a successful delivery for a message nobody
 * received — an operator checking whether email worked would have concluded it
 * did.
 *
 * 🔴 The fix landed the semantic and not the constraint. 'skipped' was not in
 * the CHECK, so the UPDATE threw, the outer catch marked the row 'failed', and
 * the recorded error was the constraint violation itself. So the honest branch
 * produced a row saying "check constraint violated" — an operator asking "does
 * email work?" was told about database internals instead of the real answer,
 * which was that no API key is set. The caller's { skipped: true } contract
 * never fired either, because the throw happened first.
 *
 * Both sides are DERIVED here. Restating either list is how this recurs: the
 * next status someone adds would pass a hand-written test and fail in Postgres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'src/server/database/migrations';
const service = readFileSync('src/server/services/emailService.js', 'utf8');

/** Every status literal the service writes into email_logs. */
function statusesWritten(src) {
  const found = new Set();
  const marker = 'UPDATE email_logs SET status = $1';
  let i = src.indexOf(marker);
  while (i > -1) {
    /* The parameter array follows the SQL string; take the first quoted literal
     * in it, which is what binds to $1. */
    const tail = src.slice(i, i + 400);
    const arr = tail.indexOf('[');
    if (arr > -1) {
      const m = tail.slice(arr).match(/^\[\s*'([a-z_]+)'/);
      if (m) found.add(m[1]);
    }
    i = src.indexOf(marker, i + 1);
  }
  return found;
}

/**
 * Every email_logs status CHECK found, in migration order: [file, Set].
 *
 * ⚠️ Scoped to the email_logs DEFINITION, not to the file. The first version
 * matched every `CHECK (status IN …)` in any file that mentioned email_logs, and
 * 20260318000001-infrastructure-tables.sql creates SEVERAL tables — so it read
 * another table's status vocabulary and reported 'sent' as forbidden. Reading a
 * pattern that happens to match is not the same as reading the rule.
 */
function allChecks() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const out = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');

    /* The CREATE TABLE email_logs (...) block, up to its closing ");". */
    const create = sql.match(/CREATE TABLE[^;]*?email_logs\s*\(([\s\S]*?)\n\);/);
    if (create) {
      const m = create[1].match(/CHECK\s*\(status IN \(([^)]*)\)\)/);
      if (m) out.push([f, new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))]);
    }

    /* ALTER TABLE email_logs ... CHECK (status IN (...)) */
    for (const alter of sql.matchAll(/ALTER TABLE\s+email_logs[\s\S]*?CHECK\s*\(status IN \(([^)]*)\)\)/g)) {
      out.push([f, new Set([...alter[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))]);
    }
  }
  return out;
}

/** The CHECK actually in force: the LAST definition wins, as in Postgres. */
function statusesAllowed() {
  const all = allChecks();
  return all.length ? all[all.length - 1][1] : null;
}

test('the migrations still define an email_logs status CHECK', () => {
  const allowed = statusesAllowed();
  assert.ok(allowed && allowed.size > 0,
    'no email_logs status CHECK found — this gate is no longer measuring anything');
  assert.ok(allowed.has('sent') && allowed.has('failed'),
    'the CHECK lost a status the service certainly writes');
});

test('the service writes statuses, and this gate can see them', () => {
  const written = statusesWritten(service);
  assert.ok(written.size >= 2,
    `only found ${written.size} status write(s) in emailService.js — the extraction broke, so this gate would pass on anything`);
});

test('every status the service writes is permitted by the schema', () => {
  /* The actual defect. 'skipped' was written by code and rejected by Postgres,
   * which turned the honest no-provider branch into a database error. */
  const allowed = statusesAllowed();
  const written = statusesWritten(service);
  const rejected = [...written].filter((s) => !allowed.has(s));
  assert.deepEqual(rejected, [],
    `emailService writes ${rejected.map((s) => `'${s}'`).join(', ')} which the email_logs CHECK forbids — `
    + 'that UPDATE throws, the catch rewrites the row as failed, and the recorded error is the constraint itself');
});

test('no migration defines a CHECK that forbids a status the code writes', () => {
  /* statusesAllowed() takes the LAST definition, which is the effective one —
   * correct, and it made a regression in the BASE schema invisible. The base
   * file is what a person reads to learn the table's shape, so a base that
   * contradicts the live constraint is a documentation lie even when the
   * migration order saves it at runtime. */
  const written = statusesWritten(service);
  for (const [file, allowed] of allChecks()) {
    const rejected = [...written].filter((st) => !allowed.has(st));
    assert.deepEqual(rejected, [],
      `${file} defines an email_logs CHECK forbidding ${rejected.map((x) => `'${x}'`).join(', ')}, which the service writes`);
  }
});

test('an EXISTING database is brought forward, not just a fresh one', () => {
  /* The gap a file-only gate cannot otherwise see. The base schema is
   * `CREATE TABLE IF NOT EXISTS`, so on a database that already exists it does
   * nothing at all — editing it fixes new installs and leaves production exactly
   * as broken as before. Only an ALTER moves an existing database.
   *
   * Deleting the forward migration therefore left every check in this file green
   * while re-breaking the live constraint. So assert the ALTER exists, not merely
   * that some CHECK somewhere permits the value. */
  const files = readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort();
  const forward = files.some((x) => {
    const sql = readFileSync(join(MIGRATIONS, x), 'utf8');
    const m = sql.match(/ALTER TABLE\s+email_logs[\s\S]*?CHECK\s*\(status IN \(([^)]*)\)\)/);
    return m ? m[1].includes("'skipped'") : false;
  });
  assert.ok(forward,
    'no ALTER TABLE brings an existing email_logs forward — the base schema is CREATE TABLE IF NOT EXISTS, '
    + 'so production keeps the old CHECK and the no-provider branch keeps throwing');
});

test("'skipped' stays DISTINCT from 'failed'", () => {
  /* Collapsing them would make "how many emails failed" meaningless for any
   * period where the provider was simply switched off — a configuration state
   * read as a delivery fault. */
  const allowed = statusesAllowed();
  assert.ok(allowed.has('skipped') && allowed.has('failed'),
    'skipped and failed must both exist in the schema — a no-op is not a failure');
  /* ⚠️ And the CODE must still USE it. Asserting only the schema left the gate
   * green with the no-provider branch collapsed back into 'failed', which is
   * the exact conflation this row exists to prevent. */
  assert.ok(statusesWritten(service).has('skipped'),
    'the no-provider branch no longer records skipped — a configuration state is being reported as a delivery failure');
  assert.ok(service.includes("'no email provider configured'"),
    'the no-provider branch no longer records WHY it skipped');
});

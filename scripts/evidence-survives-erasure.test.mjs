/**
 * EVIDENCE MUST OUTLIVE THE ACCOUNT IT BELONGS TO.
 *
 * `dataRetention.js` refuses to prune `checkout_consents` because it is the
 * proof a customer waived their statutory withdrawal right. A foreign key
 * defeated that entirely: `ON DELETE CASCADE`, on a table whose delete is
 * SELF-SERVICE — `DELETE /api/auth/account`, gated only by the customer's own
 * password.
 *
 *     buy  →  download  →  delete account  →  dispute the charge
 *
 * The retention policy was honoured by the sweeper and silently defeated by the
 * schema. The same delete erased the audit of which binaries that account took.
 *
 * 🔴 The generalisable half: a policy enforced in ONE place is not enforced.
 * These gates therefore assert the property from both ends — the schema cannot
 * cascade, AND the surviving row can still identify its subject. A row that
 * survives but proves nothing is retention without a purpose, which is its own
 * violation rather than a fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'evidence-test-key';

const { subjectHash, subjectHashCandidates, subjectHashForUser } =
  await import('../src/server/services/subjectHash.js');
const { describeRetention, POLICIES } =
  await import('../src/server/services/dataRetention.js');

const read = (f) => readFileSync(f, 'utf8');
const mig = read('src/server/database/migrations/20260824200000-evidence-survives-erasure.sql');
const consent = read('src/server/services/checkoutConsent.js');
const route = read('src/server/routes/productDownloadRoutes.js');
const auth = read('src/server/routes/authRoutes.js');

/* ── 1 · The defect cannot come back ─────────────────────────────────────── */

test('🔴 account deletion no longer destroys consent evidence', () => {
  /* The exact defect. Both halves are required: SET NULL alone fails if the
   * column is still NOT NULL — the delete would ERROR rather than anonymise, so
   * account deletion would break outright and look like an unrelated bug. */
  assert.ok(/checkout_consents\s+ALTER COLUMN user_id DROP NOT NULL/.test(mig),
    'user_id is still NOT NULL — ON DELETE SET NULL would error, breaking account deletion');
  const block = mig.slice(mig.indexOf('ALTER TABLE checkout_consents\n  ADD CONSTRAINT'));
  assert.ok(/REFERENCES users\(id\) ON DELETE SET NULL/.test(block.slice(0, 200)),
    'the consent FK no longer sets null on delete');
});

test('🔴 account deletion no longer destroys the download audit', () => {
  assert.ok(/download_grants\s+ALTER COLUMN user_id DROP NOT NULL/.test(mig),
    'download_grants.user_id is still NOT NULL');
  const block = mig.slice(mig.indexOf('ALTER TABLE download_grants\n  ADD CONSTRAINT'));
  assert.ok(/REFERENCES users\(id\) ON DELETE SET NULL/.test(block.slice(0, 200)),
    'the grant FK no longer sets null on delete');
});

test('no CASCADE to users survives anywhere in the evidence migration', () => {
  /* A blunt second check on the same property. The two above name their table
   * and could both be satisfied while a third statement re-adds a cascade. */
  assert.ok(!/REFERENCES users\(id\) ON DELETE CASCADE/.test(mig),
    'something in the evidence migration still cascades from users');
});

test('the deletion path is still the self-service one this guards against', () => {
  /* If account deletion ever stops being a hard DELETE — a soft-delete, say —
   * this whole design should be revisited rather than left in place unread.
   * That is worth being told about, so assert the premise. */
  assert.ok(/DELETE FROM users WHERE id = \$1/.test(auth),
    'account deletion is no longer a hard DELETE — re-derive whether SET NULL is still the right shape');
});

/* ── 2 · A surviving row must still identify its subject ─────────────────── */

test('🔴 the handle is written at record time, not at deletion time', () => {
  /* Derived on deletion it would be too late: the email is gone by then, in the
   * same statement. It has to already be on the row. */
  const fn = consent.slice(consent.indexOf('export async function recordConsent('),
    consent.indexOf('export async function findUsableConsent('));
  assert.ok(fn.includes('await subjectHashForUser(pool, userId)'),
    'recordConsent does not derive a subject handle — a deleted account leaves anonymous evidence');
  assert.ok(/INSERT INTO checkout_consents[\s\S]{0,400}subject_hash/.test(fn),
    'the handle is derived and then not stored');

  const audit = route.slice(route.indexOf('async function auditGrant('));
  assert.ok(audit.slice(0, 1200).includes('await subjectHashForUser(req.db, userId)'),
    'auditGrant does not derive a subject handle');
  assert.ok(/INSERT INTO download_grants[\s\S]{0,400}subject_hash/.test(audit.slice(0, 1200)),
    'the grant audit derives a handle and does not store it');
});

test('deriving the handle can never refuse a purchase or a download', async () => {
  /* It is evidence enrichment, not a gate. A database hiccup while reading an
   * email must not fail a checkout that is otherwise fine. */
  const exploding = { async query() { throw new Error('db down'); } };
  assert.equal(await subjectHashForUser(exploding, 'u1'), null);

  const empty = { async query() { return { rows: [] }; } };
  assert.equal(await subjectHashForUser(empty, 'missing-user'), null);
});

/* ── 3 · The handle is a pseudonym, not a disguise ───────────────────────── */

test('🔴 the digest is KEYED — an unkeyed hash of an email is not a pseudonym', () => {
  /* Email addresses are low-entropy and enumerable, so a plain SHA-256 of one
   * is reversible by dictionary in seconds. The key is the entire difference
   * between a pseudonym and a lookup table. */
  const svc = read('src/server/services/subjectHash.js');
  assert.ok(/createHmac\('sha256'/.test(svc), 'the digest is no longer keyed');
  assert.ok(!/createHash\('sha256'\)[\s\S]{0,120}email/i.test(svc),
    'an unkeyed digest of an email appeared — that is reversible by dictionary');

  /* Behavioural: the same address under two keys must not collide. */
  const before = process.env.SUBJECT_HASH_SECRET;
  try {
    process.env.SUBJECT_HASH_SECRET = 'key-a';
    const a = subjectHash('person@example.com');
    process.env.SUBJECT_HASH_SECRET = 'key-b';
    const b = subjectHash('person@example.com');
    assert.notEqual(a, b, 'the digest does not depend on the key — it is not keyed at all');
  } finally {
    if (before === undefined) delete process.env.SUBJECT_HASH_SECRET;
    else process.env.SUBJECT_HASH_SECRET = before;
  }
});

test('normalisation is case- and whitespace-only, never provider-specific', () => {
  /* 🔴 Gmail-style dot/plus folding is a guess about ONE provider's routing
   * rules, and a wrong guess collapses two different people onto one handle —
   * which would make us produce the wrong person's consent record in a dispute.
   * The failure is silent and legally material. */
  assert.equal(subjectHash('  Person@Example.COM '), subjectHash('person@example.com'));
  assert.notEqual(subjectHash('p.erson@gmail.com'), subjectHash('person@gmail.com'),
    'dots are being folded — two different people now share one handle');
  assert.notEqual(subjectHash('person+tag@gmail.com'), subjectHash('person@gmail.com'),
    'plus-tags are being folded — two different people now share one handle');
});

test('an empty address yields NO handle, not a handle of nothing', () => {
  /* A digest of the empty string looks exactly like a real handle and would
   * match every other row that also had no address — turning "we know nothing
   * about this person" into "here is somebody else's consent record". */
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(subjectHash(v), null, `subjectHash(${JSON.stringify(v)}) invented a handle`);
    assert.deepEqual(subjectHashCandidates(v), []);
  }
});

/* ── 4 · Key rotation must not orphan evidence ───────────────────────────── */

test('🔴 rotating the key does not silently orphan years of evidence', () => {
  /* This is the trap. Rotating a secret is a routine security action; if
   * matching only ever tried the current key, rotation would quietly destroy
   * the linkage and nothing would error. The loss would surface only when
   * somebody needed the evidence and it "wasn't there". */
  const before = { k: process.env.SUBJECT_HASH_SECRET, p: process.env.SUBJECT_HASH_SECRET_PREVIOUS };
  try {
    process.env.SUBJECT_HASH_SECRET = 'old-key';
    delete process.env.SUBJECT_HASH_SECRET_PREVIOUS;
    const stored = subjectHash('claimant@example.com');

    /* Rotate. */
    process.env.SUBJECT_HASH_SECRET = 'new-key';
    assert.ok(!subjectHashCandidates('claimant@example.com').includes(stored),
      'the control is broken — the old digest matches without the retired key being declared');

    process.env.SUBJECT_HASH_SECRET_PREVIOUS = 'old-key';
    assert.ok(subjectHashCandidates('claimant@example.com').includes(stored),
      'a rotated key orphans every record made under the previous one');
  } finally {
    if (before.k === undefined) delete process.env.SUBJECT_HASH_SECRET; else process.env.SUBJECT_HASH_SECRET = before.k;
    if (before.p === undefined) delete process.env.SUBJECT_HASH_SECRET_PREVIOUS; else process.env.SUBJECT_HASH_SECRET_PREVIOUS = before.p;
  }
});

test('the CURRENT key is tried first', () => {
  /* Almost every match is against the current key. Trying retired ones first
   * would make the common case the slowest, and it puts the least trustworthy
   * key at the front of an evidence lookup. */
  const before = { k: process.env.SUBJECT_HASH_SECRET, p: process.env.SUBJECT_HASH_SECRET_PREVIOUS };
  try {
    process.env.SUBJECT_HASH_SECRET = 'current';
    process.env.SUBJECT_HASH_SECRET_PREVIOUS = 'old-1, old-2';
    const c = subjectHashCandidates('x@example.com');
    assert.equal(c.length, 3, 'retired keys are not all being tried');
    assert.equal(c[0], subjectHash('x@example.com'), 'the current key is not tried first');
  } finally {
    if (before.k === undefined) delete process.env.SUBJECT_HASH_SECRET; else process.env.SUBJECT_HASH_SECRET = before.k;
    if (before.p === undefined) delete process.env.SUBJECT_HASH_SECRET_PREVIOUS; else process.env.SUBJECT_HASH_SECRET_PREVIOUS = before.p;
  }
});

/* ── 5 · Evidence nobody can retrieve is not evidence ────────────────────── */

test('🔴 the retained evidence has a RETRIEVAL path, and it is reachable', () => {
  /* Keeping records forever with no way to read them is storage with no
   * purpose — which is what GDPR storage limitation objects to, so the
   * never-prune policy would become the violation rather than the protection.
   *
   * Reachability asserted through the operator tool, because "the function
   * exists" is exactly the claim that was true for six weeks about the last
   * three unreachable features in this codebase. */
  assert.ok(consent.includes('export async function findConsentEvidence('),
    'there is no way to retrieve the consent evidence we keep forever');
  /* ⚠️ Comments STRIPPED before asserting. `describeRetention()` is named in
   * that file's own docstring — explaining that it used to be unreachable — so
   * a file-level substring check passed with the call site severed. Eleventh
   * instance of this shape here: a gate satisfied by prose about the thing
   * rather than the thing. */
  const tool = read('scripts/compliance-evidence.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/findConsentEvidence\(pool, email\)/.test(tool),
    'the operator tool does not actually call the retrieval function');
  assert.ok(/for \(const p of describeRetention\(\)\)/.test(tool),
    'the retention summary is still reachable from nothing');
});

test('retrieval matches by HANDLE, never by joining users', () => {
  /* 🔴 A join is empty exactly when the answer is needed: the account is gone.
   * It would report "no consent on file" about a customer who consented — the
   * worst possible wrong answer, because it is the one that loses the dispute. */
  const fn = consent.slice(consent.indexOf('export async function findConsentEvidence('));
  assert.ok(/subject_hash = ANY\(\$1\)/.test(fn), 'retrieval no longer matches on the handle');
  assert.ok(!/JOIN users|FROM users/i.test(fn),
    'retrieval joins users — it would find nothing for exactly the deleted accounts it exists for');
  assert.ok(/subjectHashCandidates\(email\)/.test(fn),
    'retrieval derives only one handle — a rotated key would report no evidence');
});

test('retrieval returns the wording AS SHOWN, not today\'s wording', () => {
  /* Answering a regulator with the current text would quote words the customer
   * may never have seen. */
  const fn = consent.slice(consent.indexOf('export async function findConsentEvidence('));
  assert.ok(/consent_text/.test(fn), 'retrieval does not return the text that was actually shown');
  assert.ok(!/CONSENT_TEXT/.test(fn), 'retrieval substitutes the CURRENT wording for the one shown');
});

/* ── 6 · The auditor answer must be true ─────────────────────────────────── */

test('🔴 a cascading table is not reported as "kept indefinitely"', () => {
  /* The first version of the ops summary said exactly that about
   * download_intent_events, which is deleted with its parent at 180 days. It is
   * a false statement about how long we hold personal data, made to the one
   * audience that must not be told a false one. */
  const rows = describeRetention();
  const ev = rows.find((r) => r.table === 'download_intent_events');
  assert.equal(ev.prunedBy, 'cascade', 'the cascading table no longer declares how it is pruned');
  assert.equal(ev.pruned, true, 'a cascading table is reported as never pruned — that overstates retention');

  const kept = rows.find((r) => r.table === 'checkout_consents');
  assert.equal(kept.prunedBy, 'never');
  assert.equal(kept.pruned, false, 'the one table we genuinely retain is reported as pruned');
});

test('every policy declares WHO prunes it', () => {
  /* A policy with no prunedBy renders as UNKNOWN rather than guessing, but the
   * gap should be caught here rather than in front of an auditor. */
  const KINDS = ['sweeper', 'cascade', 'elsewhere', 'never'];
  for (const p of POLICIES) {
    assert.ok(KINDS.includes(p.prunedBy),
      `${p.table} has prunedBy=${JSON.stringify(p.prunedBy)} — the summary cannot describe it`);

    /* 🔴 `days` means "what THIS sweeper deletes after", so it must be null
     * unless we do the deleting — otherwise two clocks act on the same rows and
     * the earlier one wins silently. `documentedDays` carries the period we owe
     * the person when somebody else enforces it. Keeping them separate is what
     * lets the disclosure be complete without the sweeper over-reaching. */
    if (p.prunedBy === 'sweeper') {
      assert.ok(p.days, `${p.table} claims a sweeper prunes it but has no period`);
      assert.equal(p.documentedDays, undefined,
        `${p.table} declares both days and documentedDays — one of them is wrong and nobody will know which`);
    } else {
      assert.equal(p.days, null, `${p.table} is not swept here but declares a period — two clocks`);
    }

    /* Anything deleted must say after how long. Only a genuinely retained table
     * may answer "no period", and it must be the deliberate one. */
    if (p.prunedBy === 'cascade' || p.prunedBy === 'elsewhere') {
      assert.ok(p.documentedDays > 0,
        `${p.table} is deleted by something else and does not say after how long — the auditor answer would be a shrug`);
    }
  }
});

test('the operator tool never writes', () => {
  /* It answers a question. A tool reached for under dispute pressure must not
   * be able to change the record it is being used to read. */
  const tool = read('scripts/compliance-evidence.mjs');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/.test(tool.replace(/^\s*\*.*$/gm, '')),
    'the evidence tool contains a mutating statement');
});

/* ── 7 · What we KEEP and what we SAY must not drift ─────────────────────── */

const privacy = read('src/pages/Privacy.tsx');

test('🔴 every retention period in the code is DISCLOSED on the Privacy page', () => {
  /* GDPR Art. 13(2)(a) requires the storage period, or the criteria for it, to
   * be given. The mechanism (dataRetention.js) and the disclosure (Privacy.tsx)
   * are in different languages in different directories, so nothing but this
   * makes them agree — and the drift is silent in the direction that matters:
   * we start keeping something new and never say so.
   *
   * Derived from POLICIES rather than hardcoded, so ADDING a table with a
   * period and not disclosing it fails here. */
  /* 🔴 Every row with a PERIOD, not only the ones this sweeper enforces. The
   * first version skipped anything we do not delete ourselves — and the biggest
   * table is deleted by the funnel sweeper, so its period was unchecked and the
   * page understated it by a month (180 published, 210 real: a 30-day TTL and
   * then 180 days AFTER expiry). Who does the deleting is irrelevant to the
   * person being told how long we keep their data. */
  for (const p of describeRetention()) {
    if (p.days == null) continue;
    assert.ok(privacy.includes(`${p.days} days`),
      `${p.table} is kept for ${p.days} days and the Privacy page never says so`);
  }
});

test('🔴 the page no longer claims deletion removes EVERYTHING', () => {
  /* It said "upon account deletion, all personal data is removed within 30
   * days". That became false the moment consent evidence and the download audit
   * started surviving deletion — and it is the sentence a person would rely on.
   * A general "except for legitimate business purposes" clause does not repair
   * it: the reader cannot tell what it covers, which is the point of Art. 13. */
  assert.ok(!/all personal data is removed within 30 days/.test(privacy),
    'the page still promises deletion removes all personal data — that is now untrue');
});

test('the two survivors are named, not implied', () => {
  /* Naming them is the whole difference between a disclosure and a disclaimer. */
  assert.ok(/17\(3\)\(e\)/.test(privacy),
    'the lawful basis for keeping data past an erasure request is not stated');
  assert.ok(/withdrawal/i.test(privacy) && /checkout acknowledgement/i.test(privacy),
    'the surviving consent record is not described');
  assert.ok(/download record/i.test(privacy),
    'the surviving download record is not described');
});

test('the page states that the address itself is NOT kept', () => {
  /* The honest and reassuring half, and the one a reader most wants. Retaining
   * "evidence about you forever" reads very differently from retaining a code
   * that cannot be reversed into your address. */
  assert.ok(/one-way code|cannot be turned back into an address/i.test(privacy),
    'the page does not explain that the retained handle is not an email address');
});

/* ── 8 · Anything the runbook tells you to set must be SETTABLE ──────────── */

test('🔴 every env var the runbook says to set is declared in docker-compose.yml', () => {
  /* This is the 2026-08-24 incident as a gate. The runbook said "edit the box's
   * compose surgically" and listed variables the repo's compose did not declare
   * — so the only way to follow it was to hand-add lines to a file that a later
   * deploy overwrites from the repo. It was overwritten, and four box-only
   * values were destroyed: signup closed for everyone, forum email stopped,
   * extension CORS broke, outbound mail died.
   *
   * The durable shape is VALUES in the box's .env, NAMES here. So: if the
   * runbook names it, compose must have a slot for it. Derived from the runbook
   * text, so adding an instruction without a slot fails.
   *
   * ⚠️ Only variables inside the Step 6 fenced block count. Prose elsewhere
   * mentions env vars while explaining them, and treating every mention as a
   * requirement would make the gate impossible to satisfy honestly. */
  const runbook = read('docs/LAUNCH-RUNBOOK.md');
  const step6 = runbook.slice(runbook.indexOf('## Step 6'), runbook.indexOf('## Step 7'));
  const fence = step6.slice(step6.indexOf('```') + 3, step6.indexOf('```', step6.indexOf('```') + 3));

  /* ⚠️ NAMES only. A bare word-match also caught `XENOSTUDIO` — the example
   * VALUE of STRIPE_STATEMENT_DESCRIPTOR — and the wildcard `STRIPE_PRICE_*`,
   * so the gate demanded a compose slot for a value and for a glob. Take the
   * part before `=`, and require what is left to be a plain identifier. */
  const named = [...new Set(
    fence.split(/\s+/)
      .map((t) => t.split('=')[0])
      .filter((t) => /^[A-Z][A-Z0-9_]{3,}$/.test(t) && !t.endsWith('_')),
  )];
  assert.ok(named.length >= 5, 'the runbook step no longer names any variables — did the block move?');

  /* The price set is referenced as a glob, so check it explicitly rather than
   * letting the identifier filter quietly drop it. */
  assert.ok(/STRIPE_PRICE_\*/.test(fence), 'the runbook no longer mentions the price set');

  /* ⚠️ Anchored to the start of a YAML list item. `/- STRIPE_PRICE_/` alone
   * matched a COMMENTED line too, so commenting the whole price block out left
   * this green — a gate that cannot see the most likely way the thing breaks. */
  const compose = read('docker-compose.yml');
  const declares = (v) => new RegExp(`^\\s*- ${v}=`, 'm').test(compose);
  assert.ok((compose.match(/^\s*- STRIPE_PRICE_[A-Z_]+=/gm) || []).length >= 8,
    'the runbook says to set the STRIPE_PRICE_* set and compose declares almost none of it');

  /* 🔴 Named explicitly rather than only "whatever the runbook happens to list".
   * Deleting it from the runbook would otherwise satisfy this gate by removing
   * the requirement — and an operator who never sets it gets evidence handles
   * keyed by JWT_SECRET, which a routine rotation then orphans. */
  for (const required of ['SUBJECT_HASH_SECRET', 'STRIPE_STATEMENT_DESCRIPTOR', 'DISPUTE_ALERT_EMAIL']) {
    assert.ok(fence.includes(required), `the runbook step no longer tells the operator to set ${required}`);
    assert.ok(declares(required), `compose has no slot for ${required}`);
  }

  const missing = named.filter((v) => !declares(v));
  assert.deepEqual(missing, [],
    `the runbook says to set ${missing.join(', ')}, and compose has no slot — following it means hand-editing a file the next deploy overwrites`);
});

test('no billing secret is ever a LITERAL in the repo compose', () => {
  /* The slot is the point; the value belongs in the box's .env. A literal here
   * is a secret in git, and git does not forget. */
  const compose = read('docker-compose.yml');
  /* Anchored, so a commented-out line is not counted as a declaration. */
  const billing = compose.split('\n').filter((l) => /^\s*- (STRIPE_|SUBJECT_HASH_|DISPUTE_)/.test(l));
  assert.ok(billing.length >= 10, 'the billing block vanished from compose');
  for (const line of billing) {
    assert.ok(/=\$\{[A-Z0-9_]+:-\}$/.test(line.trim()),
      `${line.trim()} is not an empty-defaulted substitution — either a literal value or a compose error waiting to happen`);
  }
});

/* ── 9 · A migration must not manage its own transaction ─────────────────── */

test('🔴 no migration declares BEGIN/COMMIT — the runner owns that', () => {
  /* `migrationRunner.js` wraps each file in its own transaction. A `COMMIT;`
   * inside a file ends the RUNNER's transaction early, so every statement after
   * it runs unwrapped: a failure there leaves the schema half-changed with no
   * `schema_migrations` row, and the next boot replays the whole file against a
   * database that is already partly migrated.
   *
   * This migration was the only one of 35 that got it wrong. Postgres reports
   * the mistake as a WARNING, never an error, so nothing would have failed —
   * it would simply have stopped being atomic.
   *
   * ⚠️ Anchored to line start. `BEGIN` also opens every PL/pgSQL DO block and
   * appears in prose explaining this rule; only a statement counts. */
  const dir = 'src/server/database/migrations';
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /^(BEGIN|COMMIT)\s*;/m.test(read(`${dir}/${f}`)));
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} manage their own transaction — that breaks the runner's atomicity`);
});

test('the runner really does wrap each migration', () => {
  /* The premise the gate above rests on. If the runner ever stopped wrapping,
   * the rule would invert and this should say so rather than keep enforcing a
   * requirement that had become wrong. */
  const runner = read('src/server/services/migrationRunner.js');
  const i = runner.indexOf('for (const migration of pending)');
  const body = runner.slice(i, i + 900);
  assert.ok(/client\.query\('BEGIN'\)/.test(body), 'the runner no longer opens a transaction per migration');
  assert.ok(/client\.query\('COMMIT'\)/.test(body) && /ROLLBACK/.test(body),
    'the runner no longer commits or rolls back per migration');
});

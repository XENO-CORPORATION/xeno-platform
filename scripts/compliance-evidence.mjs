#!/usr/bin/env node
/**
 * The operator's side of the compliance machinery.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Two functions were written, tested, documented — and reachable from nothing:
 *
 *   • `describeRetention()` — its own docstring says it is "for the ops summary
 *     and for answering auditors". There was no ops summary and no way to
 *     answer an auditor except by reading the source.
 *   • `findConsentEvidence()` — the reason `checkout_consents` is never pruned.
 *     Keeping evidence nobody can retrieve is storage with no purpose, which is
 *     itself the thing GDPR storage limitation objects to.
 *
 * 🔴 That shape — built, tested, unreachable — has now appeared enough times in
 * this ecosystem to be a named failure mode. Retention policy and evidence
 * retrieval are exactly the areas where nobody notices, because the first person
 * to need them is under time pressure and assumes the gap is their own.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * Read-only. It issues SELECTs and nothing else — no mode of this tool writes,
 * deletes or mutates anything. It is the answer to a question, not an action.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/compliance-evidence.mjs retention
 *       What we keep, for how long, and why. The auditor answer.
 *
 *   node scripts/compliance-evidence.mjs consent <email>
 *       Did this person waive their withdrawal right, when, and to what exact
 *       wording. Works after they have deleted their account — which is when it
 *       is actually asked.
 *
 *   node scripts/compliance-evidence.mjs downloads <email>
 *       Which binaries this person obtained. Chargebacks and leaked builds.
 *
 * `retention` needs no database. The other two do (DATABASE_URL).
 */
import pg from 'pg';
import { describeRetention } from '../src/server/services/dataRetention.js';
import { findConsentEvidence } from '../src/server/services/checkoutConsent.js';
import { subjectHashCandidates } from '../src/server/services/subjectHash.js';

const [mode, arg] = process.argv.slice(2);

function usage(msg) {
  if (msg) console.error(`\n  ${msg}\n`);
  console.error('  node scripts/compliance-evidence.mjs retention');
  console.error('  node scripts/compliance-evidence.mjs consent   <email>');
  console.error('  node scripts/compliance-evidence.mjs downloads <email>\n');
  process.exit(msg ? 1 : 0);
}

/* ── retention ─────────────────────────────────────────────────────────────── */

function showRetention() {
  console.log('\n  DATA RETENTION — what we keep and for how long\n');
  for (const p of describeRetention()) {
    const period = {
      sweeper: `${p.days} days`,
      /* 🔴 Not "kept indefinitely". It is deleted — by the funnel sweeper, with
       * its parent row — and saying otherwise overstates how long we hold it. */
      cascade: `${p.days} days — deleted with its parent record (download_intents)`,
      elsewhere: `${p.days} days — deleted by another sweeper, not this one`,
      never: 'retained — no automatic deletion',
    }[p.prunedBy] || 'UNKNOWN — a policy with no prunedBy is a gap, not a period';
    console.log(`  ${p.table}`);
    console.log(`    period : ${period}`);
    /* Wrapped by hand rather than dumped — this text gets pasted into a reply to
     * a regulator, and a 400-column line is not a usable answer. */
    console.log(`    why    : ${wrap(p.why, 66, ' '.repeat(13))}`);
    console.log('');
  }
  console.log('  Anything not listed is governed by the general policy on the');
  console.log('  Privacy page. A table that grows per user action and is absent');
  console.log('  from BOTH is the bug this summary exists to make visible.\n');
}

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n' + indent);
}

/* ── evidence ──────────────────────────────────────────────────────────────── */

async function withPool(fn) {
  if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set — this mode reads the database.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { await fn(pool); } finally { await pool.end(); }
}

async function showConsent(pool, email) {
  const rows = await findConsentEvidence(pool, email);
  if (!rows.length) {
    console.log(`\n  No consent record for ${email}.\n`);
    /* 🔴 Said out loud, because the difference decides what we tell the
     * customer. "They never consented" and "we cannot show that they did" are
     * different statements, and only the second one is true here. */
    console.log('  ⚠️  That is NOT proof they did not consent. Records written');
    console.log('      before 2026-08-24 carry no handle, and a handle made');
    console.log('      under a key that is neither current nor listed in');
    console.log('      SUBJECT_HASH_SECRET_PREVIOUS cannot be matched.\n');
    return;
  }
  console.log(`\n  ${rows.length} consent record(s) for ${email}\n`);
  for (const r of rows) {
    console.log(`  ${r.consented_at.toISOString()}  item=${r.item_id}`);
    console.log(`    account   : ${r.account_deleted ? 'DELETED (evidence retained under GDPR Art. 17(3)(e))' : 'active'}`);
    console.log(`    consumed  : ${r.consumed_at ? r.consumed_at.toISOString() : 'never — no purchase completed'}`);
    console.log(`    session   : ${r.checkout_session_id || '—'}`);
    console.log(`    locale    : ${r.locale || '—'}   ip: ${r.client_ip || '—'}`);
    console.log(`    wording   : (hash ${r.consent_hash}) — as shown to them, not today's text`);
    console.log(`${indentBlock(r.consent_text, '      | ')}`);
    console.log('');
  }
}

async function showDownloads(pool, email) {
  const candidates = subjectHashCandidates(email);
  if (!candidates.length) usage('An email address is required.');
  const r = await pool.query(
    `SELECT at, slug, os, version, plan, client_ip, (user_id IS NULL) AS account_deleted
       FROM download_grants
      WHERE subject_hash = ANY($1)
      ORDER BY at DESC
      LIMIT 200`,
    [candidates],
  );
  if (!r.rows.length) { console.log(`\n  No download grants for ${email}.\n`); return; }
  console.log(`\n  ${r.rows.length} download grant(s) for ${email}\n`);
  for (const g of r.rows) {
    console.log(`  ${g.at.toISOString()}  ${g.slug} ${g.version || ''} (${g.os})  plan=${g.plan || '—'}  ip=${g.client_ip || '—'}${g.account_deleted ? '  [account deleted]' : ''}`);
  }
  console.log('');
}

function indentBlock(text, prefix) {
  return String(text || '').split('\n').map((l) => prefix + l).join('\n');
}

/* ── dispatch ──────────────────────────────────────────────────────────────── */

if (!mode || mode === '--help' || mode === '-h') usage();

if (mode === 'retention') {
  showRetention();
} else if (mode === 'consent' || mode === 'downloads') {
  if (!arg) usage(`${mode} needs an email address.`);
  await withPool(async (pool) => {
    if (mode === 'consent') await showConsent(pool, arg);
    else await showDownloads(pool, arg);
  });
} else {
  usage(`Unknown mode "${mode}".`);
}

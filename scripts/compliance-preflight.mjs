#!/usr/bin/env node
/**
 * Can we legally take money yet?
 *
 * ⚠️ NOT LEGAL ADVICE, and it cannot become it. This checks the things that are
 * MECHANICALLY checkable — is a consent captured, is tax configured, does the
 * Terms page mention renewal. Whether your wording and tax position are correct
 * for your entity is a question for a Rechtsanwalt and a Steuerberater, and no
 * script can answer it.
 *
 * 🔴 The distinction is the point. "The checkbox exists" is checkable and is
 * checked. "The checkbox says the right thing" is not, and the script says so
 * rather than implying coverage it does not have. A green run here means the
 * mechanisms are present, NOT that you are compliant.
 *
 *   node scripts/compliance-preflight.mjs
 *
 * Exit 0 = every mechanical prerequisite present. Exit 1 = at least one missing.
 */
import { readFileSync, existsSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const has = (f, re) => re.test(read(f).replace(/\s+/g, ' '));

let problems = 0;
let advisories = 0;
const fail = (m, why) => { problems += 1; console.log(`  ✗ ${m}`); if (why) console.log(`      ${why}`); };
const warn = (m, why) => { advisories += 1; console.log(`  ⚠ ${m}`); if (why) console.log(`      ${why}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('XENO commercial-readiness preflight');
console.log('─'.repeat(74));
console.log('⚠️  Mechanisms only. A green run is NOT a statement that you are compliant.\n');

/* 🔴 This script mixes two kinds of check, and conflating them produced a false
 * alarm the same day the env checks were added: SUBJECT_HASH_SECRET was reported
 * unset while production had it, because the run happened on a workstation.
 *
 * Repo checks read files and are true anywhere. ENVIRONMENT checks read
 * process.env and are only ever true about the machine running them — so on a
 * laptop they describe the laptop, which is never the question being asked. An
 * unlabelled env finding sends someone to fix a problem that does not exist, or
 * worse, to believe one is fixed because their shell happens to have the value. */
/* 🔴 AND THE FIRST FIX FOR THAT WAS WORSE. It labelled env findings and told the
 * reader to run this inside the backend container "for the real answer". The
 * container has no repo source — its layout is /app/services, not
 * /app/src/server/services — so every file check missed and the run reported TEN
 * fabricated blockers: "no consent service", "no Impressum", "Terms does not
 * mention how to cancel". All false, all alarming, and a checker that cries wolf
 * is worse than no checker.
 *
 * The two halves cannot run in the same place, so they no longer try. File
 * checks run HERE, against the repo, and refuse if the repo is not here. The
 * environment is supplied as a SNAPSHOT of non-secret facts, gathered by a
 * command that leaks nothing:
 *
 *   ssh xeno-platform-001 "sudo docker exec xenostudio-backend sh -c '
 *     echo STRIPE_AUTOMATIC_TAX=\\$STRIPE_AUTOMATIC_TAX;
 *     [ -n \\"\\$SUBJECT_HASH_SECRET\\" ] && echo SUBJECT_HASH_SECRET=set'" > /tmp/prod.env
 *   node scripts/compliance-preflight.mjs --env-from /tmp/prod.env
 *
 * ⚠️ The snapshot carries PRESENCE, never a secret's value — the script only
 * ever needs to know whether a key is set. */

/* Precondition. Reporting findings about files that are not there is how the
 * previous version produced ten blockers that did not exist. */
if (!existsSync('src/server/services/billingService.js')) {
  console.error('  REFUSED: this must run from the xeno-platform repo root.');
  console.error('  It reads source files; from anywhere else every check would');
  console.error('  MISS and be reported as a blocker. See the note above for how');
  console.error('  to supply production environment facts with --env-from.\n');
  process.exit(2);
}

const envArgIdx = process.argv.indexOf('--env-from');
const SNAPSHOT = new Map();
if (envArgIdx > -1) {
  const f = process.argv[envArgIdx + 1];
  if (!f || !existsSync(f)) {
    console.error(`  REFUSED: --env-from ${f || '<missing>'} does not exist.`);
    process.exit(2);
  }
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) SNAPSHOT.set(m[1], m[2]);
  }
}
const USING_SNAPSHOT = envArgIdx > -1;

/** An environment fact — from the supplied snapshot, else this machine. */
const envOf = (name) => (USING_SNAPSHOT ? SNAPSHOT.get(name) : process.env[name]);

if (USING_SNAPSHOT) {
  console.log(`ℹ️  Environment facts from a snapshot (${SNAPSHOT.size} value(s)); file checks from this repo.\n`);
} else {
  console.log('ℹ️  No --env-from given, so findings marked [env] describe THIS machine,');
  console.log('   not production. File checks are unaffected and always valid here.\n');
}
/** Marks a finding whose truth depends on which environment was measured. */
const envTag = USING_SNAPSHOT ? '' : ' [env: this machine, not production]';

/* ── 1 · Right of withdrawal — the one that voids sales ─────────────────── */
console.log('Right of withdrawal (EU CRD 2011/83; §§ 312g, 356 BGB)');

const billing = read('src/server/services/billingService.js');
const consentSvc = read('src/server/services/checkoutConsent.js');

if (!consentSvc) {
  fail('no consent service', 'digital sales cannot be made final; a buyer may use the software for 13 days and demand a full refund');
} else {
  ok('consent service present');

  /* 🔴 EVERY payment path, counted — not "does the string appear".
   *
   * The first version checked the file for one refusal and passed while
   * createWorkspaceSeatCheckout had NO consent gate at all: Team, the most
   * expensive item on the price list, sold without the acknowledgement that
   * makes a digital sale final. A control covering one of two paths is not a
   * weaker control, it is an absent one for the path it misses. */
  const paths = [
    ['createCheckout', 'personal subscriptions and credit packs'],
    ['createWorkspaceSeatCheckout', 'per-seat Team'],
  ];
  for (const [fn, label] of paths) {
    const i = billing.indexOf(`export async function ${fn}(`);
    if (i < 0) { fail(`${fn} is gone`, 'the payment path moved — re-verify the consent gate'); continue; }
    const body = billing.slice(i, i + 4000);
    /* ⚠️ findUsableConsent must be CALLED. Checking only for the refusal code and
     * `if (!usable)` passed when `usable` was hardcoded true — the structure was
     * all there and could never fire. A gate that sees the shape of a check
     * rather than its input is the same mechanism-not-outcome miss this file
     * exists to prevent. */
    const looksUp = /findUsableConsent\(pool, user\.id, item\.id\)/.test(body);
    if (looksUp && /e\.code = 'consent_required'/.test(body) && /if \(!usable\)/.test(body)) {
      ok(`${label} refuses without consent (fails closed)`);
    } else {
      fail(`${label} does NOT require consent`,
        'every sale on this path stays withdrawable for 14 days regardless of use');
    }
  }

  /* And the UI that satisfies the refusal. A server that demands consent with no
   * way to give it is a checkout that 400s for every customer — which is how
   * this shipped once already, hidden behind the 503 that fires while Stripe is
   * off. */
  const dialog = read('src/components/billing/CheckoutConsent.tsx');
  const pricing = read('src/pages/Pricing.tsx');
  if (dialog.includes('recordConsent(') && pricing.includes('<CheckoutConsent')) {
    ok('the checkout UI collects consent');
  } else {
    fail('nothing collects consent in the UI',
      'the server refuses without it, so checkout would 400 for every customer');
  }

  for (const [k, label] of [
    ['immediate_performance', 'express consent to immediate performance'],
    ['withdrawal_acknowledged', 'acknowledgement that the withdrawal right is lost'],
  ]) {
    if (consentSvc.includes(k)) ok(`records ${label}`);
    else fail(`does not record ${label}`, 'both are required; either alone leaves the right intact');
  }

  if (/consent_text\s+TEXT NOT NULL/.test(read('src/server/database/migrations/20260824180000-checkout-consent.sql'))) {
    ok('stores the WORDING, not just a version');
  } else {
    fail('stores no wording', 'a later edit to the terms page silently rewrites what someone agreed to');
  }
}

/* ── 2 · Tax ─────────────────────────────────────────────────────────────── */
console.log('\nTax');
if (envOf('STRIPE_AUTOMATIC_TAX') === 'true') {
  ok('Stripe Tax enabled');
} else {
  fail(`Stripe Tax is OFF (STRIPE_AUTOMATIC_TAX)${envTag}`,
    'B2C digital services are taxed where the CUSTOMER is. Selling cross-border without it accrues a liability you must pay from revenue already collected.');
}
warn('VAT registration / OSS is an OPERATOR question',
  'a Steuerberater decides whether you need OSS, Kleinunternehmerregelung, or a USt-IdNr. This script cannot.');

/* ── 3 · Pre-contractual information ─────────────────────────────────────── */
console.log('\nPre-contractual information (what a buyer must be told BEFORE paying)');
const terms = 'src/pages/Terms.tsx';
for (const [re, label, why] of [
  [/renew/i, 'automatic renewal', 'a subscription that renews without saying so is unenforceable and a chargeback magnet'],
  [/cancel/i, 'how to cancel', 'the CRD requires the conditions for terminating the contract'],
  [/withdraw|widerruf/i, 'the withdrawal right', 'the statutory right must be described, not only a commercial refund policy'],
]) {
  if (has(terms, re)) ok(`Terms mentions ${label}`);
  else fail(`Terms does not mention ${label}`, why);
}
if (has('src/pages/Refunds.tsx', /withdraw|widerruf/i)) ok('Refund policy distinguishes the statutory right');
else fail('Refund policy does not mention the statutory withdrawal right',
  'a goodwill refund policy is not a substitute — the statutory right exists regardless of it');

/* ── 4 · Provider identification + data protection ──────────────────────── */
console.log('\nProvider identification and data protection');
if (has('src/pages/Impressum.tsx', /Diensteanbieter/i)) ok('Impressum present (§ 5 DDG)');
else fail('no Impressum', 'required for a German provider');

/* 🔴 The NUMBER, not the words. The first version matched the heading
 * "Umsatzsteuer-Identifikationsnummer" and a source comment reading "add the
 * USt-IdNr line once assigned" — on a page whose body says the number "ist
 * beantragt" (applied for). It reported a VAT id that does not exist.
 *
 * A compliance check that passes on a MENTION of the thing is worse than no
 * check: it converts a gap into a green tick. Match the format. */
const impressum = read('src/pages/Impressum.tsx');

/* The VAT id, matched by FORMAT. Two lessons are baked into this one line.
 *
 * 🔴 It once matched the heading "Umsatzsteuer-Identifikationsnummer" and a
 * source comment saying "add the USt-IdNr line once assigned" — on a page whose
 * body read "ist beantragt". It reported a VAT id that did not exist.
 *
 * 🔴 Then the fix for THAT was written through a tool that processes escapes, and
 * the two `\b` word boundaries became literal BACKSPACE bytes (U+0008 — Python's
 * "\b" is chr(8)). A bare 0x08 in a JS regex matches a backspace CHARACTER, so
 * the pattern could not match any VAT number and the check was dead from the day
 * it was written. It reported "APPLIED FOR" against a page carrying a valid id.
 * Caught by `scripts/check-control-characters.mjs` in the workspace root — run it
 * after any scripted edit that carries a regex. */
const VAT_ID = /\b(DE|ATU|FR|NL|IT|ES|PL)[0-9A-Z]{8,12}\b/;
if (VAT_ID.test(impressum)) {
  ok(`Impressum carries a VAT number (${impressum.match(VAT_ID)[0]})`);
} else if (/beantragt|applied for|pending/i.test(impressum)) {
  /* 🔴 Not merely stale — NON-COMPLIANT. § 5 Abs. 1 Nr. 6 DDG requires the
   * USt-IdNr to be shown ONCE HELD, so "ist beantragt" on a page for a business
   * that has one is a defect in a legally required disclosure, not a to-do. */
  fail('Impressum still says the VAT number is APPLIED FOR',
    'DDG requires it once you hold one. Confirm the number in the EU VIES register before publishing it — a Wirtschafts-Identifikationsnummer shares the DE + 9-digit format WITHOUT being a VAT id.');
} else {
  warn('Impressum shows no VAT number', 'required on invoices once VAT-registered');
}

/* 🔴 A seller who charges no VAT must SAY WHY. An invoice with no VAT line and no
 * explanation is indistinguishable from one where the VAT was simply left off,
 * and the buyer cannot tell which. § 19 Abs. 1 UStG is what makes it legible.
 *
 * ⚠️ Keyed on the NOTICE being present, never on whether § 19 still applies —
 * this script cannot know your turnover. Crossing into Regelbesteuerung means
 * REMOVING this notice, and that transition is a Steuerberater instruction. */
if (/§ ?19( Abs\. ?1)? (UStG|Umsatzsteuergesetz)/.test(impressum)) {
  ok('Impressum carries the § 19 UStG small-business notice');
} else {
  warn('no § 19 UStG small-business notice',
    'if you are a Kleinunternehmer, charging no VAT needs the statutory explanation. If you are NOT, ignore this — and make sure Stripe Tax carries a registration.');
}

/* The posture must be WRITTEN DOWN and must agree with the page. Every fact in
 * docs/TAX-POSTURE.md was rediscovered the hard way during the Stripe build, and
 * two of them were wrong in code at the time. A number that appears in one place
 * and not the other is the drift this catches. */
const posture = read('docs/TAX-POSTURE.md');
if (!posture) {
  fail('docs/TAX-POSTURE.md is missing',
    'the VAT regime, the two thresholds and what changes at crossover are then only in someone memory');
} else {
  const inDoc = posture.match(VAT_ID);
  const onPage = impressum.match(VAT_ID);
  if (inDoc && onPage && inDoc[0] === onPage[0]) {
    ok('the tax posture doc and the Impressum agree on the VAT number');
  } else if (inDoc && onPage) {
    fail(`VAT number mismatch: doc says ${inDoc[0]}, Impressum says ${onPage[0]}`,
      'one of them is being quoted somewhere it should not be');
  } else {
    warn('cannot compare the VAT number between the doc and the Impressum');
  }

  /* 🔴 The crossover contradiction, stated so it is checkable later: charging VAT
   * while still displaying the § 19 notice is a false statement on a legally
   * required page. The preflight cannot see Stripe registrations from here, so it
   * records the pairing rather than pretending to verify it. */
  if (/Stripe Tax is ENABLED with ZERO registrations/.test(posture)) {
    ok('the zero-registration posture is documented as deliberate');
  } else {
    warn('the doc no longer explains the zero-registration posture',
      'someone will read enabled-with-no-registrations as a misconfiguration and add one');
  }
}

const privacy = 'src/pages/Privacy.tsx';
if (has(privacy, /Stripe/i)) ok('Privacy names Stripe as a processor');
else fail('Privacy does not name Stripe', 'a payment processor receives personal data; GDPR Art. 13 requires naming recipients');
for (const [re, label] of [[/erasure|deletion/i, 'erasure'], [/lawful basis|Art\.? ?6|legitimate interest|contract/i, 'lawful basis']]) {
  if (has(privacy, re)) ok(`Privacy covers ${label}`);
  else warn(`Privacy does not clearly cover ${label}`, 'GDPR Art. 13/15–17 — have this reviewed');
}

/* ── 4b · Retention, and the evidence that has to outlive an account ────── */
console.log('\nRetention and evidence');

const retentionSvc = read('src/server/services/dataRetention.js');
const evidenceMig = read('src/server/database/migrations/20260824200000-evidence-survives-erasure.sql');

/* 🔴 The defect this exists for: checkout_consents was ON DELETE CASCADE while
 * account deletion is self-service. Buy, download, delete the account, dispute
 * the charge — and the proof of agreement went with the account, on the
 * customer's initiative, at exactly the moment it mattered. */
if (/REFERENCES users\(id\) ON DELETE SET NULL/.test(evidenceMig)
    && !/REFERENCES users\(id\) ON DELETE CASCADE/.test(evidenceMig)) {
  ok('consent evidence survives account deletion');
} else {
  fail('deleting an account destroys the consent evidence',
    'the customer can erase our proof they waived withdrawal, then dispute the charge');
}

if (/subject_hash/.test(consentSvc)) ok('surviving evidence can still identify its subject');
else fail('surviving evidence is anonymous',
  'a row proving SOMEBODY consented rebuts nothing — and retention with no purpose is its own GDPR problem');

/* Advisory, not a blocker: it works, it is just coupled to a secret that gets
 * rotated for unrelated reasons. Worth fixing BEFORE the first sale, because
 * afterwards a rotation orphans real evidence rather than an empty table. */
if (envOf('SUBJECT_HASH_SECRET')) {
  ok(`SUBJECT_HASH_SECRET is set explicitly${envTag}`);
} else {
  warn(`SUBJECT_HASH_SECRET is unset — evidence handles are keyed by JWT_SECRET${envTag}`,
    'rotating JWT_SECRET is routine and would silently orphan every consent record. Set this before the first sale; afterwards, retiring a key means listing it in SUBJECT_HASH_SECRET_PREVIOUS.');
}

/* Art. 13(2)(a): the storage period, or the criteria for it, must be given.
 * Derived from the policy file so a table added later and left undisclosed is
 * caught here rather than by a regulator. */
/* ⚠️ `documentedDays` too — the capital D meant this regex silently skipped
 * the largest table, whose period the Privacy page then understated by a
 * month. Who enforces a period is irrelevant to disclosing it. */
const undisclosed = [...retentionSvc.matchAll(/(?:documented)?[Dd]ays: (\d+),/g)]
  .map((m) => m[1])
  .filter((d) => !has(privacy, new RegExp(`${d} days`)));
if (undisclosed.length) {
  fail(`retention periods not disclosed on the Privacy page: ${[...new Set(undisclosed)].join(', ')} days`,
    'GDPR Art. 13(2)(a) requires the storage period, or the criteria used to determine it');
} else {
  ok('every retention period in the code is disclosed');
}

if (has(privacy, /17\(3\)\(e\)/)) ok('the basis for keeping data past an erasure request is stated');
else fail('Privacy does not state why some data survives deletion',
  'Art. 17(3)(e) permits it for legal claims — but only if the person is told');

/* ── 5 · Things a script must not claim to have checked ─────────────────── */
console.log('\nOut of scope for any script');
console.log('  · whether the consent WORDING is legally sufficient in your jurisdiction');
console.log('  · whether your tax position (OSS / Kleinunternehmer / USt-IdNr) is correct');
console.log('  · whether Terms and Privacy say true things about what you actually do');
console.log('  · cookie consent, if you add non-essential cookies or analytics');

console.log(`\n${'─'.repeat(74)}`);
if (problems) {
  console.log(`${problems} blocker(s), ${advisories} advisory. NOT ready to take money.`);
  process.exit(1);
}
console.log(`0 blockers, ${advisories} advisory. Mechanisms present — the wording still needs a lawyer.`);

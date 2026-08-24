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
if (process.env.STRIPE_AUTOMATIC_TAX === 'true') {
  ok('Stripe Tax enabled');
} else {
  fail('Stripe Tax is OFF (STRIPE_AUTOMATIC_TAX)',
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
if (/(DE|ATU|FR|NL|IT|ES|PL)[0-9A-Z]{8,12}/.test(impressum)) {
  ok('Impressum carries an actual VAT number');
} else if (/beantragt|applied for|pending/i.test(impressum)) {
  warn('VAT number is APPLIED FOR, not issued',
    'you may invoice without it, but not charge VAT under a number you do not have. Confirm the position with a Steuerberater before the first sale.');
} else {
  warn('Impressum shows no VAT number', 'required on invoices once VAT-registered');
}

const privacy = 'src/pages/Privacy.tsx';
if (has(privacy, /Stripe/i)) ok('Privacy names Stripe as a processor');
else fail('Privacy does not name Stripe', 'a payment processor receives personal data; GDPR Art. 13 requires naming recipients');
for (const [re, label] of [[/erasure|deletion/i, 'erasure'], [/lawful basis|Art\.? ?6|legitimate interest|contract/i, 'lawful basis']]) {
  if (has(privacy, re)) ok(`Privacy covers ${label}`);
  else warn(`Privacy does not clearly cover ${label}`, 'GDPR Art. 13/15–17 — have this reviewed');
}

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

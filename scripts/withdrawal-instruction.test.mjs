/**
 * THE WIDERRUFSBELEHRUNG, AND THE SAFE HARBOUR IT DEPENDS ON.
 *
 * Art. 246a § 1 Abs. 2 Satz 2 EGBGB: a trader who reproduces the statutory model
 * instruction, correctly filled in, is DEEMED to have instructed the consumer
 * properly. That protection is the entire reason for not improvising the wording.
 *
 * 🔴 It is fragile in two specific ways, and both are mechanically checkable:
 *
 *   1. an UNFILLED blank breaks it outright — an instruction still reading
 *      "[Name/Anschrift einsetzen]" has instructed nobody
 *   2. rewriting the sentences forfeits it — a copy pass that "improves" the
 *      German for tone converts a protected text into an ordinary one
 *
 * These gates hold both. They cannot check whether the text is legally correct
 * for this business, and they do not pretend to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/Withdrawal.tsx', 'utf8');

/* ⚠️ Strip comments before checking for placeholders. The header comment QUOTES
 * the placeholder it warns about, so a whole-file check trips on its own
 * explanation — the same shape that made the purple sweep rewrite the comment
 * describing the purple. Check what RENDERS, not what documents it. */
const rendered = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
/* 🔴 From RENDERED, not from the raw file. Deriving it from `page` meant every
 * content assertion also matched this file's own explanatory comments — so
 * deleting "§ 356 Abs. 5 BGB" from the PAGE still passed, because the comment
 * above quotes it. Third time this shape has fooled a gate today. */
const flat = rendered.replace(/\s+/g, ' ');
const app = readFileSync('src/App.tsx', 'utf8');
const terms = readFileSync('src/pages/Terms.tsx', 'utf8').replace(/\s+/g, ' ');
const refunds = readFileSync('src/pages/Refunds.tsx', 'utf8').replace(/\s+/g, ' ');
const impressum = readFileSync('src/pages/Impressum.tsx', 'utf8');

/* ── 1 · No unfilled blanks ──────────────────────────────────────────────── */

test('🔴 no statutory placeholder survives', () => {
  /* The single most common way a Widerrufsbelehrung fails: shipped with the
   * template's own square brackets still in it. */
  for (const ph of [
    'einsetzen', '[Name', '[Anschrift', '[Telefonnummer', '[E-Mail',
    'Namen/Firma', 'TODO', 'XXX', 'Lorem',
  ]) {
    assert.ok(!rendered.includes(ph), `the instruction still contains the placeholder "${ph}"`);
  }
});

test('the provider details match the Impressum exactly', () => {
  /* Two addresses for one trader is worse than one: it makes both doubtful, and
   * a consumer who writes to the wrong one has still exercised their right. */
  for (const v of ['Emilian-Vasile Cristea', 'Hauptstraße 112', '97909 Stadtprozelten']) {
    assert.ok(page.includes(v), `the instruction omits "${v}"`);
    assert.ok(impressum.includes(v), `the Impressum no longer contains "${v}" — the two have drifted`);
  }
  assert.ok(page.includes('support@xenostudio.ai'), 'no contact email in the instruction');
  assert.ok(!page.includes('xeno-studio.com'), 'the instruction points at the domain with no MX records');
});

/* ── 2 · The statutory sentences, unrewritten ────────────────────────────── */

test('the model wording is reproduced, not paraphrased', () => {
  /* Each of these is a load-bearing phrase from Anlage 1. Rewriting any of them
   * for tone forfeits the safe harbour, and the loss is invisible until it
   * matters. */
  for (const phrase of [
    'binnen vierzehn Tagen ohne Angabe von Gründen',
    'ab dem Tag des Vertragsabschlusses',
    'mittels einer eindeutigen Erklärung',
    'Zur Wahrung der Widerrufsfrist reicht es aus',
    'unverzüglich und spätestens binnen vierzehn Tagen',
    'dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben',
    'in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet',
  ]) {
    assert.ok(flat.includes(phrase), `the model wording lost: "${phrase}"`);
  }
});

test('the digital-content early-expiry clause is present and complete', () => {
  /* § 356 Abs. 5 BGB. Without it the instruction promises a right that checkout
   * then removes — which is worse than saying nothing, because the consumer
   * relied on it. BOTH limbs are required; either alone leaves the right intact. */
  assert.ok(flat.includes('356 Abs. 5 BGB'), 'the early-expiry basis is not cited');
  assert.ok(flat.includes('ausdrücklich zugestimmt'), 'the express-consent limb is missing');
  assert.ok(flat.includes('Ihr Widerrufsrecht verlieren'), 'the acknowledgement limb is missing');
});

test('declining is stated, not buried', () => {
  /* Someone who does not want to waive the right is entitled to know that is a
   * real option, and to be told how. */
  assert.ok(/schließen Sie den Kauf bitte nicht ab/.test(flat), 'the instruction does not say the purchase can be declined');
  assert.ok(/späteren Zugang/.test(flat), 'no alternative is offered to someone who declines');
});

test('the model form (Anlage 2) is present', () => {
  for (const phrase of [
    'Hiermit widerrufe(n) ich/wir',
    'Bestellt am',
    'Name des/der Verbraucher(s)',
    'Unzutreffendes streichen',
  ]) {
    assert.ok(flat.includes(phrase), `the model withdrawal form lost: "${phrase}"`);
  }
});

/* ── 3 · The English version must not masquerade as operative ────────────── */

test('the translation is marked non-binding', () => {
  /* A translation presented as equal creates two texts that can disagree, and a
   * consumer may rely on whichever is more favourable. */
  assert.ok(/German text above is the legally binding version/i.test(flat),
    'the English version does not say the German governs');
});

/* ── 4 · Reachability — an instruction nobody finds instructs nobody ─────── */

test('both routes exist', () => {
  /* /widerruf is what a German consumer types; /withdrawal is what the English
   * pages link to. */
  assert.ok(app.includes('path="/withdrawal"'), '/withdrawal is not routed');
  assert.ok(app.includes('path="/widerruf"'), '/widerruf is not routed');
});

test('Terms and Refunds both link to it', () => {
  assert.ok(/to="\/withdrawal"/.test(terms), 'Terms does not link the model withdrawal form');
  assert.ok(/to="\/withdrawal"/.test(refunds), 'the Refund policy does not link the statutory instructions');
});

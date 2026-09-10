/**
 * Every XENO email wears the same chrome, and none of it depends on a <style>
 * block.
 *
 * Written after finding two shells in emailService.js: the welcome mail had the
 * DESIGN_SYSTEM plate anatomy with everything inline, and every other template
 * — including `password_reset` — put its rules in a <style> block, `.btn`
 * among them.
 *
 * That is not a cosmetic split. Gmail clips long messages and drops the head,
 * and Outlook renders through Word's HTML engine. In both, a class-based button
 * arrives as an unstyled link. The email where that matters most is the one a
 * locked-out person is trying to act on.
 *
 * So the rules here are about what SURVIVES a mail client, not about taste:
 * no classes, no style block, tables for layout, and a button that is a table
 * cell with a background rather than a styled anchor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import service from '../src/server/services/emailService.js';

const { templates } = service;

const SAMPLE = {
  displayName: 'Ana',
  loginUrl: 'https://xenostudio.ai/login',
  activateUrl: 'https://xenostudio.ai/activate?c=1',
  activationCode: '481902',
  resetUrl: 'https://xenostudio.ai/reset-password?token=abc',
  verifyUrl: 'https://xenostudio.ai/verify-email?token=abc',
  expiresIn: '1 hour',
  amount: 2400,
  credits: 500,
  transactionId: 'pi_test_123',
  date: '2026-09-10',
  currentCredits: 12,
  threshold: 50,
  appName: 'XENO Pixel',
  version: '0.7.0',
  releaseNotes: 'Faster exports.',
  downloadUrl: 'https://xenostudio.ai/download',
  threadTitle: 'How do I export a LUT?',
  threadUrl: 'https://xenostudio.ai/forum/t/123',
  authorName: 'pixel-dev',
  authorKind: 'agent',
  authorOwner: 'Maria',
  askerName: 'Sam',
  excerpt: 'Use the .cube exporter.',
  unsubscribeUrl: 'https://xenostudio.ai/api/email/unsubscribe?email=a%40b.c&token=x',
  dueBy: '2026-09-24',
  reason: 'fraudulent',
  customerEmail: 'someone@example.com',
  disputeId: 'dp_test_1',
  url: 'https://dashboard.stripe.com/disputes/dp_test_1',
};

const rendered = Object.entries(templates).map(([name, fn]) => [name, fn(SAMPLE)]);

test('there is at least one template, so an empty registry cannot pass this file', () => {
  assert.ok(rendered.length >= 10, `expected the full template set, got ${rendered.length}`);
});

test('no email depends on a CSS class', () => {
  const offenders = rendered
    .filter(([, mail]) => /class="/.test(mail.html))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], 'a class is a dependency on a <style> block that '
    + `clients strip; these still carry one: ${offenders.join(', ')}`);
});

test('no email ships a <style> block', () => {
  const offenders = rendered
    .filter(([, mail]) => /<style[\s>]/i.test(mail.html))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `templates with a style block: ${offenders.join(', ')}`);
});

test('every email wears the same plate chrome', () => {
  for (const [name, mail] of rendered) {
    // Header plate, body plate, footer plate — DESIGN_SYSTEM 3.1 anatomy.
    assert.match(mail.html, /background-color:#1a1a1a; border-radius:4px;/, `${name}: header/footer plate`);
    assert.match(mail.html, /background-color:#111111; border-radius:4px;/, `${name}: body plate`);
    assert.match(mail.html, /letter-spacing:0\.34em; color:#d8d8de/, `${name}: the wordmark`);
    assert.match(mail.html, /\/impressum/, `${name}: the footer's legal links`);
    assert.match(mail.html, /<table role="presentation"/, `${name}: tables, so Outlook renders it`);
    assert.doesNotMatch(mail.html, /display:\s*flex|display:\s*grid/, `${name}: no flex/grid in email`);
    assert.doesNotMatch(mail.html, /<svg/i, `${name}: no SVG — Outlook will not draw it`);
    assert.doesNotMatch(mail.html, /<img[^>]+src="https?:/i,
      `${name}: no remote image — most clients block them by default`);
  }
});

test('every call to action is a table-cell button, not a styled anchor', () => {
  // A cell carries the background; the anchor repeats the padding, because
  // Outlook ignores padding on an inline element.
  const withCta = rendered.filter(([, mail]) => /Choose a new password|Confirm this address|Top up|Download the update|Open the thread|Read the full answer|View the thread|Open in Stripe/.test(mail.html));
  assert.ok(withCta.length >= 6, `expected most templates to have a CTA, found ${withCta.length}`);
  for (const [name, mail] of withCta) {
    assert.match(mail.html, /<td align="center" style="background-color:#f2f2f5; border-radius:4px;">/,
      `${name}: the CTA background must be on the CELL`);
    assert.match(mail.html, /<a href="[^"]+" style="display:block; padding:11px 22px;/,
      `${name}: the CTA anchor must carry its own padding`);
  }
});

test('a security link is also shown as text, because a button hides where it goes', () => {
  for (const name of ['password_reset', 'email_verification']) {
    const mail = templates[name](SAMPLE);
    assert.match(mail.html, /Or paste this into your browser/, `${name}: no visible URL`);
  }
});

test('the reset mail says what the link can do and what to do if it was not requested', () => {
  const mail = templates.password_reset(SAMPLE);
  assert.match(mail.html, /expires in 1 hour/);
  assert.match(mail.html, /treat it like the password itself/);
  assert.match(mail.html, /If you did not ask for this/);
  assert.doesNotMatch(mail.html, /\bclass=/);
});

/*
 * The receipt is the document a customer files. Two things were wrong on it:
 * it printed `$` while every price is EUR, and it claimed to be "your receipt
 * for tax purposes" while showing no VAT line and no reason for its absence.
 * docs/TAX-POSTURE.md is explicit that the second is not optional.
 */
test('the receipt names the configured currency, not dollars', () => {
  const mail = templates.receipt(SAMPLE);
  assert.match(mail.html, /€24\.00/, 'EUR is the configured billing currency');
  assert.doesNotMatch(mail.html, /\$24\.00/, 'a receipt in the wrong currency is a bookkeeping error');
});

test('the receipt explains why it carries no VAT line', () => {
  const mail = templates.receipt(SAMPLE);
  assert.match(mail.html, /§ 19 Abs\. 1 Umsatzsteuergesetz|&sect; 19 Abs\. 1 Umsatzsteuergesetz/,
    'an invoice with no VAT line and no explanation is indistinguishable from one where '
    + 'the VAT was simply left off (docs/TAX-POSTURE.md)');
});

test('every rendered email has a subject an inbox can show', () => {
  for (const [name, mail] of rendered) {
    assert.ok(mail.subject && mail.subject.trim().length > 0, `${name}: no subject`);
    assert.ok(mail.subject.length <= 90, `${name}: subject too long to read in a list`);
  }
});

test('the preheader is set, so the inbox preview is not the wordmark', () => {
  for (const [name, mail] of rendered) {
    const m = /<div style="display:none; max-height:0; overflow:hidden; opacity:0;">([\s\S]*?)<\/div>/.exec(mail.html);
    assert.ok(m, `${name}: no preheader slot`);
    assert.ok(m[1].trim().length > 0, `${name}: the preheader is empty, so the preview line `
      + 'fills with whatever text comes first — which is the wordmark');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSupport, supportBodyHtml, renderSupportBody } from './lib/support-page.mjs';

/*
 * What this gate is FOR.
 *
 * /support is handed to Stripe and to card-network partners, whose stated rule
 * is that "placeholder or under-construction sites aren't supported". Every
 * other prerendered route on this site injects <head> only — a correct title
 * over an empty <div id="root"> — which is indistinguishable from an unfinished
 * page to anything that does not run JavaScript.
 *
 * So these assert the OUTCOME: the bytes a crawler receives. Not that a
 * generator exists, not that a route is registered — a mechanism test passes in
 * a world where nothing calls it, and this repo has shipped that failure
 * repeatedly. Each assertion below fails if the answers stop reaching the HTML.
 */

const support = await loadSupport();
const body = supportBodyHtml(support);

test('the support body carries real answers, not just a heading', () => {
  // Every authored answer must appear. A dropped section is the silent failure.
  assert.equal(
    (body.match(/<h3>/g) || []).length,
    support.SUPPORT_ITEM_COUNT,
    'every authored question must render',
  );
  assert.ok(support.SUPPORT_ITEM_COUNT >= 12, 'the page must actually answer things');

  // Text, not just structure: prose from the answers has to be in the bytes.
  for (const section of support.SUPPORT_SECTIONS) {
    for (const item of section.items) {
      assert.ok(body.includes(item.q.replace(/&/g, '&amp;')), `question missing: ${item.q}`);
      const first = item.a[0].slice(0, 40).replace(/&/g, '&amp;');
      assert.ok(body.includes(first), `answer text missing for: ${item.q}`);
    }
  }
});

test('required coverage is anchored OUTSIDE the content module', () => {
  /*
   * Every other assertion here iterates SUPPORT_SECTIONS and compares against
   * SUPPORT_ITEM_COUNT — both derived from the same module, so deleting a whole
   * section reduces both consistently and passes. Verified: that mutation slipped
   * through until this test existed.
   *
   * So the required topics are listed HERE, independently. These are the
   * questions a payment partner or a stuck customer actually arrives with; a
   * section disappearing is a regression, not an editorial choice.
   */
  for (const id of ['charges', 'account', 'downloads', 'products', 'privacy']) {
    assert.ok(
      support.SUPPORT_SECTIONS.some((s) => s.id === id),
      `required support section missing: ${id}`,
    );
  }
  for (const [topic, needle] of [
    ['the statement descriptor', new RegExp(support.STATEMENT_DESCRIPTOR_LONG)],
    ['cancelling a subscription', /cancel/i],
    ['refunds', /refund/i],
    ['why no VAT is charged', /Kleinunternehmer/],
    ['the unsigned-installer warning', /SmartScreen/],
    ['model training consent', /train/i],
    ['reporting a vulnerability', /vulnerability/i],
  ]) {
    assert.match(body, needle, `the page must still answer: ${topic}`);
  }
});

test('the charge question — the reason this URL exists — is answerable without JS', () => {
  // Someone arriving from a bank statement must find the descriptor and a
  // contact address in the HTML itself.
  /* Assert the SHAPE and that both reach the page, never a frozen literal. The
   * descriptor legitimately changes (XENOSTUDIO -> XENOSYSTEM, 2026-09-11 when it
   * moved to the trading name), and a test pinning yesterday's value fails on the
   * day it is corrected rather than the day it breaks. What must hold: a real
   * descriptor is exported, and it actually reaches the page a cardholder reads.
   * The values themselves come from Stripe - see the note in content/support.ts. */
  for (const key of ['STATEMENT_DESCRIPTOR', 'STATEMENT_DESCRIPTOR_LONG']) {
    const value = support[key];
    assert.match(value ?? '', /^[A-Z0-9 *.-]{2,22}$/, `${key} must be a card-statement string`);
    assert.ok(body.includes(value), `${key} (${value}) must appear on the page`);
  }
  assert.ok(body.includes(`mailto:${support.SUPPORT_EMAIL}`), 'a contact address must be reachable');
  assert.match(body, /dispute/i, 'it must tell the reader they need not go to their bank first');
});

test('statutory and policy claims are linked, never restated', () => {
  // The withdrawal instruction is prescribed wording; reproducing it loosely is
  // what loses the safe harbour. Link to it, do not paraphrase it here.
  assert.ok(body.includes('/withdrawal'), 'the withdrawal page must be linked');
  assert.ok(body.includes('/impressum'), 'the Impressum must be linked');
  assert.ok(body.includes('/privacy'), 'the privacy policy must be linked');
  // Naming it in a LINK LABEL is correct and stays. What must never appear is
  // the prescribed wording itself — the model form and its operative sentences.
  // Reproducing that loosely is precisely how the safe harbour is lost, and the
  // authored page carries a header saying so.
  for (const statutory of [
    'Muster-Widerrufsformular',
    'hiermit widerrufe',
    'Wenn Sie diesen Vertrag widerrufen',
    'Sie haben das Recht, binnen vierzehn Tagen',
  ]) {
    assert.ok(
      !body.toLowerCase().includes(statutory.toLowerCase()),
      `statutory wording must be linked, not restated: "${statutory}"`,
    );
  }
});

test('the body is injected into the shell, replacing the empty root', () => {
  const shell = '<html><head></head><body><div id="root"></div></body></html>';
  const out = renderSupportBody(shell, body);
  assert.ok(!out.includes('<div id="root"></div>'), 'the empty root must be gone');
  assert.ok(out.includes('<div id="root"><main>'), 'content must sit inside the root');
  // A shell that changed shape must fail loudly rather than silently emit a
  // page with no body — that is the exact regression this page cannot afford.
  assert.throws(() => renderSupportBody('<div id="app"></div>', body), /#root placeholder not found/);
});

test('the prerender actually emits /support, and the React page shares the source', () => {
  // Reachability: a generator nothing calls is the recurring failure here.
  const prerender = readFileSync(new URL('./prerender-products.mjs', import.meta.url), 'utf8');
  const call = prerender.slice(prerender.indexOf("writePage('support'"));
  assert.ok(call.startsWith("writePage('support'"), '/support must be emitted');
  assert.match(call.slice(0, 400), /renderSupportBody\(/, 'it must inject the body, not head only');
  assert.match(call.slice(0, 400), /supportBodyHtml\(support\)/, 'from the shared generator');

  // One source: the React page must render the content module, not its own copy.
  const page = readFileSync(new URL('../src/pages/Support.tsx', import.meta.url), 'utf8');
  assert.match(page, /from '\.\.\/content\/support'/, 'the page must read the shared content module');
  assert.ok(
    !/q: '|question: '/.test(page),
    'answers belong in src/content/support.ts, never inlined in the page',
  );
});

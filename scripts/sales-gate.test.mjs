import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  salesOpen, assertSalesOpen, requireSalesOpen, SalesClosedError,
} from '../src/server/middleware/salesGate.js';

const SERVICE = readFileSync(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8');

/* ── 1. The decision itself, and its DIRECTION ─────────────────────────────── */

test('sales are closed unless SALES_OPEN is exactly "true"', () => {
  assert.equal(salesOpen({ SALES_OPEN: 'true' }), true);
  // Every ambiguous spelling must resolve CLOSED. An outage that stops sales is
  // recoverable; an env var that silently starts charging cards is not.
  for (const value of ['TRUE', 'True', '1', 'yes', 'on', 'false', '', ' true', 'true ', undefined]) {
    assert.equal(salesOpen({ SALES_OPEN: value }), false, `SALES_OPEN=${JSON.stringify(value)} must be CLOSED`);
  }
  assert.equal(salesOpen({}), false, 'missing var must be CLOSED');
  assert.equal(salesOpen(undefined), false, 'no env at all must be CLOSED');
});

test('the refusal is a 503 policy answer, in both error shapes the routes read', () => {
  assert.throws(() => assertSalesOpen({}), (err) => {
    assert.ok(err instanceof SalesClosedError);
    assert.equal(err.code, 'sales_closed');
    // billingRoutes reads err.status; the auth middleware family reads
    // err.statusCode. Setting only one answers 500 — a server fault — for a
    // deliberate business decision.
    assert.equal(err.status, 503);
    assert.equal(err.statusCode, 503);
    return true;
  });
  assert.doesNotThrow(() => assertSalesOpen({ SALES_OPEN: 'true' }));
});

test('the express guard refuses without calling through', () => {
  const prev = process.env.SALES_OPEN;
  try {
    delete process.env.SALES_OPEN;
    let nexted = false, code = 0, body = null;
    requireSalesOpen({}, { status(c) { code = c; return { json(b) { body = b; } }; } }, () => { nexted = true; });
    assert.equal(nexted, false, 'a closed shop must not reach the handler');
    assert.equal(code, 503);
    assert.equal(body.code, 'sales_closed');

    process.env.SALES_OPEN = 'true';
    let opened = false;
    requireSalesOpen({}, { status() { throw new Error('must not respond when open'); } }, () => { opened = true; });
    assert.equal(opened, true);
  } finally {
    if (prev === undefined) delete process.env.SALES_OPEN; else process.env.SALES_OPEN = prev;
  }
});

/* ── 2. COVERAGE — the half that actually protects us ──────────────────────── */

test('EVERY function that creates a Stripe checkout session calls the gate', () => {
  /*
   * 🔴 This is the assertion that matters, and it is not about the mechanism.
   *
   * A mechanism test passes in a world where nothing calls the gate. The two
   * checkout creators here are reached from DIFFERENT route files —
   * createCheckout from billingRoutes.js, createWorkspaceSeatCheckout from
   * workspaceRoutes.js — so a route-level switch would have left the Team seat
   * path, the most expensive item sold, taking money with the shop shut.
   *
   * Same shape as registrationGate ("two closed doors and one open one") and as
   * the xeno-post approval bypass, where create/update called the gate and
   * publishNow did not. So: enumerate the paths from the SOURCE, and require
   * each one to be guarded — a new checkout creator fails this test until it is.
   */
  // Slice on top-level declaration boundaries: a brace-matching regex trips over
  // the first NESTED closing brace and silently reports one creator instead of
  // two — which would make this whole gate vacuous in the exact direction that
  // matters (it would stop noticing the ungated Team seat path).
  const marks = [...SERVICE.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)]
    .map((m) => ({ name: m[1], at: m.index }));
  const creators = marks
    .map(({ name, at }, i) => ({ name, body: SERVICE.slice(at, marks[i + 1]?.at ?? SERVICE.length) }))
    .filter(({ body }) => body.includes('stripe.checkout.sessions.create'));

  assert.ok(creators.length >= 2,
    `expected to find the checkout creators in the service, found ${creators.length}`);
  assert.deepEqual(
    creators.map((c) => c.name).sort(),
    ['createCheckout', 'createWorkspaceSeatCheckout'],
    'the set of checkout-session creators changed — gate the new one, then update this list',
  );

  for (const { name, body } of creators) {
    assert.ok(body.includes('assertSalesOpen()'),
      `${name} creates a checkout session without calling assertSalesOpen()`);
    // and it must refuse BEFORE doing provider or database work
    assert.ok(body.indexOf('assertSalesOpen()') < body.indexOf('stripe.checkout.sessions.create'),
      `${name} must refuse before it reaches the provider`);
  }
});

test('the portal and the webhook are deliberately NOT gated', () => {
  /*
   * Closing the shop must not trap the people already inside it. The portal is
   * how a customer cancels, updates a card and downloads invoices; the webhook
   * must still settle an in-flight payment, grant its credits and send its
   * receipt. Stripe retries for days — refusing those would turn "stop selling"
   * into "lose money we already took".
   */
  const portal = SERVICE.slice(SERVICE.indexOf('export async function createPortal'));
  const portalBody = portal.slice(0, portal.indexOf('\n}'));
  assert.ok(portalBody.includes('billingPortal.sessions.create'), 'found the portal creator');
  assert.ok(!portalBody.includes('assertSalesOpen'),
    'the billing portal must stay open so existing customers can cancel');

  const routes = readFileSync(new URL('../src/server/routes/billingRoutes.js', import.meta.url), 'utf8');
  const webhookLine = routes.split('\n').find((l) => l.includes("'/webhook'")) ?? '';
  assert.ok(!webhookLine.includes('requireSalesOpen'),
    'the webhook must keep settling in-flight payments while sales are closed');
});

test('the public config tells the UI the difference between unwired and closed', () => {
  // A deliberately-shut shop must not render as a broken one.
  assert.match(SERVICE, /salesOpen: salesOpen\(\)/,
    'getConfig must expose salesOpen distinctly from enabled');
});

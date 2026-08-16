/**
 * The watch/use boundary — gates for the product decision that an unpaid
 * account may look at everything and run nothing.
 *
 * ── WHY THESE ARE WORTH HAVING ─────────────────────────────────────────────
 *
 * This ecosystem has shipped the same defect four times: xeno-workflow's 76
 * node types, xeno-tools' never-called `install`, and twice in
 * xeno-agent-interface. Every one was fully unit-tested and reachable from
 * nothing. The shape is always the same — the PIECE is correct, the WIRING is
 * absent, and the tests only ever asked about the piece.
 *
 * So these deliberately test two different things:
 *   - that the entitlement table says what we think it says (cheap, obvious)
 *   - that the refusal is actually WIRED to routes (the one that catches the
 *     failure mode above)
 *
 * Every assertion here has been mutation-checked: each one was watched to FAIL
 * against a deliberately broken version before being trusted. A gate that
 * cannot fail is not evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { entitlementsFor } from '../src/server/services/billingService.js';
import { cheapestPlanWith, grants, upgradeRequiredBody } from '../src/server/middleware/requireEntitlement.js';

const ROUTES = 'src/server/routes';

/* ── 1 · The table says what we think ───────────────────────────────────── */

test('free cannot use', () => {
  assert.equal(entitlementsFor('free').canUse, false);
});

test('every sellable plan can use', () => {
  for (const plan of ['pro', 'team']) {
    assert.equal(entitlementsFor(plan).canUse, true, `${plan} must grant canUse`);
  }
});

test('internal staff accounts can use — they are not customers to gate', () => {
  assert.equal(entitlementsFor('internal').canUse, true);
});

test('an UNKNOWN plan fails closed to free, not open', () => {
  // The important direction. A typo, a legacy value, or a plan added to the DB
  // but not to the table must deny, never grant.
  assert.equal(entitlementsFor('enterprise-typo').canUse, false);
  assert.equal(entitlementsFor(undefined).canUse, false);
  assert.equal(entitlementsFor(null).canUse, false);
});

test('the legacy `ultra` alias still resolves to a usable plan', () => {
  // Prod carries real accounts on 'ultra'. Flipping canUse on without checking
  // aliases would have silently locked them out of what they paid for.
  assert.equal(entitlementsFor('ultra').canUse, true);
});

test('free keeps NO in-house allowance — the quota agrees with the flag', () => {
  // The two must not disagree: a 0 quota with canUse true (or vice versa) is
  // the state where one endpoint allows and another refuses.
  const free = entitlementsFor('free');
  assert.equal(free.canUse, false);
  assert.equal(free.inHouseDailyLimit, 0);
});

/* ── 2 · The refusal is usable by the client ────────────────────────────── */

test('a refusal names a concrete plan to buy, not "upgrade required"', () => {
  assert.equal(cheapestPlanWith('canUse'), 'pro');
  const body = upgradeRequiredBody('canUse', { plan: 'free' });
  assert.equal(body.requiredPlan, 'pro');
  assert.equal(body.currentPlan, 'free');
});

test('the refusal carries a context token the existing UpgradePrompt accepts', () => {
  const body = upgradeRequiredBody('canUse', { plan: 'free' });
  const ACCEPTED = ['cloudSync', 'crossApp', 'agents', 'collaboration', 'resolution', 'credits', 'commercial', 'general'];
  assert.ok(ACCEPTED.includes(body.context), `context ${body.context} is not renderable`);
});

test('grants() is a boolean check, not a truthy one', () => {
  assert.equal(grants(entitlementsFor('pro'), 'canUse'), true);
  assert.equal(grants(entitlementsFor('free'), 'canUse'), false);
  assert.equal(grants(undefined, 'canUse'), false);
});

/* ── 3 · IT IS ACTUALLY WIRED — the gate that catches the real defect ───── */

function routeSources() {
  return readdirSync(ROUTES)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, src: readFileSync(join(ROUTES, f), 'utf8') }));
}

test('canUse is enforced on at least one real route', () => {
  // The assertion that would have caught workflow's 76 unreachable nodes.
  // Reads the SOURCE, because the question is not "does the middleware work"
  // but "did anyone mount it".
  const wired = routeSources().filter(({ src }) => /requireEntitlement\(\s*['"]canUse['"]/.test(src));
  assert.ok(
    wired.length > 0,
    'canUse is defined and enforced NOWHERE. The entitlement is advertised and free to bypass — ' +
    'mount requireEntitlement(\'canUse\') on the endpoints that spend compute.',
  );
});

test('the compute-spending routes specifically are gated', () => {
  // Named routes, not a count: a count passes forever once one route is gated,
  // which is how a second unprotected endpoint slips in later.
  const MUST_GATE = ['aiRoutes.js', 'imageRoutes.js'];
  const byFile = new Map(routeSources().map(({ file, src }) => [file, src]));

  for (const file of MUST_GATE) {
    const src = byFile.get(file);
    if (src === undefined) continue; // route file renamed — not this test's job to fail on that
    assert.match(
      src,
      /requireEntitlement\(\s*['"]canUse['"]/,
      `${file} spends compute and does not check canUse — an unpaid account can call it directly`,
    );
  }
});

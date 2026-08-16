/**
 * The catalog's `status` must agree with what is actually published.
 *
 * `productCatalog.status` is a hand-maintained CLAIM. `releaseStatus.json` is a
 * MEASUREMENT taken from the real release feeds. When they disagree, the claim
 * is the thing that went stale — a 200 does not rot, a comment does.
 *
 * This gate is deliberately OFFLINE: it compares the committed manifest, so it
 * is deterministic and runs without a network. A test that hit R2 live would
 * fail on a plane, get labelled flaky, and then be ignored on the day it is
 * right. Refresh the measurement explicitly:
 *
 *     node scripts/probe-release-status.mjs
 *
 * It also fails when the manifest itself goes stale, because a measurement
 * nobody has retaken is just a slower claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('src/lib/releaseStatus.json', 'utf8'));
const products = manifest.products || {};

/* Declared exceptions — cases where the catalog deliberately disagrees with a
 * published artifact, each with a stated reason and a retirement condition.
 *
 * ⚠️ This is not a mute button. It exists because "a release is published"
 * turned out NOT to imply "the claim is stale": 3d, architect and engine all
 * serve real v0.1.0 installers whose own notes describe a UI scaffold with a
 * placeholder viewport. The artifact is real; the product is not, and
 * `coming-soon` is the honest line. Recording that beats both silently
 * failing the build and silently advertising a shell.
 *
 * An entry without a reason and a retireWhen is rejected below, so the cost of
 * adding one is having to justify it. */
const exceptions = JSON.parse(readFileSync('src/lib/releaseExceptions.json', 'utf8')).acknowledged || {};

const MAX_AGE_DAYS = 30;

test('the manifest has been measured at all', () => {
  assert.ok(manifest.checkedAt, 'releaseStatus.json has no checkedAt stamp');
  assert.ok(Object.keys(products).length >= 25, `only ${Object.keys(products).length} products measured`);
});

test('the measurement is not stale', () => {
  const ageDays = (Date.now() - Date.parse(manifest.checkedAt)) / 86_400_000;
  assert.ok(
    ageDays <= MAX_AGE_DAYS,
    `releaseStatus.json is ${Math.round(ageDays)} days old (max ${MAX_AGE_DAYS}). ` +
    'Re-run: node scripts/probe-release-status.mjs',
  );
});

test('no product claims coming-soon while serving a real release', () => {
  // The direction that is always a fact: something IS published, so the claim
  // is wrong. This found 3d, architect and engine on the first run.
  const stale = Object.entries(products)
    .filter(([slug, r]) => r.catalogStatus === 'coming-soon' && r.released === true && !exceptions[slug])
    .map(([slug, r]) => `${slug} (published ${r.version || 'live'})`)
    .sort();

  assert.deepEqual(
    stale, [],
    'Products marked coming-soon in productCatalog.ts that have a REAL published ' +
    `release: ${stale.join(', ')}. The catalog is stale — update its status.`,
  );
});

test('no product claims released while its own feed is empty', () => {
  // Only asserted where a feed EXISTS and is empty. `released: null` means the
  // probe could not reach a channel that applies (xeno-rt ships as a public
  // Rust repo with no R2 feed), and unknown must never become an accusation.
  const overclaimed = Object.entries(products)
    .filter(([, r]) => r.catalogStatus !== 'coming-soon' && r.released === false)
    .map(([slug, r]) => `${slug} (${r.source})`)
    .sort();

  assert.deepEqual(overclaimed, [], `Products claiming a status they cannot back: ${overclaimed.join(', ')}`);
});

test('every declared exception is justified and still applies', () => {
  for (const [slug, e] of Object.entries(exceptions)) {
    // An exception with no reasoning is a mute button with extra steps.
    assert.ok(e.reason, `exception for ${slug} has no reason`);
    assert.ok(e.retireWhen, `exception for ${slug} has no retirement condition`);

    // An exception for a product that no longer drifts is dead weight, and it
    // would silently absorb a REAL regression on that slug later.
    const r = products[slug];
    assert.ok(r, `exception for ${slug}, which is not in the manifest`);
    assert.ok(
      r.catalogStatus === 'coming-soon' && r.released === true,
      `exception for ${slug} no longer applies (catalog=${r.catalogStatus}, released=${r.released}) — remove it`,
    );
  }
});

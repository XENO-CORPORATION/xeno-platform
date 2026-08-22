/**
 * Every product on the workspace cards has its own mark.
 *
 * The suite cards list products as a two-column icon grid. A product with no
 * dedicated icon falls back to a generic one — which is the right RUNTIME
 * behaviour (a missing glyph must never take down the first screen a new
 * account sees) and exactly why it needs a test: the fallback is silent, so
 * a product shipping without artwork looks fine and just reads as duller.
 *
 * This is the same shape as the suite-coverage gate: derived UI cannot tell
 * you when the catalog has outgrown it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = readFileSync('src/lib/productCatalog.ts', 'utf8');
const icons = readFileSync('src/lib/productIcons.tsx', 'utf8');
const suites = readFileSync('src/lib/workspaceSuites.ts', 'utf8');

/**
 * Slugs of every product that appears on a workspace card.
 *
 * ⚠️ Includes `coming-soon`. The cards used to filter those out and this
 * matcher was written to match — then the cards started SHOWING them (marked
 * "Soon", so the workspace's real scope is visible) and this gate silently
 * stopped covering eleven products. They rendered the generic fallback mark
 * and nothing failed, which is precisely the blind spot this file exists to
 * close. A gate scoped to yesterday's behaviour is worse than no gate: it
 * reports green over the thing it stopped watching.
 */
function cardSlugs() {
  const claimed = new Set();
  const block = suites.slice(suites.indexOf('export const SUITES'));
  for (const m of block.matchAll(/categories:\s*\[([^\]]+)\]/g)) {
    for (const c of m[1].matchAll(/'([^']+)'/g)) claimed.add(c[1]);
  }
  const out = [];
  for (const line of catalog.split('\n')) {
    if (!line.includes('slug:') || !line.includes('category:')) continue;
    const cat = line.match(/category:\s*'([^']+)'/)?.[1];
    const slug = line.match(/slug:\s*'([^']+)'/)?.[1];
    if (slug && cat && claimed.has(cat)) out.push(slug);
  }
  /* Suite `extras` are members that are NOT catalog products — Forum lives at
   * /forum with no repo or installer, so it has no catalog row. It still
   * renders on a card, so it still needs a mark, and the reverse assertion
   * below would otherwise flag its icon as dead. */
  for (const m of suites.matchAll(/slug:\s*'([^']+)',\s*name:/g)) out.push(m[1]);
  return out;
}

function mappedSlugs() {
  const block = icons.slice(icons.indexOf('export const PRODUCT_ICON'), icons.indexOf('/** The mark for a product'));
  return new Set([...block.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*</gm)].map((m) => m[1]));
}

test('the parser found something — this gate can fail', () => {
  assert.ok(cardSlugs().length >= 25, `parsed only ${cardSlugs().length} card products — matcher is stale`);
  assert.ok(mappedSlugs().size >= 15, `parsed only ${mappedSlugs().size} icon entries — matcher is stale`);
});

test('every product shown on a workspace card has its own icon', () => {
  const mapped = mappedSlugs();
  const missing = cardSlugs().filter((s) => !mapped.has(s)).sort();
  assert.deepEqual(
    missing, [],
    `Products on a workspace card with no icon in productIcons.tsx: ${missing.join(', ')}. ` +
    'They render a generic mark — silently, which is why this test exists.',
  );
});

test('no icon is mapped for a product that is not shown', () => {
  // Dead entries are harmless but they rot: the next person assumes the map is
  // authoritative and wonders why a product with an icon never appears.
  const shown = new Set(cardSlugs());
  const dead = [...mappedSlugs()].filter((s) => !shown.has(s)).sort();
  assert.deepEqual(dead, [], `productIcons.tsx maps slugs no card shows: ${dead.join(', ')}`);
});

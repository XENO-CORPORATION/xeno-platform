/**
 * Workspace suite gates.
 *
 * The workspace chooser is the first screen a new account sees and the answer
 * decides how the platform lays itself out. Its content is DERIVED from the
 * product catalog, which is the right design — but it means the catalog can
 * silently break it.
 *
 * The failure that matters: somebody adds a product in a NEW category, no
 * suite claims that category, and the product vanishes from onboarding. Every
 * other test still passes, the page still renders, and the only symptom is
 * that a product nobody can find. These assert the mapping is total.
 *
 * Read as SOURCE rather than importing the TSX: this file is plain Node, the
 * catalog is TypeScript, and a build step to run one assertion is not worth
 * the coupling. The parse is deliberately narrow and fails loudly if the shape
 * it expects is gone — a gate that silently matches nothing is worse than none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogSrc = readFileSync('src/lib/productCatalog.ts', 'utf8');
const suitesSrc = readFileSync('src/lib/workspaceSuites.ts', 'utf8');

/** Categories of every product that is not `coming-soon`. */
function catalogCategories() {
  const cats = new Set();
  // Each product is one `{ ... }` literal on its own line in PRODUCTS.
  for (const line of catalogSrc.split('\n')) {
    if (!line.includes('slug:') || !line.includes('category:')) continue;
    if (/status:\s*'coming-soon'/.test(line)) continue;
    const m = line.match(/category:\s*'([^']+)'/);
    if (m) cats.add(m[1]);
  }
  return cats;
}

/** Categories claimed by the SUITES table. */
function claimedCategories() {
  const claimed = new Set();
  const block = suitesSrc.slice(suitesSrc.indexOf('export const SUITES'));
  for (const m of block.matchAll(/categories:\s*\[([^\]]+)\]/g)) {
    for (const c of m[1].matchAll(/'([^']+)'/g)) claimed.add(c[1]);
  }
  return claimed;
}

test('the parse actually found something — the gate can fail', () => {
  // Guards the gates below. If the catalog's shape changes, both sets go empty
  // and every assertion trivially passes; this is what stops that.
  assert.ok(catalogCategories().size >= 5, 'parsed too few catalog categories — the matcher is stale');
  assert.ok(claimedCategories().size >= 4, 'parsed too few suite categories — the matcher is stale');
});

test('every shipping category belongs to exactly one suite', () => {
  const present = catalogCategories();
  const claimed = claimedCategories();
  const unmapped = [...present].filter((c) => !claimed.has(c)).sort();

  assert.deepEqual(
    unmapped, [],
    `Categories in the catalog that no workspace suite claims: ${unmapped.join(', ')}. ` +
    'Every product in them is INVISIBLE in onboarding — add them to a suite in ' +
    'src/lib/workspaceSuites.ts.',
  );
});

test('no suite claims a category that does not exist', () => {
  const present = catalogCategories();
  const claimed = claimedCategories();
  // The other direction: a renamed category leaves a suite pointing at nothing,
  // which shrinks that card without any error.
  const dangling = [...claimed].filter((c) => !present.has(c)).sort();

  assert.deepEqual(
    dangling, [],
    `Suites claim categories with no shipping products: ${dangling.join(', ')}. ` +
    'Either the category was renamed in productCatalog.ts or its products are all coming-soon.',
  );
});

test('a category is claimed by only ONE suite', () => {
  // Overlap would show the same product in two workspaces and double-count it
  // in the "N products" line, which is the number people compare cards on.
  const seen = new Map();
  const block = suitesSrc.slice(suitesSrc.indexOf('export const SUITES'));
  const ids = [...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  const lists = [...block.matchAll(/categories:\s*\[([^\]]+)\]/g)]
    .map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((c) => c[1]));

  lists.forEach((cats, i) => {
    for (const c of cats) {
      assert.ok(!seen.has(c), `category "${c}" is claimed by both ${seen.get(c)} and ${ids[i]}`);
      seen.set(c, ids[i]);
    }
  });
});

test('the everything id is distinct from every suite id', () => {
  // `everything` is stored in the same column as a suite id. A collision would
  // make "took the whole ecosystem" indistinguishable from one lane.
  const block = suitesSrc.slice(suitesSrc.indexOf('export const SUITES'));
  const ids = [...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  const everything = suitesSrc.match(/EVERYTHING_ID\s*=\s*'([^']+)'/)?.[1];

  assert.ok(everything, 'EVERYTHING_ID not found');
  assert.ok(!ids.includes(everything), `EVERYTHING_ID "${everything}" collides with a suite id`);
});

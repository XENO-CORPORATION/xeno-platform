/**
 * `src/content/docs/_slugs.ts` is a hand-written copy of a derived fact, and this
 * is the gate that stops it becoming a lie.
 *
 * It exists so that `/product/<slug>` can answer "does this product have docs?"
 * without importing sixteen content modules — roughly 500 KB of prose — to
 * evaluate one `!!`. The saving is real and the risk is the ordinary one: a
 * seventeenth product gets authored, added to `MODULES`, and the landing page
 * silently stops offering a Documentation link that exists.
 *
 * So the comparison runs in BOTH directions. A slug in the registry and not in
 * the list is a missing link; a slug in the list and not in the registry is a
 * link to a 404. Neither is worse than the other and neither is allowed.
 *
 * Both files are read as SOURCE rather than imported, for the same reason the
 * reachability gate reads the qualifier's suite list as text: importing
 * `content/docs/index.ts` pulls in every content module, which is the cost this
 * whole arrangement exists to avoid paying — including here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'src/content/docs/index.ts');
const SLUGS = path.join(ROOT, 'src/content/docs/_slugs.ts');

/** The registry's own answer: `MODULES` is the array the runtime maps by slug. */
function registrySlugs() {
  const source = fs.readFileSync(INDEX, 'utf8');

  const modules = source.match(/const MODULES:\s*ProductDocs\[\]\s*=\s*\[([^\]]*)\]/);
  assert.ok(modules, 'content/docs/index.ts no longer declares `const MODULES: ProductDocs[] = [...]` '
    + '— this gate reads that declaration, so it must be updated with the registry, not deleted');
  const identifiers = modules[1].split(',').map((s) => s.trim()).filter(Boolean);

  // Each identifier is a default import; the slug is the module's FILENAME, which
  // is what /docs/<slug> resolves against. Reading the import lines rather than
  // the content modules keeps this gate free of the 500 KB it is protecting.
  const imported = new Map();
  for (const line of source.split('\n')) {
    const m = line.match(/^import\s+([A-Za-z0-9_$]+)\s+from\s+'\.\/([^']+)';/);
    if (m) imported.set(m[1], m[2]);
  }
  return identifiers.map((id) => {
    assert.ok(imported.has(id), `MODULES names \`${id}\` but nothing imports it`);
    return imported.get(id);
  });
}

function declaredSlugs() {
  const source = fs.readFileSync(SLUGS, 'utf8');
  const list = source.match(/DOCUMENTED_SLUGS:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(list, 'content/docs/_slugs.ts no longer declares DOCUMENTED_SLUGS as a literal array');
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('the cheap slug list and the real docs registry name exactly the same products', () => {
  const registry = registrySlugs();
  const declared = declaredSlugs();

  assert.ok(registry.length >= 10,
    `only ${registry.length} products parsed out of the registry — the parse is broken, not the registry empty`);

  const missing = registry.filter((s) => !declared.includes(s));
  const extra = declared.filter((s) => !registry.includes(s));

  assert.deepEqual(missing, [],
    'these products have docs and _slugs.ts does not list them, so /product/<slug> will not offer a '
    + 'Documentation link to a section that exists: ' + missing.join(', '));
  assert.deepEqual(extra, [],
    '_slugs.ts lists these and the registry does not, so /product/<slug> would link to a docs 404: '
    + extra.join(', '));
});

test('_slugs.ts stays free of the imports it exists to avoid', () => {
  const source = fs.readFileSync(SLUGS, 'utf8');
  const imports = source.match(/^\s*import\s.+$/gm) || [];
  assert.deepEqual(imports, [],
    '_slugs.ts imported something. Its entire value is that importing it costs one array — '
    + 'an import here silently puts whatever it pulls back onto the product landing page.');
});

test('the landing page asks the cheap module, not the registry', () => {
  /* The measurement that started this: the entry chunk carried every
   * src/content/docs/*.ts module because ProductLanding imported
   * `getProductDocs` from the registry to evaluate `!!`. A future edit that
   * reaches for the registry again would restore ~500 KB without any test
   * noticing, because the page would still work perfectly. */
  const landing = fs.readFileSync(path.join(ROOT, 'src/pages/ProductLanding.tsx'), 'utf8');
  assert.doesNotMatch(landing, /from '\.\.\/content\/docs'/,
    'ProductLanding must import from content/docs/_slugs, not from the docs registry — '
    + 'the registry pulls every content module onto the most-visited route on the site');
  assert.match(landing, /from '\.\.\/content\/docs\/_slugs'/,
    'ProductLanding should get its docs answer from the slug list');
});

// Gate: the owner's XO PRODUCTS designs are the product pages. Every design
// document the importer produced must exist, be self-contained (no CDN
// runtime, no design-file links, no xenostudio.ai link targets), and be the
// page nginx serves at /products and /product/<slug> behind the site gate.
// Removing an nginx rule, a document, or an SPA hand-off must fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const onDisk = (p) => existsSync(new URL(`../${p}`, import.meta.url));

test('every product design document is vendored and self-contained', () => {
  const slugs = readdirSync(new URL('../public/product-pages', import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.ok(slugs.length >= 45, `expected 45+ design pages, got ${slugs.length}`);
  assert.ok(onDisk('public/product-pages/index.html'), 'the /products index design');
  const runtime = read('public/products-v2/support.js');
  assert.doesNotMatch(runtime, /unpkg\.com/, 'runtime must not load React/Babel from a CDN');
  for (const slug of [...slugs, 'index']) {
    const doc = read(slug === 'index' ? 'public/product-pages/index.html' : `public/product-pages/${slug}/index.html`);
    assert.match(doc, /<title>XENO [^<]+ — XENOsystem<\/title>/, slug);
    assert.match(doc, /src="\/products-v2\/support\.js"/, slug);
    assert.match(doc, /data-marketing-header="1"/, slug);
    assert.match(doc, /src="\/site\/marketing-header\.js"/, slug);
    assert.match(doc, /href="\/site\/marketing-header\.css"/, slug);
    assert.doesNotMatch(doc.match(/<header\b[\s\S]*?<\/header>/)?.[0] || '', /href="#"/, `${slug}: no header placeholders`);
    assert.doesNotMatch(doc.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] || '', /href="#"/, `${slug}: no footer placeholders`);
    assert.doesNotMatch(doc, /\.dc\.html/, `${slug}: design cross-links must be rewritten to /product/<slug>`);
    assert.doesNotMatch(doc, /["'(]https?:\/\/xenostudio\.ai/, `${slug}: self-links must be this host's paths`);
    assert.doesNotMatch(doc, /updates\.xenostudio\.ai\/apps\//, `${slug}: raw installer URLs bypass the download gate`);
    const assets = [...new Set([...doc.matchAll(/\/products-v2\/[A-Za-z0-9_./-]+/g)].map((m) => m[0]))];
    for (const a of assets) assert.ok(onDisk(`public${a}`), `${slug}: ${a} must exist`);
  }
});

test('nginx serves the designs at /products and bare /product/<slug>, gated; subroutes untouched', () => {
  const nginx = read('nginx/default.conf');
  const idx = nginx.match(/location = \/products \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(idx, /auth_request \/__site_gate;/);
  assert.match(idx, /try_files \/product-pages\/index\.html =404;/);
  const bare = nginx.match(/location ~ \^\/product\/\(\?<product_v2_slug>\[\^\/\]\+\)\/\?\$ \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(bare, /auth_request \/__site_gate;/, 'design pages stay behind the site gate');
  assert.match(bare, /try_files \/product-pages\/\$product_v2_slug\/index\.html \/product\/\$product_v2_slug\/index\.html @spa_shell;/,
    'design first, then the prerendered React page, then the SPA shell');
  assert.match(nginx, /location \^~ \/products-v2\/ \{/);
  assert.match(nginx, /location \^~ \/site\/ \{[\s\S]*?Cache-Control "no-cache"/);
  // Download/release sub-addresses keep their own routes (not the bare-slug pattern).
  assert.match(nginx, /location ~ \^\/product\/\[\^\/\]\+\/download\//);
});

test('the SPA hands design addresses to nginx and keeps the rest', () => {
  const generated = read('src/lib/productDesigns.ts');
  const listed = [...generated.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const onDiskSlugs = readdirSync(new URL('../public/product-pages', import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(listed, onDiskSlugs, 'productDesigns.ts must match the documents on disk');
  // The sound/audio pair is the easy mapping to get wrong: XENO Sound is the
  // desktop editor (sound); XENO Audio (audio) has no design and keeps its page.
  assert.ok(onDiskSlugs.includes('sound') && !onDiskSlugs.includes('audio'), 'sound has the design, audio does not');
  assert.match(read('src/pages/ProductPage.tsx'), /PRODUCT_DESIGN_SLUGS\.has\(slug\)/);
  assert.match(read('src/App.tsx'), /<Route path="\/products" element=\{<StaticDocRedirect to="\/products" \/>\} \/>/);
});

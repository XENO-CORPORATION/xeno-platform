// Gate: the owner's XO PRODUCTS designs are the product pages. Every design
// document the importer produced must exist, be self-contained (no CDN
// runtime, no design-file links, no xenostudio.ai link targets), and be the
// page nginx serves at /products and /product/<slug> behind the site gate.
// Removing an nginx rule, a document, or an SPA hand-off must fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const onDisk = (p) => existsSync(new URL(`../${p}`, import.meta.url));

test('every product design document is vendored and self-contained', () => {
  const slugs = readdirSync(new URL('../public/product-pages', import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.ok(slugs.length >= 45, `expected 45+ design pages, got ${slugs.length}`);
  assert.ok(onDisk('public/product-pages/index.html'), 'the /products index design');
  const runtime = read('public/products-v2/support.js');
  assert.doesNotMatch(runtime, /unpkg\.com/, 'runtime must not load React/Babel from a CDN');
  assert.match(runtime, /COMPONENT_DIR = "\/products-v2\/components"/);
  assert.ok(onDisk('public/products-v2/components/SuiteLoop.dc.html'));
  assert.doesNotMatch(read('public/products-v2/components/SuiteLoop.dc.html'), /href="[^"\n]*\.dc\.html"/);
  for (const slug of [...slugs, 'index']) {
    const doc = read(slug === 'index' ? 'public/product-pages/index.html' : `public/product-pages/${slug}/index.html`);
    assert.match(doc, /<title>XENO [^<]+ — XENOsystem<\/title>/, slug);
    assert.match(doc, /src="\/products-v2\/support\.js"/, slug);
    assert.match(doc, /data-marketing-header="1"/, slug);
    assert.match(doc, /src="\/site\/marketing-header\.js\?v=[a-f0-9]{16}"/, slug);
    assert.match(doc, /href="\/site\/marketing-header\.css\?v=[a-f0-9]{16}"/, slug);
    for (const extension of ['js', 'css']) {
      const version = createHash('sha256').update(read(`public/site/marketing-header.${extension}`)).digest('hex').slice(0, 16);
      assert.ok(doc.includes(`/site/marketing-header.${extension}?v=${version}`), `${slug}: asset version matches bytes`);
    }
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

test('the Spawn product design states what ships, not the concept it was written as', () => {
  // The design was authored before Spawn shipped. A re-import once restored the waitlist copy
  // ("documentation only", "nothing is installable") over a product whose installer is public.
  const html = read('public/product-pages/spawn/index.html');
  assert.match(html, /v0\.1\.0-rc\.45/, 'the design names the published version');
  assert.match(html, /\/product\/spawn\/download\/win/, 'the design links the real download route');
  assert.match(html, /spawn pair --workspace/, 'the design names the browser workspace pairing');
  assert.doesNotMatch(html, /Documentation only: SPEC draft v2/, 'a concept status is not a shipped status');
  assert.doesNotMatch(html, /Nothing is published or installable yet/, 'the waitlist copy must not come back');
  assert.doesNotMatch(html, /"Can I use it\?","No\./, 'the first FAQ answer says it cannot be used');
});

test('the Storage product design is authored in-repo and states only what 0.1.0 ships', () => {
  // Storage had no design in the handoff zip; its page is written in this repo and imported by the
  // same transform (`import-products-v2.mjs --authored`). The served document must be that output.
  const importer = read('scripts/import-products-v2.mjs');
  assert.match(importer, /'XENO Storage\.dc\.html': 'storage'/, 'the importer owns the Storage design');
  assert.ok(onDisk('src/content/product-designs/XENO Storage.dc.html'), 'the Storage design source is in the repo');
  const html = read('public/product-pages/storage/index.html');
  assert.match(html, /v0\.1\.0/, 'names the published version');
  assert.match(html, /\/product\/storage\/download\/win/, 'links the gated download route');
  assert.match(html, /not code-signed yet[\s\S]*SmartScreen/, 'the unsigned-installer notice (§5c site half)');
  assert.match(html, /Dokany/, 'discloses the administrator prompt and why');
  assert.match(html, /5–40x slower/, 'states the measured small-file slowdown, not native speed');
  assert.match(html, /There is no in-app updater yet/, 'says updates are a manual download');
  assert.match(html, /OneDrive and Dropbox/, 'lists the clouds it does not support');
  assert.doesNotMatch(html, /OneDrive (is|are) supported|supports OneDrive|Dropbox support/i, 'never claims a cloud it does not have');
  assert.doesNotMatch(html, /macOS[^<]{0,40}(available|download)/i, 'never offers a platform with no build');
});

test('every /products card wears its real app icon when the pack has one', async () => {
  // The handoff drew colour placeholders (a square by the name, a circle in the corner).
  // Where xeno-product-icons has the product's mark, both must be that mark; where it
  // has none, the placeholder stays rather than a borrowed or generic mark.
  const { iconFor } = await import('./lib/product-icons.mjs');
  const html = read('public/product-pages/index.html');
  const cards = [...html.matchAll(/<a href="\/product\/([a-z0-9-]+)" style="position:relative;[^>]*>([\s\S]*?)<\/a>/g)];
  assert.ok(cards.length >= 46, `expected 46+ cards, got ${cards.length}`);
  let stamped = 0;
  for (const [, slug, body] of cards) {
    const src = iconFor(slug, new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    if (src) {
      stamped++;
      assert.ok(body.includes(`<img src="${src}" alt="" width="52" height="52" data-product-icon="corner"`), `${slug}: corner mark`);
      assert.ok(body.includes(`<img src="${src}" alt="" width="24" height="24" data-product-icon="name"`), `${slug}: mark by the name`);
      assert.doesNotMatch(body, /border-radius:50%; background:#[0-9A-Fa-f]{6}; opacity:\.14/, `${slug}: placeholder circle left in`);
    } else {
      assert.doesNotMatch(body, /data-product-icon/, `${slug}: no pack icon, so no borrowed mark`);
    }
  }
  assert.ok(stamped >= 40, `expected 40+ stamped cards, got ${stamped}`);
  assert.match(html, /<a href="\/product\/storage" style="position:relative;/, 'Storage is listed on /products');
  assert.match(html, /XENO products · 46/, 'the total counts the added card');
});

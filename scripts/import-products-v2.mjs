#!/usr/bin/env node
// Import the owner's XO PRODUCTS design handoff (48 .dc.html prototypes) as the
// static product pages served at /products and /product/<slug>.
//
// Same approach as the Home v21 import (scripts/import-homepage-v21.mjs): the
// designs are runnable references with heavy DOM/canvas demo logic, so they
// are forked verbatim rather than transcribed. The only changes are local
// vendoring (no CDN), this host's own paths for self-links, design
// cross-links rewritten to /product/<slug>, and the title each head omits.
//
// Usage: node scripts/import-products-v2.mjs <extracted-zip-dir>
//        node scripts/import-products-v2.mjs --authored     (in-repo designs only)
//
// Designs written in this repo (AUTHORED, under src/content/product-designs/)
// go through the same transform as the handoff, on every run, so a re-import
// of the zip can never drop them and a hand-edit of public/ is never the source.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketingAssets, marketingHeader } from './lib/marketing-header.mjs';
import { addProductCards, stampProductIcons } from './lib/product-icons.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const authoredOnly = process.argv[2] === '--authored';
const srcDir = authoredOnly ? null : process.argv[2];
if (!srcDir && !authoredOnly) { console.error('usage: import-products-v2.mjs <extracted-zip-dir> | --authored'); process.exit(1); }
const authoredDir = join(root, 'src', 'content', 'product-designs');
// Product pages designed in this repo rather than in the handoff zip.
const AUTHORED = {
  'XENO Storage.dc.html': 'storage',
  // XENO Corpus shipped (desktop 0.1.0, 2026-10-27): the handoff's waitlist page, released — download, status, FAQ.
  'XENO Corpus.dc.html': 'corpus',
  // XENO View shipped (desktop 0.2.1, 2026-10-31): universal viewer, no handoff design.
  'XENO View.dc.html': 'view',
};
// …and their cards on the /products index, which the handoff never listed.
// Status lines on handoff cards that a release made false. Applied on every import, both modes, so a re-import of
// the zip cannot bring "built, private" back for a product people can download.
const CARD_STATUS = { corpus: { from: ['built, private', 'v0.1.0 · Windows', 'v0.1.1 · Windows', 'v0.1.2 · Windows'], to: 'v0.1.3 · Windows' } };
const AUTHORED_CARDS = [
  { slug: 'storage', section: 'Platform', name: 'XENO Storage', desc: 'Your clouds as drives on Windows', status: 'v0.1.0', color: '#2D5BD7' },
  { slug: 'view', section: 'Create', name: 'XENO View', desc: 'Images, video, audio and 3D in one viewer', status: 'v0.2.1 · Windows', color: '#DFD746' },
];

// Design file -> URL slug. Catalog slugs keep their existing addresses; the
// twelve designs the catalog does not carry get their own /product/<slug>
// (they do NOT join productCatalog — see specs/products-v2.md, decision 3).
const MAP = {
  'XENO Hub.dc.html': 'hub', 'XENO Image.dc.html': 'image', 'XENO Video.dc.html': 'video',
  'XENO 3D.dc.html': '3d', 'XENO Pixel.dc.html': 'pixel', 'XENO Photo.dc.html': 'photo',
  'XENO Motion.dc.html': 'motion', 'XENO Sound.dc.html': 'sound', 'XENO Canvas.dc.html': 'canvas',
  'XENO Layout.dc.html': 'layout', 'XENO Form.dc.html': 'form', 'XENO Architect.dc.html': 'architect',
  'XENO Docs.dc.html': 'docs', 'XENO Sheets.dc.html': 'sheets', 'XENO Slides.dc.html': 'slides',
  'XENO PDF.dc.html': 'pdf', 'XENO Stock.dc.html': 'stock', 'XENO Fonts.dc.html': 'fonts',
  'XENO Assets.dc.html': 'assets', 'XENO Notes.dc.html': 'notes', 'XENO Comms.dc.html': 'comms',
  'XENO Post.dc.html': 'post', 'XENO Browser.dc.html': 'browser', 'XENO Extension.dc.html': 'extension',
  'XENO Engine.dc.html': 'engine', 'XENO Workflow.dc.html': 'workflow', 'XENO Apps.dc.html': 'apps',
  'XENO Agent CLI.dc.html': 'agent-cli', 'XENO Agent.dc.html': 'agent', 'XENO RT.dc.html': 'rt',
  'XENO Spawn.dc.html': 'spawn', 'XENO Shell.dc.html': 'shell', 'XENO Anima.dc.html': 'anima',
  'XENO Developers.dc.html': 'developers', 'XENO Company.dc.html': 'company',
  'XENO Forum.dc.html': 'forum', 'XENO GameDev.dc.html': 'gamedev',
  'XENO Mail.dc.html': 'mail', 'XENO Marketplace.dc.html': 'marketplace', 'XENO Meet.dc.html': 'meet',
  'XENO Places.dc.html': 'places', 'XENO Polis.dc.html': 'polis', 'XENO Sites.dc.html': 'sites',
  'XENO Spectra.dc.html': 'spectra',
  'XENO Products.dc.html': 'index',
};
// Not shipped as pages: 'xeno-canvas.dc.html' (an alternate engine-story
// canvas page; XENO Canvas.dc.html is the product page) and
// 'SuiteLoop.dc.html' (a "works with" fragment, bundled below as a component).

const pagesDir = join(root, 'public', 'product-pages');
const assetsDir = join(root, 'public', 'products-v2');
mkdirSync(join(assetsDir, 'vendor'), { recursive: true });
mkdirSync(join(assetsDir, 'assets'), { recursive: true });

const byLength = Object.entries({ ...MAP, ...AUTHORED }).sort((a, b) => b[0].length - a[0].length);
const jobs = [
  ...(authoredOnly ? [] : Object.entries(MAP).map(([file, slug]) => [join(srcDir, file), file, slug])),
  ...Object.entries(AUTHORED).map(([file, slug]) => [join(authoredDir, file), file, slug]),
];
for (const [src, file, slug] of jobs) {
  if (!existsSync(src)) { console.error(`missing ${src}`); process.exit(1); }
  let html = readFileSync(src, 'utf8');
  const name = file.replace(/^XENO /, '').replace(/\.dc\.html$/, '');
  html = html
    .replaceAll('./support.js', '/products-v2/support.js')
    .replaceAll('./image-slot.js', '/products-v2/image-slot.js')
    .replaceAll('src="image-slot.js"', 'src="/products-v2/image-slot.js"')
    .replaceAll('assets/xeno-mark.svg', '/products-v2/assets/xeno-mark.svg')
    // Raw installer URLs bypass the plan gate (productCatalog.downloadLink is
    // the only sanctioned door) and pin a stale version: reroute to the
    // stable backend deep-link, which 302s to the current release.
    .replace(/https:\/\/updates\.xenostudio\.ai\/apps\/([a-z0-9-]+)\/[^"'\s]*/g, '/product/$1/download/win')
    .replaceAll('https://xenostudio.ai/login', '/login')
    .replace(/https:\/\/xenostudio\.ai\/products\/([a-z0-9-]+)\/?/g, '/product/$1')
    .replace(/https:\/\/xenostudio\.ai\/product\/([a-z0-9-]+)/g, '/product/$1')
    .replaceAll('https://xenostudio.ai', '/')
    .replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + `<title>XENO ${name} — XENOsystem</title>\n`
      + '<link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">',
    );
  for (const [other, otherSlug] of byLength) {
    const target = otherSlug === 'index' ? '/products' : `/product/${otherSlug}`;
    html = html.replaceAll(other, target);
  }
  const originalHeader = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  if (!originalHeader) throw new Error(`${file}: header missing`);
  html = html.replace(originalHeader, marketingHeader({ product: slug === 'index' ? 'system' : name }))
    .replace('</head>', marketingAssets() + '\n</head>');
  // The handoff footer is shared prototype chrome too: its links all used '#'.
  const firstSection = html.match(/<section\b[^>]*>/)?.[0];
  const overviewId = firstSection?.match(/\bid="([^"]+)"/)?.[1] || 'product-overview';
  if (firstSection && !/\bid=/.test(firstSection)) html = html.replace(firstSection, firstSection.replace('<section', '<section id="product-overview"'));
  const footerLinks = {
    Features: `#${overviewId}`, Pricing: '/pricing', Download: '/download',
    'What’s new': '/blog', Roadmap: '/roadmap', Documentation: '/docs', Tutorials: '/learn',
    Templates: '/templates', API: '/api-reference', Blog: '/blog', Forum: '/forum',
    About: '/about', Careers: '/careers', Press: '/press', Partners: '/partners', Contact: '/contact',
    Impressum: '/impressum', Privacy: '/privacy', Terms: '/terms', Security: '/security',
    Refunds: '/refunds', Cookies: '/cookies',
  };
  html = html.replace(/<footer\b[\s\S]*?<\/footer>/, footer => footer.replace(/<a\b([^>]*?)href="#"([^>]*)>([\s\S]*?)<\/a>/g,
    (anchor, before, after, body) => {
      const label = body.replace(/<[^>]*>/g, '').trim();
      if (label === 'All systems operational') return `<span${before}${after}>${body}</span>`;
      if (!footerLinks[label]) throw new Error(`${file}: unmapped footer link ${label}`);
      return `<a${before}href="${footerLinks[label]}"${after}>${body}</a>`;
    }));
  // Link targets must be rewritten; the bare domain inside demo copy
  // ("open xenostudio.ai/device on your phone") is page text, not a link.
  if (html.includes('.dc.html') || /["'(]https?:\/\/xenostudio\.ai/.test(html)) {
    const i = Math.max(html.indexOf('.dc.html'), html.search(/["'(]https?:\/\/xenostudio\.ai/));
    console.error(`${file}: unrewritten reference remains: …${html.slice(Math.max(0, i - 80), i + 40)}…`); process.exit(1);
  }
  const out = slug === 'index' ? join(pagesDir, 'index.html') : join(pagesDir, slug, 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

if (!authoredOnly) {
// Runtime: same dc runtime as the zip ships, CDN URLs swapped for vendored
// copies (SRI hashes for the CDN builds must not apply to different files).
let runtime = readFileSync(join(srcDir, 'support.js'), 'utf8');
// dc-import fetches sibling components. The handoff's default '.' resolves
// under /product/ in production, where SuiteLoop was never imported.
if (!runtime.includes('var COMPONENT_DIR = ".";')) throw new Error('Component directory anchor missing');
runtime = runtime.replace('var COMPONENT_DIR = ".";', 'var COMPONENT_DIR = "/products-v2/components";');
let suite = readFileSync(join(srcDir, 'SuiteLoop.dc.html'), 'utf8');
for (const [file, slug] of byLength) suite = suite.replaceAll(file, slug === 'index' ? '/products' : `/product/${slug}`);
suite = suite.replaceAll('./support.js', '/products-v2/support.js');
mkdirSync(join(assetsDir, 'components'), { recursive: true });
writeFileSync(join(assetsDir, 'components', 'SuiteLoop.dc.html'), suite);
for (const [from, to] of [
  ['https://unpkg.com/react@18.3.1/umd/react.production.min.js', '/products-v2/vendor/react.production.min.js'],
  ['https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', '/products-v2/vendor/react-dom.production.min.js'],
  ['https://unpkg.com/@babel/standalone@7.29.0/babel.min.js', '/products-v2/vendor/babel.min.js'],
]) {
  if (!runtime.includes(from)) { console.error(`runtime URL not found: ${from}`); process.exit(1); }
  runtime = runtime.replace(from, to);
}
runtime = runtime.replace(/var (REACT_SRI|REACT_DOM_SRI|BABEL_SRI) = "[^"]*";/g, 'var $1 = "";');
writeFileSync(join(assetsDir, 'support.js'), runtime);
cpSync(join(srcDir, 'image-slot.js'), join(assetsDir, 'image-slot.js'));
cpSync(join(srcDir, 'assets', 'xeno-mark.svg'), join(assetsDir, 'assets', 'xeno-mark.svg'));
cpSync(join(root, 'node_modules/react/umd/react.production.min.js'), join(assetsDir, 'vendor/react.production.min.js'));
cpSync(join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'), join(assetsDir, 'vendor/react-dom.production.min.js'));
cpSync(join(root, 'node_modules/@babel/standalone/babel.min.js'), join(assetsDir, 'vendor/babel.min.js'));
}

// The /products index shows each product's real app icon (scripts/lib/product-icons.mjs).
// Run on every import, both modes: the handoff index carries colour placeholders.
{
  const indexPath = join(pagesDir, 'index.html');
  let indexHtml = readFileSync(indexPath, 'utf8');
  for (const [slug, { from, to }] of Object.entries(CARD_STATUS)) {
    const start = indexHtml.indexOf(`<a href="/product/${slug}" style="position:relative;`);
    const end = start < 0 ? -1 : indexHtml.indexOf('</a>', start);
    const card = end < 0 ? '' : indexHtml.slice(start, end);
    if (card.includes(`>${to}<`)) continue;
    // `from` lists every earlier status this card may carry (the handoff's, then each release's).
    const was = [from].flat().find((f) => card.includes(`>${f}<`));
    if (!was) throw new Error(`products index: the ${slug} card says none of ${JSON.stringify(from)} — update CARD_STATUS`);
    indexHtml = indexHtml.slice(0, start) + card.replace(`>${was}<`, `>${to}<`) + indexHtml.slice(end);
  }
  const withCards = addProductCards(indexHtml, AUTHORED_CARDS);
  if (withCards.added.length) console.log(`products index: added ${withCards.added.join(', ')}`);
  const { html, stamped, missing } = stampProductIcons(withCards.html, join(root, 'public'));
  writeFileSync(indexPath, html);
  if (stamped.length) console.log(`product icons: stamped ${stamped.length} cards`);
  if (missing.length) console.log(`product icons: no icon in the pack for ${missing.join(', ')} (placeholder kept)`);
}

// The slug list the SPA redirect and the tests consume — generated from the
// documents on disk, never hand-edited, so the two cannot drift.
const slugs = readdirSync(pagesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
writeFileSync(join(root, 'src', 'lib', 'productDesigns.ts'),
  '// GENERATED by scripts/import-products-v2.mjs — do not hand-edit.\n'
  + '// Slugs whose /product/<slug> page is the owner\'s v2 design document\n'
  + '// (public/product-pages/<slug>/index.html), served by nginx.\n'
  + `export const PRODUCT_DESIGN_SLUGS: ReadonlySet<string> = new Set(${JSON.stringify(slugs, null, 2)});\n`);
console.log(`products v2 imported: ${slugs.length} product pages + index`);

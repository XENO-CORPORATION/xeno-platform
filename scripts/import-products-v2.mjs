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
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketingAssets, marketingHeader } from './lib/marketing-header.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = process.argv[2];
if (!srcDir) { console.error('usage: import-products-v2.mjs <extracted-zip-dir>'); process.exit(1); }

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
  'XENO Corpus.dc.html': 'corpus', 'XENO Forum.dc.html': 'forum', 'XENO GameDev.dc.html': 'gamedev',
  'XENO Mail.dc.html': 'mail', 'XENO Marketplace.dc.html': 'marketplace', 'XENO Meet.dc.html': 'meet',
  'XENO Places.dc.html': 'places', 'XENO Polis.dc.html': 'polis', 'XENO Sites.dc.html': 'sites',
  'XENO Spectra.dc.html': 'spectra',
  'XENO Products.dc.html': 'index',
};
// Not shipped as pages: 'xeno-canvas.dc.html' (an alternate engine-story
// canvas page; XENO Canvas.dc.html is the product page) and
// 'SuiteLoop.dc.html' (a "works with" fragment, not a page).

const pagesDir = join(root, 'public', 'product-pages');
const assetsDir = join(root, 'public', 'products-v2');
mkdirSync(join(assetsDir, 'vendor'), { recursive: true });
mkdirSync(join(assetsDir, 'assets'), { recursive: true });

const byLength = Object.entries(MAP).sort((a, b) => b[0].length - a[0].length);
const slugs = [];
for (const [file, slug] of Object.entries(MAP)) {
  const src = join(srcDir, file);
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
  if (slug !== 'index') slugs.push(slug);
}

// Runtime: same dc runtime as the zip ships, CDN URLs swapped for vendored
// copies (SRI hashes for the CDN builds must not apply to different files).
let runtime = readFileSync(join(srcDir, 'support.js'), 'utf8');
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

// The slug list the SPA redirect and the tests consume — generated, never
// hand-edited, so it cannot drift from the documents on disk.
slugs.sort();
writeFileSync(join(root, 'src', 'lib', 'productDesigns.ts'),
  '// GENERATED by scripts/import-products-v2.mjs — do not hand-edit.\n'
  + '// Slugs whose /product/<slug> page is the owner\'s v2 design document\n'
  + '// (public/product-pages/<slug>/index.html), served by nginx.\n'
  + `export const PRODUCT_DESIGN_SLUGS: ReadonlySet<string> = new Set(${JSON.stringify(slugs, null, 2)});\n`);
console.log(`products v2 imported: ${slugs.length} product pages + index`);

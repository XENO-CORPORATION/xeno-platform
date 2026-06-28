#!/usr/bin/env node
/*
 * prerender-products — PRODUCT-PAGES-SPEC.md §8.
 *
 * Post-build SEO prerender for the canonical product routes. Client-only React
 * ships an empty <head> to crawlers; this emits a static HTML file per route
 * (the built SPA shell + a route-correct <head>: title, description, canonical,
 * Open Graph, Twitter, schema.org SoftwareApplication JSON-LD) so the pages are
 * indexable while still hydrating into the live SPA. Also writes sitemap.xml and
 * ensures robots.txt points at it.
 *
 * Runs after `vite build`, against ./dist. Reads the product catalog directly
 * from src/lib/productCatalog.ts (compiled on the fly with esbuild).
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const DIST = 'dist';
const SITE = 'https://xenostudio.ai';
const OG_IMAGE = `${SITE}/og-default.png`;

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CATEGORY_SCHEMA = {
  Generate: 'MultimediaApplication', Create: 'MultimediaApplication', Design: 'DesignApplication',
  Office: 'BusinessApplication', Library: 'MultimediaApplication', Connect: 'CommunicationApplication',
  Build: 'DeveloperApplication', Develop: 'DeveloperApplication', Platform: 'UtilitiesApplication',
};
const OS_BY_DELIVERY = { desktop: 'Windows, macOS, Linux', web: 'Any (web browser)', cli: 'Windows, macOS, Linux', soon: 'Windows, macOS, Linux' };

async function loadCatalog() {
  const out = await build({
    entryPoints: ['src/lib/productCatalog.ts'],
    bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
  });
  const tmp = join(tmpdir(), `catalog-${process.pid}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href);
}

// Rich landing content (src/content/products) is pure data — bundle it the same
// way so a product's seo{} can override the prerendered <head> (SPEC §2.1).
async function loadContent() {
  try {
    const out = await build({
      entryPoints: ['src/content/products/index.ts'],
      bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
    });
    const tmp = join(tmpdir(), `content-${process.pid}.mjs`);
    writeFileSync(tmp, out.outputFiles[0].text);
    return await import(pathToFileURL(tmp).href);
  } catch (e) {
    console.warn('prerender: content modules unavailable, using catalog defaults —', e.message);
    return { getProductContent: () => undefined };
  }
}

function jsonld(p) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: p.name,
    description: p.tagline,
    applicationCategory: CATEGORY_SCHEMA[p.category] ?? 'SoftwareApplication',
    operatingSystem: OS_BY_DELIVERY[p.delivery] ?? 'Windows',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: `${SITE}/product/${p.slug}`,
    ...(p.repo ? { softwareHelp: `https://github.com/XENO-CORPORATION/${p.repo}` } : {}),
  });
}

function headFor(p, { title, desc, canonical }) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="XENO Studio">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<script type="application/ld+json">${jsonld(p)}</script>`,
  ].join('\n    ');
}

function renderPage(template, p, head) {
  // Drop the SPA's default <title>, inject the route head before </head>.
  return template
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace('</head>', `    ${head}\n  </head>`);
}

function writePage(routePath, html) {
  const dir = join(DIST, routePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('prerender: dist/index.html missing — run `vite build` first.');
    process.exit(1);
  }
  const template = readFileSync(join(DIST, 'index.html'), 'utf8');
  const { PRODUCTS } = await loadCatalog();
  const { getProductContent } = await loadContent();

  const urls = ['/products'];
  let pages = 0;
  for (const p of PRODUCTS) {
    if (p.status === 'coming-soon') continue; // index only shipping/beta products

    const content = getProductContent(p.slug);
    const baseTitle = `${p.name} — ${p.tagline}`;
    const title = content?.seo?.title || baseTitle;
    const desc = content?.seo?.description || p.tagline;
    writePage(`product/${p.slug}`, renderPage(template, p, headFor(p, {
      title, desc, canonical: `${SITE}/product/${p.slug}`,
    })));
    urls.push(`/product/${p.slug}`);
    pages++;

    if (p.delivery === 'desktop') {
      for (const [seg, label] of [['download', 'Download'], ['releases', 'Releases']]) {
        writePage(`product/${p.slug}/${seg}`, renderPage(template, p, headFor(p, {
          title: `${label} ${p.name}`,
          desc: `${label} ${p.name} — ${p.tagline}`,
          canonical: `${SITE}/product/${p.slug}/${seg}`,
        })));
        urls.push(`/product/${p.slug}/${seg}`);
        pages++;
      }
    }
  }

  // /products index page (generic head — it's a grid, not one app).
  const idxDesc = 'The XENO ecosystem — creative, office, agent, and developer tools, all AI-native.';
  const indexHead = [
    `<title>Products — XENO Studio</title>`,
    `<meta name="description" content="${esc(idxDesc)}">`,
    `<link rel="canonical" href="${SITE}/products">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="XENO Studio">`,
    `<meta property="og:title" content="Products — XENO Studio">`,
    `<meta property="og:description" content="${esc(idxDesc)}">`,
    `<meta property="og:url" content="${SITE}/products">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n    ');
  writePage('products', renderPage(template, null, indexHead));
  pages++;

  // sitemap.xml
  const today = new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [`/`, ...urls].map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`;
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

  // robots.txt — keep existing rules if present, ensure a Sitemap line.
  const robotsPath = join(DIST, 'robots.txt');
  let robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : 'User-agent: *\nAllow: /\n';
  if (!/Sitemap:/i.test(robots)) robots += `\nSitemap: ${SITE}/sitemap.xml\n`;
  writeFileSync(robotsPath, robots);

  console.log(`prerender: wrote ${pages} product pages + sitemap.xml (${urls.length + 1} urls) + robots.txt`);
}

main().catch((e) => { console.error('prerender failed:', e); process.exit(1); });

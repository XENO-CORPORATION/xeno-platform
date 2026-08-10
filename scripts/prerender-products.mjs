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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { siteOrigin } from '../src/server/config/hosts.js';

const DIST = 'dist';
const SITE = siteOrigin();
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

// Docs content (src/content/docs) — compiled the same way so every doc page
// gets a static, indexable HTML shell with the right <head>.
async function loadDocs() {
  try {
    const out = await build({
      entryPoints: ['src/content/docs/index.ts'],
      bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
    });
    const tmp = join(tmpdir(), `docs-${process.pid}.mjs`);
    writeFileSync(tmp, out.outputFiles[0].text);
    return await import(pathToFileURL(tmp).href);
  } catch (e) {
    console.warn('prerender: docs modules unavailable —', e.message);
    return { allDocRoutes: () => [], allDocProducts: () => [] };
  }
}

function jsonld(p) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: p.name,
    description: p.tagline,
    applicationCategory: CATEGORY_SCHEMA[p.category] ?? 'SoftwareApplication',
    operatingSystem: p.operatingSystem ?? OS_BY_DELIVERY[p.delivery] ?? 'Windows',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: `${SITE}/product/${p.slug}`,
    // Only xeno-rt is a public repo; emitting softwareHelp for a private one
    // hands crawlers a 404.
    ...(p.repo && p.repoPublic ? { softwareHelp: `https://github.com/XENO-CORPORATION/${p.repo}` } : {}),
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

function docJsonld({ title, desc, canonical, productName }) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    name: title,
    description: desc,
    about: productName,
    isPartOf: { '@type': 'WebSite', name: 'XENO Studio', url: SITE },
    url: canonical,
  });
}

function docHeadFor({ title, desc, canonical, productName }) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="XENO Studio">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<script type="application/ld+json">${docJsonld({ title, desc, canonical, productName })}</script>`,
  ].join('\n    ');
}

/* A privacy policy is not a SoftwareApplication and carries no price offer, so it
 * gets WebPage schema rather than reusing headFor()'s product JSON-LD. */
function privacyHeadFor({ title, desc, canonical, productName }) {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description: desc,
    about: productName,
    isPartOf: { '@type': 'WebSite', name: 'XENO Studio', url: SITE },
    url: canonical,
  });
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
    `<script type="application/ld+json">${ld}</script>`,
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
  const { allDocRoutes, allDocProducts } = await loadDocs();

  const urls = ['/products'];
  let pages = 0;
  for (const p of PRODUCTS) {
    const content = getProductContent(p.slug);
    // Prerender shipping/beta products, and any coming-soon product that already
    // has a rich landing (so its SEO <head> is correct pre-launch).
    if (p.status === 'coming-soon' && !content) continue;
    const baseTitle = `${p.name} — ${p.tagline}`;
    const title = content?.seo?.title || baseTitle;
    const desc = content?.seo?.description || p.tagline;
    writePage(`product/${p.slug}`, renderPage(template, p, headFor(p, {
      title, desc, canonical: `${SITE}/product/${p.slug}`,
    })));
    urls.push(`/product/${p.slug}`);
    pages++;

    if (p.delivery === 'desktop' || p.delivery === 'cli') {
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

    // Per-product privacy policy — prerendered whenever a content module authors
    // one, and deliberately NOT gated on delivery/status: the extension is
    // coming-soon with delivery 'soon', and its web-store submission links this
    // exact URL. A reviewer fetching it must get real HTML with a real <title>,
    // not the empty SPA shell every unprerendered route returns.
    if (content?.privacy) {
      writePage(`product/${p.slug}/privacy`, renderPage(template, p, privacyHeadFor({
        title: `${p.name} privacy policy`,
        desc: `How ${p.name} handles your data — what it processes, where that data goes, and what it never does.`,
        canonical: `${SITE}/product/${p.slug}/privacy`,
        productName: p.name,
      })));
      urls.push(`/product/${p.slug}/privacy`);
      pages++;
    }
  }

  // ── Docs ──────────────────────────────────────────────────────────────
  // Unified docs hub.
  writePage('docs', renderPage(template, null, docHeadFor({
    title: 'XENO Studio docs',
    desc: 'Guides and reference for every XENO app, agent, and API — from your first render to a production agent workflow.',
    canonical: `${SITE}/docs`,
    productName: 'XENO Studio',
  })));
  urls.push('/docs');
  pages++;

  // Per-product docs index (canonical /docs/<slug>).
  for (const pd of allDocProducts()) {
    writePage(`docs/${pd.slug}`, renderPage(template, null, docHeadFor({
      title: pd.seo?.title || `${pd.productName} documentation`,
      desc: pd.seo?.description || pd.tagline || `${pd.productName} documentation.`,
      canonical: `${SITE}/docs/${pd.slug}`,
      productName: pd.productName,
    })));
    urls.push(`/docs/${pd.slug}`);
    pages++;
  }

  // Every doc page.
  for (const r of allDocRoutes()) {
    const canonical = `${SITE}/docs/${r.productSlug}/${r.pageSlug}`;
    writePage(`docs/${r.productSlug}/${r.pageSlug}`, renderPage(template, null, docHeadFor({
      title: `${r.title} — ${r.productName} docs`,
      desc: r.description || `${r.title} — ${r.productName} documentation.`,
      canonical,
      productName: r.productName,
    })));
    urls.push(canonical.replace(SITE, ''));
    pages++;
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

  // sitemap.xml — DISABLED 2026-08-11 while the site is being de-indexed.
  //
  // A sitemap is an active invitation: it hands Google a list of every URL and a
  // fresh <lastmod> that says "recrawl me". Emitting one while asking to be
  // removed from the index works directly against the noindex header set in
  // nginx/default.conf. The URL list is still computed above, so re-enabling is
  // uncommenting this block — nothing else has to be reconstructed.
  //
  // TO REVERSE: restore the three lines below, restore the `Sitemap:` line in
  // public/robots.txt, deploy, then re-submit the sitemap in Search Console.
  //
  //   const today = new Date().toISOString().slice(0, 10);
  //   const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ...>\n` +
  //     [`/`, ...urls].map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
  //     `\n</urlset>\n`;
  //   writeFileSync(join(DIST, 'sitemap.xml'), sitemap);
  //
  // Any sitemap.xml left in dist/ from an earlier build is removed, so a stale
  // one cannot survive in the image and keep advertising the old 268 URLs.
  const staleSitemap = join(DIST, 'sitemap.xml');
  if (existsSync(staleSitemap)) rmSync(staleSitemap);

  // robots.txt ships from public/ as-authored. The prerender no longer appends a
  // `Sitemap:` line (there is no sitemap), and must not rewrite the file — the
  // authored copy explains WHY crawling stays allowed while noindex does the work.

  console.log(`prerender: wrote ${pages} product pages (sitemap disabled — de-index in effect; ${urls.length + 1} routes not advertised)`);
}

main().catch((e) => { console.error('prerender failed:', e); process.exit(1); });

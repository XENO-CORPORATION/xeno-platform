// Gate: XENOsystem Home v21 is the homepage at `/`, served as the static
// document the owner handed off (XO - PLATFORM HOMEPAGE.zip), not the old
// React landing page. Removing the nginx root location, pointing an asset
// back at a CDN, or restoring Home3 at `/` must fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the v21 document is vendored, self-contained and titled', () => {
  const html = read('public/home-v21/index.html');
  assert.match(html, /data-screen-label="XENOsystem Home v21"/);
  assert.match(html, /<title>XENOsystem/);
  assert.match(html, /src="\/home-v21\/support\.js"/);
  assert.doesNotMatch(html, /src="\.\/support\.js"/);
  const runtime = read('public/home-v21/support.js');
  assert.doesNotMatch(runtime, /unpkg\.com/, 'runtime must not load React/Babel from a CDN');
  for (const v of ['react.production.min.js', 'react-dom.production.min.js', 'babel.min.js']) {
    assert.match(runtime, new RegExp(`/home-v21/vendor/${v.replaceAll('.', '\\.')}`));
    assert.ok(existsSync(new URL(`../public/home-v21/vendor/${v}`, import.meta.url)), v);
  }
});

test('entry is clean: no panels scrollbar, and nothing paints before the intro', () => {
  const html = read('public/home-v21/index.html');
  assert.match(html, /<html class="intro-pending">/, 'pre-intro state is CSS from the first paint, not a later timer');
  assert.match(html, /\.intro-pending \[data-intro\],\.intro-pending header,\.intro-pending \[data-reveal\]\{opacity:0/);
  assert.match(html, /classList\.remove\('intro-pending'\)/, 'the entrance removes the cover state when it takes over');
  assert.match(html, /data-panels="1"/, 'the hero panels grid is marked');
  assert.match(html, /\[data-panels\]\{scrollbar-width:none\}/, 'and its scrollbar is hidden (it still scrolls)');
  assert.match(html, /xenoEntryFailsafe/, 'a no-runtime failsafe still uncovers the page');
});
test('shapes are squared: no circles, no pills, container radius capped', () => {
  const html = read('public/home-v21/index.html');
  assert.doesNotMatch(html, /border-radius:\s*(?:50%|999px|(?:10|12|16|20)px)/, 'source declarations cannot recreate circles, pills or large corners');
  assert.match(html, /--r-sm:6px;--r-lg:8px/);
  assert.match(html, /radius: m.role === 'user' \? '8px 3px 8px 8px'/, 'dynamic chat bubbles follow the same rule');
});

test('section containers keep the design’s centred 1360px column and 40px gutter', () => {
  const html = read('public/home-v21/index.html');
  assert.doesNotMatch(html, /max-width:none/, 'a full-width container puts the copy back on the viewport edge');
  assert.equal((html.match(/max-width:1360px;margin:0 auto;padding-left:clamp\(16px,3vw,40px\)/g) || []).length, 9);
  assert.doesNotMatch(html, /data-stack-copy/);
  assert.doesNotMatch(read('public/home-v21/homepage.css'), /#stack \[data-stack-copy\]/);
});

test('the homepage stylesheet URL names its own bytes', async () => {
  const { createHash } = await import('node:crypto');
  const css = read('public/home-v21/homepage.css').replace(/\r\n/g, '\n');
  const version = createHash('sha256').update(css).digest('hex').slice(0, 16);
  const html = read('public/home-v21/index.html');
  assert.match(html, new RegExp(`/home-v21/homepage\\.css\\?v=${version}`), 'an unversioned stylesheet is cached at the edge for four hours');
});

test('header products have native destinations and a persistent animated menu', () => {
  const html = read('public/home-v21/index.html');
  assert.match(html, /data-product-trigger="1" aria-controls="home-products-menu"/);
  assert.match(html, /data-product-menu="1" inert/);
  assert.match(html, /<a class="home-product-row" href="\/product\/pixel"/);
  assert.match(html, /href="\/products"/);
  assert.doesNotMatch(html, /this.scrollTo\('products'\)/, 'product selections navigate instead of scrolling to a missing section');
  assert.match(read('public/site/marketing-header.css'), /transition:opacity \.2s ease-out/);
});

test('unavailable model actions open honest examples and a signup path', () => {
  const html = read('public/home-v21/index.html');
  assert.doesNotMatch(html, /[Nn]o model (?:is )?reachable|model offline/);
  assert.match(html, /window.xenoHomePreview\(feature\)/);
  for (const feature of ['code', 'workflow', 'image', 'video', 'comms', 'sdk', 'shell']) {
    assert.ok(html.includes(`this.noHost('${feature}')`), feature);
  }
  const runtime = read('public/home-v21/homepage.js');
  assert.match(runtime, /Your prompt has not been sent to a model/);
  assert.match(runtime, /signup.href = '\/auth'/);
  assert.match(runtime, /dialog.showModal\(\)/);
  assert.match(html, /home-preview-banner/);
});
test('every image the page references exists under public/', () => {
  const html = read('public/home-v21/index.html');
  const refs = [...new Set([...html.matchAll(/\/home-v21\/site\/[A-Za-z0-9_.-]+/g)].map((m) => m[0]))];
  assert.ok(refs.length >= 10, `expected the v21 image set, got ${refs.length}`);
  for (const ref of refs) {
    assert.ok(existsSync(new URL(`../public${ref}`, import.meta.url)), ref);
  }
});

test('nginx serves v21 at exactly / behind the site gate, and the SPA hands / to it', () => {
  const nginx = read('nginx/default.conf');
  const root = nginx.match(/location = \/ \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(root, /auth_request \/__site_gate;/, 'the homepage stays behind the site gate');
  assert.match(root, /try_files \/home-v21\/index\.html =404;/);
  assert.match(nginx, /location \^~ \/home-v21\/ \{/);
  const doc = nginx.match(/location = \/home-v21\/index\.html \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(doc, /auth_request \/__site_gate;/, 'the homepage document itself stays gated');
  const app = read('src/App.tsx');
  assert.match(app, /<Route path="\/" element=\{<HomeV21Redirect \/>\} \/>/);
  assert.match(app, /<Route path="\/v3" element=\{<Home3 \/>\} \/>/, 'the previous homepage stays at /v3');
});

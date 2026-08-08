#!/usr/bin/env node
/*
 * product-privacy.test.mjs — the per-product privacy policy gate.
 * Run: node --test scripts/product-privacy.test.mjs
 *
 * WHY THIS EXISTS. A web-store submission links a privacy-policy URL, and a
 * reviewer rejects the submission if that URL does not serve a real policy. The
 * failure mode is silent in both of the ways this repo has already been bitten:
 *
 *  1. An unprerendered route still returns HTTP 200 — it serves the SPA shell.
 *     So "curl -o /dev/null -w %{http_code}" says 200 and the policy is not
 *     there. A status-code check cannot tell you this page exists; only a real
 *     <title> in the emitted HTML can.
 *  2. prerender-products.mjs's loadContent() CATCHES a content-module compile
 *     error and falls back to `getProductContent: () => undefined`. Every
 *     product then silently loses its authored <head> and its privacy page,
 *     and the build still exits 0 with one console.warn. This test compiles the
 *     same module WITHOUT that fallback, so a broken module fails here loudly
 *     instead of quietly degrading the site.
 *
 * Hermetic: no network. The content registry is pure data, bundled the same way
 * prerender-products.mjs bundles it; evaluating it has no side effects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Deliberately NOT wrapped in try/catch — see reason 2 above. */
async function loadModule(entry, tag) {
  const out = await build({
    entryPoints: [join(REPO, entry)],
    bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
    absWorkingDir: REPO,
  });
  const tmp = join(tmpdir(), `${tag}-${process.pid}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href);
}

const { PRODUCTS } = await loadModule('src/lib/productCatalog.ts', 'privacy-catalog');
const { getProductContent } = await loadModule('src/content/products/index.ts', 'privacy-content');

const withPrivacy = PRODUCTS
  .map((p) => ({ p, privacy: getProductContent(p.slug)?.privacy }))
  .filter((x) => x.privacy);

/* ── The submission-blocking guarantee ─────────────────────────────────────── */

test('xeno-extension has an authored privacy policy', () => {
  // The Chrome Web Store submission links /product/extension/privacy. If this
  // content is ever deleted or renamed, that URL degrades to a redirect and the
  // listing's privacy link silently stops pointing at a policy.
  const privacy = getProductContent('extension')?.privacy;
  assert.ok(privacy, 'extension must keep a privacy policy — its store listing links it');
});

test('at least one product exercises the privacy route', () => {
  // Guards against the whole feature going dead: if nothing authors `privacy`,
  // the route, the prerender branch and this gate are all untested no-ops.
  assert.ok(withPrivacy.length >= 1, 'no product authors a privacy policy — the route is dead code');
});

/* ── Shape: a policy that renders as a policy ──────────────────────────────── */

test('every authored privacy policy is well-formed', () => {
  for (const { p, privacy } of withPrivacy) {
    const where = `${p.slug} privacy`;

    assert.match(privacy.updated, /^\d{4}-\d{2}-\d{2}$/, `${where}: updated must be YYYY-MM-DD`);
    // A future date would claim a revision that has not happened.
    assert.ok(
      new Date(`${privacy.updated}T00:00:00Z`) <= new Date(),
      `${where}: updated is in the future (${privacy.updated})`,
    );

    assert.ok(privacy.intro?.trim().length > 40, `${where}: intro must actually say something`);
    assert.ok(Array.isArray(privacy.sections) && privacy.sections.length >= 3,
      `${where}: a policy with fewer than 3 sections is not a policy`);
    assert.match(privacy.contact, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, `${where}: contact must be an email`);

    for (const s of privacy.sections) {
      assert.ok(s.heading?.trim(), `${where}: a section is missing its heading`);
      assert.ok(s.body?.trim() || s.bullets?.length,
        `${where}: section "${s.heading}" has neither body nor bullets and would render empty`);
      for (const b of s.bullets ?? []) {
        assert.ok(b.text?.trim(), `${where}: section "${s.heading}" has an empty bullet`);
      }
    }
  }
});

/* ── Emission: the URL serves real HTML, not the SPA shell ─────────────────── */

test('the built site emits a prerendered page for every authored policy', (t) => {
  const dist = join(REPO, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    // Announce the skip rather than passing silently — an unrun gate that
    // reports OK is how a broken-open check gets mistaken for coverage.
    t.skip('dist/ not built — run `npm run build` to include this check');
    return;
  }
  const shell = readFileSync(join(dist, 'index.html'), 'utf8');
  for (const { p } of withPrivacy) {
    const page = join(dist, 'product', p.slug, 'privacy', 'index.html');
    assert.ok(existsSync(page), `${p.slug}: /product/${p.slug}/privacy was not prerendered`);
    const html = readFileSync(page, 'utf8');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    assert.ok(title.toLowerCase().includes('privacy'),
      `${p.slug}: prerendered privacy page has no privacy <title> (got ${JSON.stringify(title)})`);
    assert.notEqual(html, shell,
      `${p.slug}: privacy page is byte-identical to the SPA shell — it was not prerendered`);
    assert.ok(html.includes(`/product/${p.slug}/privacy`),
      `${p.slug}: privacy page is missing its own canonical URL`);
  }
});

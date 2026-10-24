// Gate: the React pages under a v2 design (download, releases, a release) wear the
// design's chrome, and that chrome is GENERATED from the designs, not restyled by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('src/generated/v2Chrome.ts matches the header, its assets and the designs on disk', () => {
  // --check exits 1 when stale; execFileSync throws on that.
  const out = execFileSync(process.execPath, ['scripts/generate-v2-chrome.mjs', '--check'], { encoding: 'utf8' });
  assert.match(out, /v2 chrome current/);
  const gen = read('src/generated/v2Chrome.ts');
  assert.match(gen, /"storage": "#2449B8"/, 'a product accent comes from its design eyebrow');
});

test('download, releases and release pages render inside the v2 chrome', () => {
  for (const f of ['ProductDownload', 'ProductReleases', 'ProductReleaseDetail']) {
    const src = read(`src/pages/${f}.tsx`);
    assert.match(src, /<V2Page product=\{product\.name\}>/, `${f} uses the v2 chrome`);
    assert.doesNotMatch(src, /landing-v3\/Header/, `${f} no longer carries the dark landing header`);
  }
  const chrome = read('src/components/product/v2/V2Page.tsx');
  assert.match(chrome, /V2_HEADER_HTML\.replace\(V2_PRODUCT_TOKEN, escapeHtml\(word\)\)/, 'the only runtime input to the header is escaped');
  assert.match(chrome, /V2_HEADER_JS/, 'the shared header behaviour is loaded');
  // A short page in a tall window: the footer must reach the bottom edge (no paper strip under it).
  assert.match(chrome, /minHeight: '100vh', display: 'flex', flexDirection: 'column'/, 'the chrome is a full-height column');
  assert.match(chrome, /<main style=\{\{ flex: '1 0 auto' \}\}>/, 'main takes the slack so the footer sits at the bottom');
});

test('the experimental notice keeps its single source of copy in the paper tone', () => {
  const n = read('src/components/product/ExperimentalNotice.tsx');
  const paper = n.slice(n.indexOf("if (tone === 'paper')"), n.indexOf('/* Bare one-liner'));
  assert.ok(paper.length > 0);
  assert.match(paper, /notice\.label/);
  assert.match(paper, /notice\.(detail|short)/);
  assert.doesNotMatch(paper, /SmartScreen|Run anyway/, 'copy is derived from experimentalNotice(), never authored here');
});

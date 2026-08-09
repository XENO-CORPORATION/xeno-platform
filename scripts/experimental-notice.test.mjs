#!/usr/bin/env node
/*
 * experimental-notice.test.mjs — the EXPERIMENTAL / UNSIGNED treatment matrix.
 * Run: node --test scripts/experimental-notice.test.mjs
 *
 * The treatment is derived from src/lib/productCatalog.ts so a product cannot
 * silently lose it. That guarantee is only worth something if PRECISION is also
 * guaranteed: a SmartScreen warning on an npm package is a different kind of
 * lie than no warning on an installer, but it is still a lie. These tests pin
 * both directions —
 *   · every desktop installer says unsigned + SmartScreen,
 *   · no npm package or hosted web app ever mentions SmartScreen,
 *   · a product with no build at all says nothing,
 *   · setting signing:'signed' removes the warning language everywhere.
 *
 * Hermetic: no network. The catalog is a pure data module (an array plus a Map);
 * it is compiled with esbuild exactly the way scripts/prerender-products.mjs
 * already compiles it, and evaluating it has no side effects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadCatalog() {
  const out = await build({
    entryPoints: [join(REPO, 'src/lib/productCatalog.ts')],
    bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
    absWorkingDir: REPO,
  });
  const tmp = join(tmpdir(), `catalog-notice-${process.pid}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href);
}

const cat = await loadCatalog();
const { PRODUCTS, experimentalNotice, installChannel, artifactSigning, productMaturity } = cat;
const bySlug = (s) => PRODUCTS.find((p) => p.slug === s);
const noticeFor = (s) => experimentalNotice(bySlug(s));

/* ── The default is the SAFE direction ─────────────────────────────────────── */

test('a desktop product with no signing field resolves to unsigned, not silence', () => {
  const p = { slug: 'x', name: 'X', tagline: '', category: 'Platform', status: 'beta', delivery: 'desktop' };
  assert.equal(artifactSigning(p), 'unsigned');
  assert.equal(productMaturity(p), 'experimental');
  const n = experimentalNotice(p);
  assert.ok(n, 'a new desktop product must not ship without the notice');
  assert.equal(n.smartScreen, true);
});

test('every desktop product in the catalog carries the unsigned installer notice', () => {
  const desktop = PRODUCTS.filter((p) => p.delivery === 'desktop');
  assert.ok(desktop.length >= 10, `expected the real catalog, got ${desktop.length} desktop products`);
  for (const p of desktop) {
    const n = experimentalNotice(p);
    assert.ok(n, `${p.slug}: no notice`);
    assert.equal(n.channel, 'installer', `${p.slug}: wrong channel`);
    assert.equal(n.signing, 'unsigned', `${p.slug}: wrong signing`);
    assert.equal(n.smartScreen, true, `${p.slug}: should warn about SmartScreen`);
    assert.match(n.detail, /experimental release/i, `${p.slug}: missing maturity statement`);
    assert.match(n.detail, /SmartScreen/, `${p.slug}: missing SmartScreen statement`);
    assert.match(n.detail, /Code signing is coming/, `${p.slug}: missing "signing is coming"`);
    assert.ok(n.steps?.length, `${p.slug}: no click-through steps`);
    assert.ok(n.steps.some((s) => /Run anyway/i.test(s)), `${p.slug}: steps never say how to proceed`);
    // The one-liner is the ONLY form some visitors see (hero, release row), so
    // it has to carry "how to proceed" on its own — not just the warning.
    assert.match(n.short, /Run anyway/i, `${p.slug}: one-liner warns without saying how to proceed`);
    assert.match(n.short, /signing is on the way/i, `${p.slug}: one-liner omits that signing is coming`);
    // label + short are rendered adjacently; the maturity word belongs to the
    // label alone or the sentence reads "Experimental release. An experimental…"
    assert.doesNotMatch(n.short, /experimental/i, `${p.slug}: one-liner repeats the label`);
  }
});

/* ── PRECISION: what must NOT get the installer framing ────────────────────── */

test('npm packages are never told Windows will warn them', () => {
  for (const slug of ['agent-cli', 'sdk', 'acp', 'anima']) {
    const p = bySlug(slug);
    assert.equal(p.delivery, 'cli', `${slug} is expected to be an npm/cli product`);
    const n = noticeFor(slug);
    assert.ok(n, `${slug}: npm products still state maturity`);
    assert.equal(n.channel, 'npm');
    assert.equal(n.smartScreen, false, `${slug}: npm packages do not trigger SmartScreen`);
    assert.equal(n.steps, undefined, `${slug}: no warning means no click-through steps`);
    assert.doesNotMatch(n.detail, /SmartScreen will|installer isn/i, `${slug}: installer language leaked onto an npm package`);
    assert.doesNotMatch(n.short, /SmartScreen/, `${slug}: SmartScreen leaked into the one-liner`);
    assert.match(n.detail, /experimental release/i, `${slug}: should still say experimental`);
  }
});

test('hosted web products get no download notice at all', () => {
  for (const slug of ['image', 'video', 'audio', '3d-gen', 'post']) {
    const p = bySlug(slug);
    assert.equal(installChannel(p), 'hosted', `${slug}: expected a hosted web product`);
    assert.equal(noticeFor(slug), null, `${slug}: a hosted app installs nothing — there is nothing to warn about`);
  }
});

test('products with no published build say nothing', () => {
  // The download gate (4283c0d) already refuses to serve these. The notice must
  // agree: warning about an installer that does not exist invents a product.
  //
  // sheets + notes LEFT this list on 2026-07-27, and slides on 2026-07-28, when
  // each published a real 0.2.0 installer (the withdrawn 0.1.0 builds were
  // scaffolds — sheets/notes predated their own engine commits, and slides could
  // neither open, save-as nor export because its export engines had no caller and
  // were tree-shaken out). Nothing joins the shipping list on a build log alone:
  // each was verified in the packaged asar and by launching the installed app.
  for (const slug of ['pdf', 'photo', 'layout', 'use', 'apps']) {
    const p = bySlug(slug);
    assert.equal(installChannel(p), 'none', `${slug}: expected no install channel`);
    assert.equal(noticeFor(slug), null, `${slug}: nothing ships, so nothing is claimed`);
  }
});

test('the browser extension offers a real download and never claims SmartScreen', () => {
  // extension LEFT the "no published build" list on 2026-08-08: 1.1.0 is on R2 and
  // the page links it, so the visitor gets a working Download button.
  //
  // The earlier version of this gate asserted `externalUrl === undefined`, which
  // pinned a MECHANISM rather than the outcome — and the mechanism was wrong: with
  // no externalUrl the page rendered only "Get notified", so the copy promised a
  // build the page would not hand over. What actually matters is that this product
  // never claims a Windows warning it cannot trigger.
  const p = bySlug('extension');
  const n = noticeFor('extension');
  assert.ok(p.externalUrl, 'extension: the published build must be reachable from the page');
  assert.match(p.externalUrl, /\/apps\/extension\/.*\.zip$/, 'extension: the CTA must point at the published ZIP');
  assert.equal(installChannel(p), 'archive');
  assert.equal(artifactSigning(p), 'none', 'extension: a ZIP of JS has nothing to code-sign');
  assert.ok(n, 'extension: a published build still carries the experimental framing');
  assert.equal(n.smartScreen, false,
    'extension: a ZIP of JavaScript never triggers SmartScreen — claiming it does is the '
    + 'reassuring-direction lie, and it trains people to click through warnings that do not exist');
  assert.equal(productMaturity(p), 'experimental', 'extension: still experimental');
  assert.ok(!/SmartScreen|Run anyway/i.test(`${n.short} ${n.detail} ${(n.steps ?? []).join(' ')}`),
    'extension: no SmartScreen click-through language anywhere in the notice');
});

test('dropping extension\'s signing:none would fabricate a SmartScreen warning', () => {
  // The failure this guards is a one-word deletion: 'archive' DEFAULTS to unsigned,
  // so removing `signing: 'none'` silently turns the notice into "More info → Run
  // anyway" for a dialog that cannot appear. Prove the default is what bites.
  const { signing, ...withoutSigning } = bySlug('extension');
  assert.equal(artifactSigning(withoutSigning), 'unsigned', 'the archive default is unsigned');
  assert.equal(experimentalNotice(withoutSigning).smartScreen, true,
    'without signing:none the notice claims SmartScreen — which is exactly why the field is set');
});

test('sheets + notes + slides ship real unsigned installers and are framed that way', () => {
  // sheets + notes published an experimental, unsigned 0.2.0 on 2026-07-27;
  // slides on 2026-07-28. None sets `signing`, so this also pins the fail-safe
  // default: anything handing a visitor an executable is treated as unsigned
  // until somebody states otherwise.
  for (const slug of ['sheets', 'notes', 'slides']) {
    const p = bySlug(slug);
    assert.equal(p.status, 'beta', `${slug}: a downloadable product is not coming-soon`);
    assert.equal(p.delivery, 'desktop', `${slug}: ships an installer`);
    assert.equal(installChannel(p), 'installer', `${slug}: expected an installer channel`);
    const n = noticeFor(slug);
    assert.ok(n, `${slug}: a real download must carry the notice`);
    assert.equal(n.signing, 'unsigned', `${slug}: no certificate yet — must default unsigned`);
    assert.equal(n.smartScreen, true, `${slug}: an unsigned installer warns on Windows`);
    assert.match(n.label, /experimental/i, `${slug}: shipped as an experimental release`);
    assert.match(n.detail, /SmartScreen/i, `${slug}: the visitor must be told what they will see`);
  }
});

/* ── The off-site case that a delivery-only rule would have missed ─────────── */

test('xeno-rt ships archives, not an installer, and is framed that way', () => {
  const rt = bySlug('rt');
  assert.equal(rt.delivery, 'soon', 'rt stays delivery:soon so the dead R2 button never returns');
  assert.ok(rt.externalUrl, 'rt is distributed off-site (public GitHub release)');
  const n = noticeFor('rt');
  assert.ok(n, 'rt hands out real binaries — it must carry the notice');
  assert.equal(n.channel, 'archive');
  assert.equal(n.signing, 'unsigned');
  assert.equal(n.smartScreen, true);
  assert.match(n.detail, /binaries aren/i);
  assert.doesNotMatch(n.detail, /installer/i, 'rt has no installer to describe');
  // The shared copy must not claim SBOM/attestation for every future archive
  // product — that detail is rt-specific and lives in its content module.
  assert.doesNotMatch(n.detail, /SBOM|attestation/i, 'shared copy must not over-claim provenance');
});

/* ── The exit condition: signing lands, the warning language leaves ────────── */

test("signing:'signed' drops the warning everywhere, and maturity:'stable' clears it entirely", () => {
  const base = { slug: 'x', name: 'X', tagline: '', category: 'Platform', status: 'shipping', delivery: 'desktop' };

  const signedButYoung = experimentalNotice({ ...base, signing: 'signed' });
  assert.ok(signedButYoung, 'an experimental product still says experimental once signed');
  assert.equal(signedButYoung.smartScreen, false);
  assert.doesNotMatch(signedButYoung.detail, /SmartScreen|code-signed/i);

  assert.equal(
    experimentalNotice({ ...base, signing: 'signed', maturity: 'stable' }),
    null,
    'signed + stable has nothing left to disclose',
  );

  // Stable but still unsigned is NOT silent — the Windows warning is real
  // regardless of how mature the code is.
  const stableUnsigned = experimentalNotice({ ...base, maturity: 'stable' });
  assert.ok(stableUnsigned);
  assert.equal(stableUnsigned.smartScreen, true);
  assert.doesNotMatch(stableUnsigned.detail, /experimental/i);
});

/* ── The copy itself has to be usable ─────────────────────────────────────── */

test('the notice answers all four questions a visitor has', () => {
  const n = noticeFor('hub');
  assert.match(n.detail, /experimental release/i, 'what maturity is this');
  assert.match(n.detail, /isn’t code-signed/i, 'is it signed');
  assert.match(n.detail, /Windows protected your PC/, 'what will I see');
  assert.ok(n.steps.some((s) => /More info/i.test(s)), 'how do I proceed');
  assert.match(n.detail, /Code signing is coming/, 'is this permanent');
  assert.match(n.label, /Experimental/, 'the label leads with maturity, not alarm');
});

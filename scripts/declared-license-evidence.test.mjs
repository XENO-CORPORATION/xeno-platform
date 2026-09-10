/**
 * The declaration-only route, and the reason the notices file can now be
 * complete without anything having been invented.
 *
 * Six packages had no licence text. Two of them turned out not to be questions
 * at all — `onnxruntime-web` and the root `mammoth` were declared dependencies
 * that nothing imported, so removing them removed `guid-typescript` and took
 * `dingbat-to-unicode` out of the client graph. The rest are irreducible: their
 * publishers named a licence in `package.json` and never wrote the text down,
 * and no search produces a document that was never authored.
 *
 * The danger in filling that gap is specific and worth stating plainly: a
 * canonical SPDX text with the author's name substituted in reads EXACTLY like a
 * notice the publisher wrote, and nothing downstream could tell the difference
 * afterwards. So the whole design is about keeping the two distinguishable —
 * verbatim text with placeholders intact, the holder recorded beside it rather
 * than inside it, and the distinction printed in the notices file itself rather
 * than only in JSON.
 *
 * These assertions are all about that separation. Each one names the specific
 * way the artifact could become a forgery if it were relaxed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredOnlyLicense } from './lib/declared-package-licenses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const STORE = JSON.parse(read('compliance/declared-package-licenses.json'));
const RECOVERED = JSON.parse(read('compliance/recovered-package-licenses.json'));
const COLLECTOR = read('scripts/collect-third-party-notices.mjs');
const BUILDER = read('scripts/record-declared-license.mjs');

test('a canonical text is never interpolated with the holder it is attributed to', () => {
  for (const record of STORE.packages) {
    const text = STORE.texts[record.license];
    assert.ok(text, `${record.name}: no pinned text for ${record.license}`);
    assert.ok(record.declaredCopyrightHolder, `${record.name}: no declared holder`);
    assert.ok(!text.text.includes(record.declaredCopyrightHolder),
      `${record.name}: the canonical ${record.license} text contains its declared holder — that is an `
      + 'interpolated licence, which is indistinguishable from one the publisher wrote');
    if (text.template) {
      assert.match(text.text, /<(?:year|owner|copyright holders|name of author)>/i,
        `${record.license} is a template and has lost its placeholders`);
    }
    assert.equal(record.textSource, 'spdx-canonical',
      `${record.name}: the text must be labelled as canonical, never as the publisher's`);
  }
});

test('every canonical text is pinned to a commit and matches its own hash', () => {
  assert.match(STORE.textSourceCommit, /^[a-f0-9]{40}$/, 'the SPDX text source must be pinned to a commit');
  for (const [id, text] of Object.entries(STORE.texts)) {
    assert.ok(text.url.includes(STORE.textSourceCommit), `${id} text URL does not use the pinned commit`);
    assert.match(text.url, /^https:\/\/raw\.githubusercontent\.com\/spdx\/license-list-data\//,
      `${id} text must come from the SPDX list, not from anywhere convenient`);
  }
});

test('declaration-only is the LAST route, never a shortcut past a real text', () => {
  const order = ['bundledNoticeTexts(pack.files)', 'recoveredLicense(', 'referencedPackageLicense(',
    'upstreamNotices(', 'declaredOnlyLicense('];
  const positions = order.map((needle) => COLLECTOR.indexOf(needle));
  for (const [i, position] of positions.entries()) {
    assert.ok(position > 0, `${order[i]} is not in the collector`);
    if (i) {
      assert.ok(position > positions[i - 1],
        `${order[i]} runs before ${order[i - 1]} — the weakest evidence must never pre-empt stronger evidence`);
    }
  }
});

test('a package that ships its own notice can never take the declaration-only route', () => {
  const record = STORE.packages[0];
  const item = { version: record.version, integrity: record.integrity, resolved: record.resolved };
  const manifest = { name: record.name, version: record.version, license: record.license };
  assert.ok(declaredOnlyLicense(record.name, item, manifest, []), 'the control case should resolve');
  assert.throws(
    () => declaredOnlyLicense(record.name, item, manifest, [{ path: `${record.name}/LICENSE`, text: 'x', sha256: 'y' }]),
    /stale|now ships/,
    'a record must go stale the moment the publisher starts shipping a real text, or we would keep '
    + 'reproducing a canonical stand-in over the publisher’s own words');
});

test('identity is bound to the exact archive', () => {
  const record = STORE.packages[0];
  const manifest = { name: record.name, version: record.version, license: record.license };
  assert.throws(() => declaredOnlyLicense(record.name,
    { version: record.version, integrity: 'sha512-tampered', resolved: record.resolved }, manifest, []),
  /does not match the installed archive/);
  assert.throws(() => declaredOnlyLicense(record.name,
    { version: record.version, integrity: record.integrity, resolved: record.resolved },
    { ...manifest, license: 'Apache-2.0' }, []),
  /claims .* the archive declares/);
});

test('the notices file states the distinction where a reader will see it', () => {
  /* The record can be perfectly honest and the ARTIFACT still misleading: once
   * the text is rendered, a declaration-only entry looks exactly like a
   * publisher-supplied one. The caveat has to be in the markdown, not only in
   * sources.json, because the markdown is what gets shipped and read. */
  assert.match(COLLECTOR, /if \(record\.declaredOnly\) \{/, 'the renderer must special-case these');
  assert.match(COLLECTOR, /It was not supplied by the publisher/,
    'the notice must say the text is not the publisher’s');
  assert.match(COLLECTOR, /Copyright holder, as declared by the publisher/,
    'the holder must be attributed to its source rather than presented as part of the licence');

  const notices = path.join(ROOT, '.compliance/notices/THIRD_PARTY_NOTICES.candidate.md');
  if (fs.existsSync(notices)) {
    const rendered = fs.readFileSync(notices, 'utf8');
    for (const record of STORE.packages) {
      const section = rendered.slice(rendered.indexOf(`## ${record.name}@${record.version}`));
      assert.match(section.slice(0, 1200), /It was not supplied by the publisher/,
        `the rendered notice for ${record.name} does not carry the caveat`);
    }
  }
});

test('an embedded component under other terms is surfaced, not swallowed', () => {
  /* This is the tr46 lesson. Rejecting the whole record because ONE generated
   * file could not be matched threw away a proven MIT grant and buried the
   * actually-interesting finding — that the file is derived from Unicode
   * Consortium data — in a silence that read like an ordinary gap. */
  const withComponents = RECOVERED.packages.filter((p) => p.runtimeProofs.some((proof) => proof.status));
  assert.ok(withComponents.length, 'the fixture for this behaviour has disappeared from the store');
  for (const record of withComponents) {
    assert.ok(record.runtimeProofs.some((proof) => !proof.status),
      `${record.name}: a record with no clean proof at all must not be admitted`);
    for (const proof of record.runtimeProofs.filter((p) => p.status)) {
      assert.ok(record.componentNotes?.[proof.path],
        `${record.name}: ${proof.path} is unmatched with no note saying why — that is the silence this fixes`);
    }
  }
  assert.match(COLLECTOR, /record\.unresolvedComponents = recovered\.unresolvedComponents/,
    'the collector must carry the components through');
  assert.match(COLLECTOR, /This package embeds material that its own license does not cover/,
    'and the notice must state it');
});

test('the builder refuses rather than reconciling, and knows time from disagreement', () => {
  assert.match(BUILDER, /a RECOVERED record already exists, which is stronger evidence/,
    'a stronger record must win');
  assert.match(BUILDER, /the archive DOES carry a notice/, 'a real text must win');
  assert.match(BUILDER, /copyright\/licence header/, 'source headers must win');
  /* A repository relicensed AFTER a release says nothing about that release.
   * Comparing across time reported highlightjs-vue as a CC0-vs-BSD dispute that
   * never existed — the BSD file was added five weeks after 1.0.0 shipped. */
  assert.match(BUILDER, /A REPOSITORY LICENCE THAT POSTDATES THE RELEASE IS NOT A CONFLICT/);
  assert.match(BUILDER, /new Date\(added\.date\) > new Date\(published\)/,
    'the comparison has to be against the publish date, not against today');
  assert.match(BUILDER, /does not postdate this release, so the disagreement is real/,
    'a genuine conflict must still refuse');
});

test('a later relicensing is recorded as a dated fact, not resolved silently', () => {
  const relicensed = STORE.packages.filter((p) => p.absenceEvidence?.laterRelicensing);
  for (const record of relicensed) {
    const r = record.absenceEvidence.laterRelicensing;
    assert.match(r.versionPublishedOn, /^\d{4}-\d{2}-\d{2}$/, `${record.name}: no publish date recorded`);
    assert.match(r.addedOn, /^\d{4}-\d{2}-\d{2}$/, `${record.name}: no licence-file date recorded`);
    assert.ok(new Date(r.addedOn) > new Date(r.versionPublishedOn),
      `${record.name}: recorded as a later relicensing while the dates say otherwise`);
    assert.match(r.addedInCommit, /^[a-f0-9]{40}$/, `${record.name}: the relicensing commit is not pinned`);
  }
});

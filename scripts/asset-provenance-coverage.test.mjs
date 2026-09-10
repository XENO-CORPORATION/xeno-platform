/**
 * Every shipped asset has a provenance record — and a new one cannot appear
 * without getting one.
 *
 * `compliance/asset-provenance-pending.json` listed fourteen path patterns as
 * `unverified`. On 2026-09-10 all of them were checked BY HASH against the two
 * records written since, and every one of the 39 files they expand to is
 * covered: 23 by the project owner's 2026-09-05 confirmation, 16 by
 * `assets.json` as AI-generated with prompts and a stated rights basis. Nothing
 * was pending. The file was a stale measurement, which is the one kind of claim
 * this workspace corrects rather than builds up to.
 *
 * 🔴 The valuable half is FORWARD, not backward. `public/landing-v3/` is where a
 * stock photograph or a borrowed illustration would land if someone were moving
 * quickly, and it would look exactly like the sixteen legitimate files beside
 * it. This gate is what makes that fail: a file under a covered pattern whose
 * hash appears in neither record is an unrecorded asset, and unrecorded is the
 * state every one of these was in before somebody did the work.
 *
 * It compares hashes, never paths. A path comparison passes when a file is
 * replaced in place with different bytes, which is precisely how an asset gets
 * swapped without anyone noticing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const pending = read('compliance/asset-provenance-pending.json');
const owner = read('compliance/asset-owner-confirmation-2026-09-05.json');
const registry = read('compliance/assets.json');

const ownerHashes = new Set(owner.assets.map((a) => a.sha256));
const registeredHashes = new Map(registry.entries.map((e) => [e.sha256, e]));

function walk(dir) {
  const out = [];
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

/** The patterns here are only ever `dir/*` or `name*.ext`. */
function expand(pattern) {
  const p = pattern.replaceAll('\\', '/');
  if (!p.includes('*')) return fs.existsSync(path.join(ROOT, p)) ? [p] : [];
  const dir = p.slice(0, p.lastIndexOf('/'));
  const tail = p.slice(p.lastIndexOf('/') + 1);
  const re = new RegExp(`^${tail.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return walk(dir).filter((f) => re.test(path.basename(f)));
}

function classify() {
  const seen = new Map();
  for (const asset of pending.assets) {
    for (const file of expand(asset.path)) {
      if (seen.has(file)) continue;
      const hash = sha256(fs.readFileSync(path.join(ROOT, file)));
      seen.set(file, ownerHashes.has(hash) ? 'owner' : registeredHashes.has(hash) ? 'registry' : 'unrecorded');
    }
  }
  return seen;
}

test('the scan reaches real files — an empty expansion is not a clean result', () => {
  /* A glob that matches nothing reads exactly like a repository with nothing to
   * check. This suite has no value at all if the patterns stop resolving, so
   * that is asserted before anything else is concluded from them. */
  const files = classify();
  assert.ok(files.size >= 30,
    `only ${files.size} files expanded from ${pending.assets.length} patterns — the patterns have `
    + 'drifted from the tree, so a pass here would mean nothing');
});

test('every asset under a tracked pattern has a provenance record', () => {
  const files = classify();
  const unrecorded = [...files].filter(([, verdict]) => verdict === 'unrecorded').map(([file]) => file);
  assert.deepEqual(unrecorded, [],
    'these files are in neither the owner confirmation nor assets.json. An asset with no record is '
    + 'indistinguishable from one that was borrowed:\n  ' + unrecorded.join('\n  '));
});

test('the pending file states what is actually pending', () => {
  /* The failure this closes is not a missing record — it is a record that WAS
   * true and stopped being true, left in place because nothing re-read it. That
   * is the most expensive recurring error in this workspace, and it costs one
   * comparison to prevent. */
  const files = classify();
  const unrecorded = [...files.values()].filter((v) => v === 'unrecorded').length;
  if (unrecorded === 0) {
    assert.match(pending.status, /resolved/i,
      `nothing is pending — ${files.size} files all carry a record — but the file still says `
      + `"${pending.status}". A stale measurement is simply wrong; correct it.`);
  } else {
    assert.doesNotMatch(pending.status, /resolved/i,
      `${unrecorded} file(s) have no record while the file claims to be resolved`);
  }
});

test('the AI-generated entries carry a generator, a rights basis and its evidence', () => {
  /* "ai-generated" on its own is a label. What makes it a record is being able
   * to say which tool, on what basis, and where that basis is written down. */
  const files = classify();
  const generated = [...files].filter(([, v]) => v === 'registry').map(([file]) => file);
  assert.ok(generated.length, 'no generated assets found — the fixture for this has moved');
  for (const file of generated) {
    const entry = registeredHashes.get(sha256(fs.readFileSync(path.join(ROOT, file))));
    assert.ok(entry.generator, `${file}: no generator recorded`);
    assert.ok(entry.rights, `${file}: no rights basis recorded`);
    assert.ok(entry.rightsEvidence, `${file}: the rights basis points at no evidence`);
    assert.ok(fs.existsSync(path.join(ROOT, entry.rightsEvidence)),
      `${file}: rightsEvidence names ${entry.rightsEvidence}, which is not in the repo`);
    assert.doesNotMatch(entry.rights, /^cleared|^approved|legal signoff/i,
      `${file}: a rights basis must state a basis, not announce a clearance nobody signed`);
  }
});

test('the owner confirmation still says what it is, and no more', () => {
  assert.match(owner.status, /not-independent-legal-verification/,
    'the confirmation is the project owner\'s statement. The moment it reads as a legal clearance it '
    + 'is claiming something nobody performed.');
  assert.ok(owner.verbatim, 'the owner\'s own words must be retained, not paraphrased into a stronger claim');
  assert.ok(owner.assets.every((a) => /^[a-f0-9]{64}$/.test(a.sha256)),
    'the confirmation must be bound to exact bytes; a path-only confirmation covers whatever replaces it');
});

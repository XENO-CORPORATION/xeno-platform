/**
 * The recovery builder's refusals, checked against the source rather than the
 * network.
 *
 * `scripts/recover-package-license.mjs` writes licence EVIDENCE, so what matters
 * about it is not that it succeeds — it is that it refuses in every case where a
 * record would be a claim rather than a fact. Its success path is proven
 * separately and much more strongly, by `--verify` reproducing the two records
 * that were assembled by hand and are already accepted by
 * `lib/recovered-package-licenses.mjs`:
 *
 *   node scripts/recover-package-license.mjs boolbase --verify
 *   node scripts/recover-package-license.mjs tr46 --version 0.0.3 --verify
 *
 * Both are green as of 2026-09-10 and both hit the registry and GitHub, which is
 * why they are not run here: a default suite that reaches the network fails for
 * reasons that have nothing to do with the code.
 *
 * So this suite pins the REFUSALS, which are the load-bearing half and are
 * readable statically. Each assertion names a way the tool could be softened
 * into producing a plausible record — because "make the gate pass" is exactly
 * the pressure a compliance tool is under.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'scripts/recover-package-license.mjs'), 'utf8');
const PACKET = JSON.parse(fs.readFileSync(path.join(ROOT, 'compliance/rights-review-packet.json'), 'utf8'));
const STORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'compliance/recovered-package-licenses.json'), 'utf8'));

test('a record is never written without a byte-for-byte binding to the artifact', () => {
  /* The runtime proofs ARE the evidence. Without them the record says only that
   * some repository with a matching name contains a licence — which is not a
   * statement about the bytes we install, and is indistinguishable from one. */
  assert.match(SOURCE, /if \(!runtimeProofs\.length\) \{\s*\n\s*die\(/,
    'an empty runtimeProofs list must be fatal, not merely noted');
  assert.match(SOURCE, /if \(sha256\(upstream\.body\) !== local\) continue;/,
    'a file that does not hash identically must be skipped — there is no such thing as a near-match here');
});

test('the pin must be immutable, and a short sha or a branch is not one', () => {
  assert.match(SOURCE, /\/\^\[a-f0-9\]\{40\}\$\/\.test\(COMMIT_OVERRIDE\)/,
    '--commit must be a full 40-hex sha');
  assert.match(SOURCE, /if \(!\/\^\[a-f0-9\]\{40\}\$\/\.test\(record\.commit\)\) die\(/,
    'the assembled record must be re-checked for an unpinned commit before it is written');
});

test('a declaration that disagrees with the repository is refused, not reconciled', () => {
  /* highlightjs-vue is the live case: CC0-1.0 in the manifest, BSD-3-Clause in
   * the repository. Writing the BSD text under the CC0 identifier would attach a
   * byte proof to a grant nobody made — worse than having no record at all. */
  assert.match(SOURCE, /upstreamSpdx !== license/,
    'the manifest declaration and the repository licence must be compared');
  assert.match(SOURCE, /assert a grant nobody made/,
    'the refusal must say why, or the next reader will "fix" it by picking one');
});

test('the artifact is read from the lockfiles and its integrity is enforced', () => {
  assert.match(SOURCE, /verifyIntegrity\(bytes, item\.integrity\)/,
    'the downloaded tarball must be checked against the lockfile hash');
  assert.doesNotMatch(SOURCE, /catch\s*\{\s*\}\s*\n?\s*(?:\/\/.*)?\s*return bytes/,
    'an integrity failure must never be swallowed');
  assert.match(SOURCE, /url\.origin !== 'https:\/\/registry\.npmjs\.org'/,
    'only the public registry is an acceptable origin for an artifact we claim to ship');
});

test('writing never replaces an existing record', () => {
  assert.match(SOURCE, /if \(existing && !VERIFY\) \{/,
    'an existing record must stop the run unless the caller asked to verify it');
  assert.match(SOURCE, /store\.packages\.push\(record\)/,
    'the merge must append');
  assert.doesNotMatch(SOURCE, /store\.packages\s*=\s*\[/,
    'the store must never be rebuilt wholesale — that is how existing evidence disappears');
});

test('every unresolved package carries a stated reason, not a silence', () => {
  /* The point of the 2026-09-10 pass: none of the six could be recovered, and
   * "unresolved" on its own sends the next reader to redo the same work. Each
   * now names its own blocker and its own question. */
  const attempts = PACKET.recoveryAttempts;
  assert.ok(attempts, 'the packet must record what the recovery attempt found');
  const stillMissing = PACKET.missing
    .filter((m) => !STORE.packages.some((p) => p.name === m.name && p.version === m.version))
    .map((m) => `${m.name}@${m.version}`);
  const explained = attempts.packages.map((p) => p.package);
  assert.deepEqual(stillMissing.filter((m) => !explained.includes(m)), [],
    'a package with no licence text and no recorded attempt is exactly the silence this closes');
  for (const entry of attempts.packages) {
    assert.ok(entry.blocker, `${entry.package} has no blocker`);
    assert.ok(entry.question && entry.question.length > 30,
      `${entry.package} has no question a human could actually answer`);
    assert.ok(entry.detail && entry.detail.length > 60, `${entry.package} states no evidence`);
  }
});

test('the packet still signs no determination', () => {
  /* It is a place to put questions. The moment it starts answering them it stops
   * being evidence and becomes an opinion with a schema. */
  assert.equal(PACKET.status, 'awaiting-human-source-and-rights-evidence');
  assert.match(PACKET.note, /No ownership assignment, license exception or determination is signed here/);
  assert.match(PACKET.recoveryAttempts.outcome, /None of the six could be recovered mechanically/);
});

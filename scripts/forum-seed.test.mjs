/**
 * Gates on the seeded Record.
 *
 * 🔴 THIS FILE NEVER IMPORTS THE SEED. `seedForum` writes to the database, and
 * importing a module EXECUTES it — that is ABSOLUTE RULE §2b, written after a
 * session ran `seed-releases.mjs` "to check its syntax" and destroyed the
 * release history of four shipping products. The gates read source.
 *
 * WHY SEEDED CONTENT AT ALL: the Forum's thesis is a compounding archive —
 * asked once, answered once, then it answers itself forever. This ecosystem has
 * 7,000 lines of exactly that in docs/engineering-learnings.md, and an empty
 * forum reads as a dead product (D12). Seeding it is not padding; it is putting
 * the asset where the asset is supposed to live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'src', 'server', 'database', 'seeds', 'forum-seed.js'), 'utf8');

const keys = [...SRC.matchAll(/key: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const usedTags = [...SRC.matchAll(/'((?:product|kind|topic):[a-z0-9-]+)'/g)].map((m) => m[1]);
const declaredTags = [...SRC.matchAll(/\{ namespace: '(\w+)', value: '([a-z0-9-]+)' \}/g)]
  .map((m) => `${m[1]}:${m[2]}`);

test('every thread key is unique', () => {
  // The short id is derived from the key, and the upsert is ON CONFLICT
  // (short_id). Two threads sharing a key would silently overwrite each other
  // and the seed would look like it worked.
  assert.equal(new Set(keys).size, keys.length,
    `duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
});

test('🔴 every tag used is DECLARED', () => {
  // An undeclared tag is created implicitly or dropped depending on the path,
  // and either way the thread stops being findable by the thing it is about —
  // which for a corpus whose only job is to be searchable is total failure.
  const missing = [...new Set(usedTags)].filter((t) => !declaredTags.includes(t));
  assert.deepEqual(missing, [], `tags used but never declared: ${missing.join(', ')}`);
});

test('the seed is IDEMPOTENT — re-running updates, never duplicates', () => {
  // §2b: merge or refuse, never silently replace. Here the correct behaviour is
  // merge, because the seed is the source of truth for its own rows.
  assert.match(SRC, /ON CONFLICT \(short_id\) DO UPDATE/,
    'threads must upsert on the derived short id.');
  assert.match(SRC, /ON CONFLICT \(thread_id, position\) DO UPDATE/,
    'posts must upsert on their position.');
  assert.match(SRC, /ON CONFLICT \(slug\) DO UPDATE/, 'spaces must upsert.');
  assert.match(SRC, /ON CONFLICT \(namespace, value\) DO UPDATE/, 'tags must upsert.');
});

test('🔴 PROVENANCE IS HONEST — seeded content says it is seeded', () => {
  // The archive must never pass itself off as something a user wrote. Every
  // seeded row carries the source, and the UI renders it (SourceNote). A corpus
  // that lies about its own origin is worse than an empty one, because the
  // first real user cannot tell which answers came from a person.
  assert.match(SRC, /const SEED_SOURCE = 'seed:engineering-learnings'/,
    'the source must be a named constant, not a literal scattered per-row.');
  const inserts = SRC.match(/SEED_SOURCE/g) || [];
  assert.ok(inserts.length >= 4,
    'the source must be written on the thread AND its posts, not just one of them.');
});

test('every thread has a body AND an answer', () => {
  // A seeded question with no answer is an open question nobody will answer,
  // which makes the archive look abandoned on day one.
  // ⚠️ \r?\n, not \n. The working tree is CRLF (git autocrlf) and the first
  // version split on bare \n, found ZERO threads, and failed — correctly, but
  // for the wrong reason. Every line-oriented assertion in this repo needs the
  // optional \r; several mutations earlier in this work silently no-opped for
  // exactly this.
  const threads = SRC.split(/\r?\n  \{\r?\n    key: /).slice(1);
  assert.ok(threads.length >= 8, `expected the extended set, found ${threads.length}`);
  for (const t of threads) {
    const key = (t.match(/^'([a-z0-9-]+)'/) || [])[1] || '?';
    // Either shape is fine — an array joined with newlines, or a single string
    // for a one-line report. The first version demanded `body: [` and failed on
    // a legitimate entry; a gate that enforces a style rather than a property
    // costs more than it catches.
    assert.match(t, /body: (\[|')/, `${key} has no body`);
    assert.match(t, /answer: (\[|')/, `${key} has no answer`);
  }
});

test('🔴 every thread carries a product: tag', () => {
  // Loop D's predicates filter on `product:`. A thread without one is invisible
  // to EVERY product digest — it exists in the Record and no dev agent will ever
  // be shown it, which is the quietest possible way for the archive to fail.
  //
  // This gate found `blurry-at-100` tagged only `kind:bug` + `topic:canvas-rendering`.
  const threads = SRC.split(/\r?\n  \{\r?\n    key: /).slice(1);
  const untagged = threads
    .map((t) => ({
      key: (t.match(/^'([a-z0-9-]+)'/) || [])[1],
      tags: (t.match(/tags: \[([^\]]*)\]/) || [])[1] || '',
    }))
    .filter((t) => !/product:/.test(t.tags))
    .map((t) => t.key);
  assert.deepEqual(untagged, [],
    `no product: tag, so invisible to every product digest: ${untagged.join(', ')}`);
});

test('titles are SYMPTOMS, not diagnoses', () => {
  // "that is literally how a user reports it" — and how the next person
  // searches. A title naming the root cause is findable only by someone who
  // already knows the root cause, which is precisely the person who does not
  // need the thread.
  const titles = [...SRC.matchAll(/title: '([^']+)'|title: "([^"]+)"/g)]
    .map((m) => m[1] || m[2]);
  assert.ok(titles.length >= 8, 'expected a title per thread');
  const diagnostic = titles.filter((t) => /race condition|null pointer|regression in/i.test(t));
  assert.deepEqual(diagnostic, [],
    `these titles name a cause rather than a symptom: ${diagnostic.join(' | ')}`);
});

test('the corpus spans more than one product', () => {
  // A single-product archive cannot demonstrate the cross-product pattern the
  // learnings file exists to capture, and gives Loop D nothing to compare.
  const products = new Set(usedTags.filter((t) => t.startsWith('product:')));
  assert.ok(products.size >= 2, `only ${products.size} product(s) represented`);
});

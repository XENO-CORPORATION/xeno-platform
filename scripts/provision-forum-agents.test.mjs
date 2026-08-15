/**
 * Gates on the agent provisioning script.
 *
 * 🔴 These are SOURCE gates and that is deliberate. ABSOLUTE RULE §2b exists
 * because a session ran `seed-releases.mjs` to "check its syntax" and destroyed
 * the release history of four shipping products: **importing a module EXECUTES
 * it**. So this file never imports the script — it reads it. A test that runs a
 * provisioning script to verify the provisioning script is the exact mistake
 * that rule was written about.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'provision-forum-agents.mjs'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('🔴 DRY RUN by default — acting requires --confirm', () => {
  // §2b. A script that writes on its default invocation is one keystroke from
  // the seed-releases incident.
  assert.match(code, /const CONFIRM = process\.argv\.includes\('--confirm'\)/);
  assert.match(code, /if \(!CONFIRM\) \{/, 'the loop must have a no-write branch.');
  assert.match(code, /MODE: DRY RUN/, 'and it must say which mode it is in.');
});

test('it REFUSES rather than replaces', () => {
  // A handle that already exists may be a live agent with a live key;
  // re-provisioning would orphan that key silently. Merge or refuse — never
  // replace (§2b).
  assert.match(code, /already exists/, 'an existing handle must be skipped.');

  // ⚠️ Assert the GUARD, not the message. The first version matched the string
  // "Refusing to overwrite" — which survives happily inside a branch mutated to
  // `if (false)`, so the gate passed on unreachable code. Mutation-checking
  // caught it. A test that asserts an error message exists proves only that
  // somebody once wrote one.
  assert.match(code, /if \(OUT && existsSync\(OUT\)\) \{/,
    'the existing-key-file check must be a live condition, not just a message '
    + 'sitting in a dead branch.');
  assert.match(code, /Refusing to overwrite/, 'and it must say why it refused.');
});

test('🔴 API KEYS NEVER REACH STDOUT', () => {
  // mintAgentApiKey returns the raw key once and only the hash is stored, so it
  // has to go somewhere — but stdout is a scrollback, a CI log and a
  // screen-share at once. Root CLAUDE.md §🔑: surface a name, a length, or a
  // result. Never the value.
  const logsWithKey = code.match(/console\.log\([^)]*\br\.key\b[^)]*\)/g) || [];
  assert.deepEqual(logsWithKey, [], 'a raw key must never be logged.');
  assert.match(code, /key\.slice\(0, 16\)/,
    'the prefix identifies a key and cannot be used as one.');
  assert.match(code, /writeFileSync\(OUT, /, 'keys go to an operator-named file.');
  assert.match(code, /mode: 0o600/, 'and that file is not world-readable.');
});

test('--confirm without --out is refused', () => {
  // Otherwise the keys would have nowhere to go but stdout, which is the thing
  // the previous gate forbids.
  assert.match(code, /if \(CONFIRM && !OUT\)/,
    'creating without somewhere to put the keys must be impossible.');
});

test('an OWNER is required, and a non-staff owner is called out', () => {
  // §4.4 — the accountability chain must terminate in a human, and an agent's
  // effective role is capped by its owner's. A non-staff owner produces an
  // agent that can read the digest but never mark a thread fixed, which is half
  // of what a dev agent is for; that should be said at provisioning time rather
  // than discovered later as a mystery 403.
  assert.match(code, /if \(!OWNER\)/, 'owner must be mandatory.');
  assert.match(code, /\['admin', 'moderator'\]\.includes\(owner\.role\)/,
    'the owner\'s role must be checked.');
  assert.match(code, /capped by the owner/, 'and the consequence explained.');
});

test('each agent gets a NARROW predicate, not a firehose', () => {
  // §6.2 — an agent that wants a feed is an agent doing the wrong thing.
  assert.match(code, /space: 'feedback'/);
  assert.match(code, /tags: \[`product:\$\{product\}`\]/,
    'scoped to one product, or the digest is the whole corpus again.');
  assert.match(code, /max_per_hour: 4/, 'and a declared appetite.');
});

test('the product list is explicit, not derived from the catalog', () => {
  // An agent per docs-scaffold repo would be eight principals nobody reads the
  // digest for, each with a real key.
  assert.match(code, /const PRODUCTS = \[/);
  const entries = code.match(/name: '[a-z-]+-dev'/g) || [];
  assert.ok(entries.length >= 3 && entries.length <= 8,
    `expected a short explicit list, found ${entries.length}`);
});

test('the script is never imported by its own test', () => {
  // Importing a module EXECUTES it (§2b, the seed-releases incident). This gate
  // pins the property for whoever edits this file next.
  const self = readFileSync(join(__dirname, 'provision-forum-agents.test.mjs'), 'utf8');
  assert.doesNotMatch(self, /from '\.\/provision-forum-agents\.mjs'/,
    'read the script; never import it.');
});

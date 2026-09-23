/**
 * Every object type that WRITES a `parent` tuple must have a declared answer to whether it
 * inherits through it.
 *
 * WHY THIS EXISTS: `authzReBAC.js` narrowed the userset rewrite from "follow a `parent` tuple
 * for ANY object type" to an explicit allow-list, and stated that every type writing such a
 * tuple was listed. It was not. The list came from grepping `src/server` alone, so `schedule`
 * and `skill` -- which write their tuples from the suite that defines the behaviour -- lost
 * inheritance silently. The user who owned a project stopped being able to read its schedule's
 * run history (404) and a skill stopped being reachable through its conversation.
 *
 * The narrowing was right; the enumeration was not checkable. This makes it checkable: the
 * write sites are DERIVED, so a new type gets a decision the day someone writes its tuple,
 * rather than inheriting whatever the allow-list happens to say.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inheritsFromParent } from '../src/server/utils/authzReBAC.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* A type may be listed here ONLY with a reason that says why authority must NOT flow. An empty
 * allow-list of refusals is the honest starting state -- nothing has needed one yet. */
const DELIBERATELY_REFUSED = {
  // 'division': 'a division inside a division is STRUCTURAL, not containment (XENO-WORKFORCE-01 §21)',
};

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) yield* sourceFiles(full);
    else if (/\.(mjs|js|ts)$/.test(entry)) yield full;
  }
}

/** Object types written as `<type>:<id>` with `relation: 'parent'`, and the parent's type. */
function parentWriteSites() {
  const found = new Map();
  const pattern = /object: *`([a-z_]+):\$\{[^}]*\}`[^}]*relation: *'parent'[^}]*subject: *`([a-z_]+):/g;
  for (const file of [...sourceFiles(join(ROOT, 'src', 'server')), ...sourceFiles(join(ROOT, 'scripts'))]) {
    const body = readFileSync(file, 'utf8');
    for (const [, child, parent] of body.matchAll(pattern)) {
      if (child.includes('${') || child === 'objectType') continue; // caller-supplied, see WORKSPACE_SCOPED
      if (!found.has(child)) found.set(child, { parent, file: file.slice(ROOT.length) });
    }
  }
  return found;
}

test('the write-site scan finds something, so an empty result cannot pass vacuously', () => {
  const sites = parentWriteSites();
  assert.ok(sites.size >= 3, `expected several parent write sites, found ${sites.size}`);
  assert.ok(sites.has('conversation'), 'conversation writes a parent tuple and must be seen');
});

test('every type that writes a parent tuple has a DECLARED inheritance answer', () => {
  const undeclared = [];
  for (const [child, { parent, file }] of parentWriteSites()) {
    if (DELIBERATELY_REFUSED[child]) continue;
    if (!inheritsFromParent(child, parent)) undeclared.push(`${child} -> ${parent}  (${file})`);
  }
  assert.deepEqual(undeclared, [],
    'these types write a `parent` tuple but do not inherit through it. Either add the type to '
    + 'PARENT_INHERITS in authzReBAC.js, or list it in DELIBERATELY_REFUSED above WITH the reason '
    + 'authority must not flow:\n  ' + undeclared.join('\n  '));
});

test('the two types this gate was written for inherit, and a workspace parent still does', () => {
  // Named explicitly: these are the regressions that went unnoticed until a suite that had
  // never run was finally executed.
  assert.equal(inheritsFromParent('schedule', 'project'), true);
  assert.equal(inheritsFromParent('skill', 'conversation'), true);
  // Containment by construction — the workspace is the tenant — for any child type.
  assert.equal(inheritsFromParent('anything_at_all', 'workspace'), true);
});

test('an undeclared type does NOT inherit, so the narrowing still holds', () => {
  // The whole point of the allow-list: a type nobody declared must not quietly gain authority.
  assert.equal(inheritsFromParent('some_new_type', 'project'), false);
  assert.equal(inheritsFromParent('division', 'division'), false);
});

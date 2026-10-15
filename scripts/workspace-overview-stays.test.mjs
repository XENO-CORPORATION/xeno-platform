/**
 * Opening a feature never moves you to another area (owner, 2026-10-14).
 *
 * On Overview you see every area's things in one place, each labelled with its area. Opening Storage or a
 * Studio tool from there must keep you on Overview (#/overview/p/storage), not jump to the feature's
 * "home" area. The workspace router already keeps the current context (app.js `go`); the defect was three
 * places that navigated by a HARD-CODED area address (#/corpo/p/storage, #/studio/p/<type>). This gate
 * refuses that shape in every workspace script.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'prototypes/xeno-workspace';
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
// the router's own address codec and its documentation examples are the only places an area id may be literal
const ALLOWED = new Set(['address.js']);

test('no workspace feature navigates by a hard-coded area address', () => {
  const offenders = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    readFileSync(join(dir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
      // a navigation call whose FIRST target is a literal area path; a fallback after `XW.go` is allowed
      const m = /XENO_ADDR\.(?:go|push|replace)\(\s*[`'"]#\/(?!overview\b)([a-z]+)\//.exec(line);
      if (m && !/XW\?*\.go\(/.test(line.slice(0, m.index))) offenders.push(`${f}:${i + 1} → #/${m[1]}/…`);
    });
  }
  assert.deepEqual(offenders, [], 'open features with XW.go (keeps the current area), never a literal #/<area>/ address');
});

test('Tasks names each task\'s area on Overview', () => {
  const src = readFileSync(join(dir, 'platform-tasks.js'), 'utf8');
  assert.match(src, /const areaChip = \(t\) => \(!P\.area\(\) && t\.area/, 'the area label shows only on Overview');
  // the project chip (328d21c2, "names where it lives") comes first; the area chip follows it in the same strip
  assert.match(src, /tk-card-f">(?:\$\{projChip\(t\)\})?\$\{areaChip\(t\)\}/, 'on cards');
  assert.match(src, /tk-row-x">(?:\$\{projChip\(t\)\})?\$\{areaChip\(t\)\}/, 'and on rows');
});

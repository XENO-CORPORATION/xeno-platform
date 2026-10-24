/**
 * Every migration's UP section runs at least one statement.
 *
 * migrationRunner.js splits a file at the first line matching /^--\s*DOWN\b/im. A header comment that STARTS a line with
 * "DOWN" ("-- DOWN removes exactly them.") therefore ends the UP section inside the header: the migration is recorded as
 * applied and creates nothing. Found 2026-10-24 on 20261030130000-skills-library.sql, where the tables were missing and
 * the runner reported success. This reads each file the way the runner does and fails on an UP with no SQL in it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server/database/migrations');
const DOWN = /^--\s*DOWN\b/im;   // the runner's own marker (migrationRunner.js parse)

test('every migration UP section contains SQL, not only comments', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length > 100, 'the migrations directory was not found');
  const empty = files.filter((f) => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    const m = DOWN.exec(text);
    const up = (m ? text.slice(0, m.index) : text).replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/[a-z]/i.test(up);
  });
  assert.deepEqual(empty, [], 'these migrations end their UP section before any statement (a line starting "-- DOWN" in a comment?)');
});

/**
 * Two migrations may never share a version.
 *
 * This gate exists because it was already broken. On 2026-09-22 a migration landing as
 * `20260904140000-workspace-api-keys.sql` collided with the existing
 * `20260904140000-workspace-operational-teams.sql`. The runner keys `schema_migrations` on the
 * VERSION, not the filename, so the second one to apply died with
 *
 *   duplicate key value violates unique constraint "schema_migrations_version_key"
 *
 * — and it does not fail only for the colliding pair. It aborts the whole run, so EVERY suite
 * that boots a schema fails, on a database that is otherwise fine. `suspension-gate` and
 * `browser-bff-session` both went red with no relationship to the change; the error names a
 * constraint rather than a file, so it reads as database corruption rather than as two files
 * sharing fourteen digits.
 *
 * A filename collision is invisible to every other check in this repo: both files exist, both
 * are valid SQL, both apply cleanly in isolation, and `ls` sorts them adjacently without
 * comment. Only the runner notices, and only at deploy time.
 *
 * Run: node --test scripts/migration-versions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/server/database/migrations');

const migrations = () =>
  readdirSync(DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => ({ file: f, version: /^(\d{14})/.exec(f)?.[1] ?? null }));

test('every migration carries a 14-digit version prefix', () => {
  const malformed = migrations().filter(m => !m.version).map(m => m.file);
  assert.deepEqual(malformed, [],
    `migrations whose filename does not begin with a 14-digit version: ${malformed.join(', ')}. ` +
    `The runner parses the version from the filename; one it cannot parse is one it cannot record.`);
});

test('no two migrations share a version', () => {
  const byVersion = new Map();
  for (const { file, version } of migrations()) {
    if (!version) continue;
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  const collisions = [...byVersion.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => `${version}: ${files.join(' + ')}`);

  assert.deepEqual(collisions, [],
    `migrations sharing a version: ${collisions.join('; ')}.\n` +
    `schema_migrations has a UNIQUE constraint on version, so the second to apply aborts the ` +
    `ENTIRE run — every suite that boots a schema fails, not just these. Renumber the one that ` +
    `has never been applied anywhere; renumbering an applied migration orphans its recorded row.`);
});

test('the set is non-trivial, so a broken directory read cannot pass vacuously', () => {
  assert.ok(migrations().length > 30,
    `found ${migrations().length} migrations; expected the real directory. ` +
    `A gate that reads nothing reports no collisions.`);
});

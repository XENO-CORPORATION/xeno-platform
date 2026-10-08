// A migration's identity is its version AND its name.
// Production once applied a migration from a build that was never pushed, under a version the repository uses for a
// different file. Keyed on the version alone, the runner would have skipped the repository's migration in silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appliedIndex, isApplied, recordAs, foreignRows, duplicateVersions, collisionKey } from '../src/server/services/migrationRunner.js';

const gifts = { version: '20261004120000', name: 'workforce-gifts' };
const returns = { version: '20261004130000', name: 'workforce-gift-returns' };

test('a file whose version and name are recorded is applied', () => {
  const index = appliedIndex([{ version: '20261004120000', name: 'workforce-gifts' }]);
  assert.equal(isApplied(index, gifts), true);
  assert.equal(recordAs(index, gifts), '20261004120000');
});

test('a file whose version is recorded under another name is still pending', () => {
  const index = appliedIndex([{ version: '20261004120000', name: 'provider-usage-receipts' }]);
  assert.equal(isApplied(index, gifts), false, 'the production case: workforce-gifts must not be skipped');
  assert.equal(recordAs(index, gifts), '20261004120000+workforce-gifts');
});

test('once recorded under its collision key, it is applied and is not run again', () => {
  const index = appliedIndex([{ version: '20261004120000', name: 'provider-usage-receipts' }, { version: collisionKey(gifts), name: 'workforce-gifts' }]);
  assert.equal(isApplied(index, gifts), true);
});

test('a file with a free version is recorded under that version', () => {
  const index = appliedIndex([{ version: '20261004120000', name: 'provider-usage-receipts' }]);
  assert.equal(isApplied(index, returns), false);
  assert.equal(recordAs(index, returns), '20261004130000');
});

test('a row with no file is reported as foreign, and a collision row is not', () => {
  const index = appliedIndex([{ version: '20261004120000', name: 'provider-usage-receipts' }, { version: collisionKey(gifts), name: 'workforce-gifts' }, { version: '20261004130000', name: 'workforce-gift-returns' }]);
  assert.deepEqual(foreignRows(index, [gifts, returns]), [{ version: '20261004120000', name: 'provider-usage-receipts' }]);
});

test('two files with one version are refused before anything runs', () => {
  assert.deepEqual(duplicateVersions([gifts, { version: '20261004120000', name: 'other' }, returns]), ['20261004120000: workforce-gifts and other']);
  assert.deepEqual(duplicateVersions([gifts, returns]), []);
});

test('the runner uses the identity check in every place it decides what is applied', () => {
  const src = readFileSync(new URL('../src/server/services/migrationRunner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /applied\.has\(m\.version\)|applied\.has\(migration\.version\)\s*\)/, 'no decision may rest on the version alone');
  assert.match(src, /const pending = migrations\.filter\(m => !isApplied\(applied, m\)\)/);
  assert.match(src, /\[recorded, migration\.name\]/);
});

test('no two migration files in the repository share a version', () => {
  const files = readdirSync(new URL('../src/server/database/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
  const migrations = files.map((f) => { const m = f.match(/^(\d{14})[-_](.+)\.sql$/); return m ? { version: m[1], name: m[2] } : null; }).filter(Boolean);
  assert.ok(migrations.length > 100, 'the migrations folder was read');
  assert.deepEqual(duplicateVersions(migrations), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { childEnvironment, assertLocalDocker, assertOwnedDatabase, assertScratchPath,
  parseTapSummary, parseMoneySummary, parseBackendSummary, assertRestored, pinnedQualificationImage, normalizeSchemaDefinition, requireLegacySchemas } from './lib/platform-qualification.mjs';

const tap = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('backend qualification requires the named positive summary, exactly once, and exit zero', () => {
  const good = 'ledger-v2: 12 passed, 0 failed';
  assert.equal(parseBackendSummary(good, 0, 'ledger-v2').passed, 12);
  for (const output of ['', good + good, good.replace('12 passed', '0 passed'), good.replace('0 failed', '1 failed'), good.replace('ledger-v2', 'other')]) {
    assert.throws(() => parseBackendSummary(output, 0, 'ledger-v2'));
  }
  assert.throws(() => parseBackendSummary(good, 1, 'ledger-v2'));
  assert.throws(() => parseBackendSummary(good, 0, '.*'));
});
test('qualification refuses skipped, TODO, cancelled, failing, empty or ambiguous results', () => {
  assert.equal(parseTapSummary(tap, 0).pass, 2);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.throws(() => parseTapSummary(tap.replace(`# ${key} 0`, `# ${key} 1`), 0));
  for (const value of ['', tap + tap, tap.replace('# tests 2', '# tests 0'), tap.replace('# pass 2', '# pass 1')]) assert.throws(() => parseTapSummary(value, 0));
  assert.throws(() => parseTapSummary(tap, 1));
});
test('money qualification requires its explicit successful summary and exit status', () => {
  assert.equal(parseMoneySummary('billing-money-in: 51 passed, 0 failed', 0).passed, 51);
  for (const value of ['', 'billing-money-in: 0 passed, 0 failed', 'billing-money-in: 50 passed, 1 failed']) assert.throws(() => parseMoneySummary(value, 0));
  assert.throws(() => parseMoneySummary('billing-money-in: 51 passed, 0 failed', 1));
});
test('child environment contains local fixtures, not inherited provider credentials or execution hooks', () => {
  const env = childEnvironment({ PATH: 'bin', STRIPE_SECRET_KEY: 'live', OPENAI_API_KEY: 'paid', NODE_OPTIONS: '--import evil',
    DATABASE_URL: 'production', HTTPS_PROXY: 'remote', XENO_EMBEDDING_BASE_URL: 'https://paid.example' }, '/scratch', 'postgresql://local');
  assert.equal(env.PATH, 'bin'); assert.equal(env.DATABASE_URL, 'postgresql://local');
  for (const name of ['STRIPE_SECRET_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'HTTPS_PROXY']) assert.equal(env[name], undefined);
  assert.equal(env.XENO_EMBEDDING_BASE_URL, 'http://127.0.0.1:1');
  assert.equal(env.TMPDIR, '/scratch');
});
test('Docker and database cleanup cannot target remote contexts or unowned resources', () => {
  assertLocalDocker('npipe:////./pipe/dockerDesktopLinuxEngine'); assertLocalDocker('unix:///var/run/docker.sock');
  for (const host of ['tcp://localhost:2375', 'ssh://prod', '', 'npipe://remote/pipe/docker']) assert.throws(() => assertLocalDocker(host));
  const name = `xeno_qual_${'a'.repeat(32)}`;
  assert.equal(assertOwnedDatabase(name, new Set([name])), `"${name}"`);
  for (const bad of ['postgres', 'xeno_ui_local_qual', `${name};DROP DATABASE postgres`, name]) assert.throws(() => assertOwnedDatabase(bad, new Set()));
  assert.throws(() => assertOwnedDatabase('postgres', new Set(['postgres'])));
});
test('scratch cleanup is exactly one owned child, not a broad or sibling path', () => {
  const parent = path.resolve('temporary-parent');
  assertScratchPath(parent, path.join(parent, 'scratch'));
  for (const bad of [parent, path.join(parent, '..'), path.join(parent, 'other'), path.join(parent, 'scratch', 'nested')]) assert.throws(() => assertScratchPath(parent, bad));
});
test('restore comparison detects changed content even with equal counts and changed sequence state', () => {
  const snapshot = { data: [{ table: 'credits', count: '1', digest: 'abc' }], schema: ['index'], sequences: [{ last_value: '2' }] };
  assertRestored(snapshot, structuredClone(snapshot));
  const changed = structuredClone(snapshot); changed.data[0].digest = 'tampered'; assert.throws(() => assertRestored(snapshot, changed));
  const sequence = structuredClone(snapshot); sequence.sequences[0].last_value = '1'; assert.throws(() => assertRestored(snapshot, sequence));
});
test('qualification uses the canonical immutable pgvector image and refuses a floating tag', () => {
  const source = readFileSync(new URL('./remote-chat-database-cutover.sh', import.meta.url), 'utf8');
  assert.match(pinnedQualificationImage(source), /@sha256:[a-f0-9]{64}$/);
  assert.throws(() => pinnedQualificationImage('PGVECTOR_IMAGE="pgvector/pgvector:latest"'));
});
test('restore schema normalization accepts only lossless literal varchar-array cast distribution', () => {
  const before = "CHECK (role = ANY ((ARRAY['user'::character varying, 'can''t, split'::character varying])::text[]))";
  const after = "CHECK (role = ANY (ARRAY[('user'::character varying)::text, ('can''t, split'::character varying)::text]))";
  assert.equal(normalizeSchemaDefinition(before), after);
  assert.equal(normalizeSchemaDefinition(after), after);
  for (const changed of [after.replace('user', 'admin'), after.replace(' = ', ' <> '), after.replace('::text', '::integer')]) {
    assert.notEqual(normalizeSchemaDefinition(before), normalizeSchemaDefinition(changed));
  }
  const otherType = before.replaceAll('character varying', 'integer');
  assert.equal(normalizeSchemaDefinition(otherType), otherType);
});
test('qualification refuses missing or empty legacy startup schemas', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xeno-qualification-unit-'));
  try {
    const dir = path.join(root, 'src/server/database'); await mkdir(dir, { recursive: true });
    await assert.rejects(requireLegacySchemas(root));
    await writeFile(path.join(dir, 'youtube-schema.sql'), 'SELECT 1;');
    await assert.rejects(requireLegacySchemas(root));
    await writeFile(path.join(dir, 'office-canvas-schema.sql'), '');
    await assert.rejects(requireLegacySchemas(root));
    await writeFile(path.join(dir, 'office-canvas-schema.sql'), 'SELECT 1;');
    await requireLegacySchemas(root);
  } finally { await rm(root, { recursive: true }); }
});
test('restore comparison preserves money-protection triggers and functions', () => {
  const source = readFileSync(new URL('./lib/platform-qualification.mjs', import.meta.url), 'utf8');
  for (const required of ['pg_get_triggerdef', 't.tgenabled', 'pg_get_functiondef', 'pg_policies', 'relforcerowsecurity']) assert.ok(source.includes(required));
  const before = { schema: [{ kind: 'trigger', definition: 'ledger immutable' }, { kind: 'function', definition: 'raise exception' }] };
  assert.throws(() => assertRestored(before, { schema: before.schema.slice(1) }));
  assert.throws(() => assertRestored(before, { schema: [before.schema[0], { kind: 'function', definition: 'return new' }] }));
});

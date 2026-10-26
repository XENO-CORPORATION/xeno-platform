import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSpawnProfileBundle, SPAWN_PROFILE_VENDORS } from '../src/lib/spawnProfileBundle.js';

test('a website-created profile is a Spawn sync bundle, with no files that could carry a credential or transcript', () => {
  const bundle = buildSpawnProfileBundle({ id: '123e4567-e89b-42d3-a456-426614174000', name: '  Research  ', vendor: 'claude', provider: 'xeno' });
  assert.deepEqual(bundle, {
    schema: 1,
    id: '123e4567-e89b-42d3-a456-426614174000',
    name: 'Research',
    vendor: 'claude',
    provider: 'xeno',
    agentId: null,
    files: {},
  });
  assert.deepEqual(SPAWN_PROFILE_VENDORS, ['claude', 'codex', 'agy', 'opencode', 'xeno-agent']);
});

test('invalid website profile input is refused before any request body exists', () => {
  assert.throws(() => buildSpawnProfileBundle({ id: 'not-a-uuid', name: 'x', vendor: 'claude', provider: null }), /profile id/);
  assert.throws(() => buildSpawnProfileBundle({ id: '123e4567-e89b-42d3-a456-426614174000', name: ' ', vendor: 'claude', provider: null }), /name/);
  assert.throws(() => buildSpawnProfileBundle({ id: '123e4567-e89b-42d3-a456-426614174000', name: 'x', vendor: 'unknown', provider: null }), /agent/);
  assert.throws(() => buildSpawnProfileBundle({ id: '123e4567-e89b-42d3-a456-426614174000', name: 'x', vendor: 'claude', provider: 'other' }), /sign in/);
});

test('the account page, route, nav and service are wired to the existing profile sync API', () => {
  const service = readFileSync(new URL('../src/services/spawnProfileService.ts', import.meta.url), 'utf8');
  const overview = readFileSync(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../src/components/account/AccountSettingsNav.tsx', import.meta.url), 'utf8');
  assert.match(service, /\/api\/v2\/spawn\/profiles/);
  assert.match(service, /method: 'PUT'/);
  assert.match(service, /baseRev: 0/);
  assert.match(overview, /path="spawn-profiles" element=\{<SpawnProfilesPage \/>\}/);
  assert.match(nav, /Spawn profiles/);
});

test('a rename from the website changes only the name: config files and everything else go back as they were', async () => {
  const { renameSpawnProfileBundle } = await import('../src/lib/spawnProfileBundle.js');
  const synced = { schema: 1, id: 'a1b2', name: 'work', vendor: 'claude', provider: 'vendor', agentId: 'agt_1', files: { 'claude/settings.json': '{"model":"opus"}' } };
  const renamed = renameSpawnProfileBundle(synced, '  Client work  ');
  assert.deepEqual(renamed, { ...synced, name: 'Client work' });
  assert.equal(synced.name, 'work', 'the profile read from the account is not changed in place');
  assert.throws(() => renameSpawnProfileBundle(synced, ' '), /name/);
  assert.throws(() => renameSpawnProfileBundle(synced, 'x'.repeat(61)), /name/);
});

test('rename and remove name the revision they were based on, so a change made on a device is never overwritten', () => {
  const service = readFileSync(new URL('../src/services/spawnProfileService.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/components/account/SpawnProfilesPage.tsx', import.meta.url), 'utf8');
  assert.match(service, /renameSpawnProfileBundle\(profile\.bundle, name\)/, 'rename starts from the synced bundle, never an empty one');
  assert.equal((service.match(/baseRev: profile\.rev/g) ?? []).length, 2, 'rename and remove both send the revision they read');
  assert.match(service, /method: 'DELETE'/);
  assert.match(service, /\/api\/v2\/spawn\/devices/);
  assert.match(page, /isStaleProfile\(err\)/, 'a stale revision reloads the list instead of failing silently');
  assert.doesNotMatch(page, /window\.confirm|confirm\(/, 'removal asks in the page, never in a native dialog');
});

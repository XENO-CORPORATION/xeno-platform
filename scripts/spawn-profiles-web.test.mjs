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

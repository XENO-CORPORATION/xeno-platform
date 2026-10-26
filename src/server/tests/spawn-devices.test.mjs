/**
 * spawn-devices.test.mjs — /api/v2/spawn/devices handlers over a fake db (the route's own queries, no server needed):
 * a device checks in under the token's account only, its name is one clean line, and forgetting it touches only that row.
 * Run: node --test src/server/tests/spawn-devices.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnDeviceHandlers, cleanDeviceName } from '../routes/spawnDeviceRoutes.js';

/** In-memory stand-in honouring exactly the three queries the handlers make. */
function fakeDb() {
  /** @type {Map<string, any>} */ const rows = new Map();
  let clock = 0;
  return {
    rows,
    async query(/** @type {string} */ sql, /** @type {any[]} */ p = []) {
      if (sql.startsWith('SELECT')) return { rows: [...rows.values()].filter(r => r.user_id === p[0]).sort((a, b) => b.last_sync_at - a.last_sync_at) };
      if (sql.startsWith('INSERT')) {
        const [user_id, device_id, name, version, profiles, conflicts] = p;
        rows.set(`${user_id}|${device_id}`, { user_id, device_id, name, version, profiles, conflicts, last_sync_at: ++clock });
        return { rows: [] };
      }
      if (sql.startsWith('DELETE')) { rows.delete(`${p[0]}|${p[1]}`); return { rows: [] }; }
      throw new Error(`unhandled query: ${sql.slice(0, 40)}`);
    },
  };
}
const A = '0f0e0d0c-0b0a-4908-8706-050403020100', B = '1f0e0d0c-0b0a-4908-8706-050403020100';

test('a device checks in under the account and is listed newest first; a second check-in updates it', async () => {
  const db = fakeDb(), h = spawnDeviceHandlers(db);
  assert.equal((await h.checkIn('user-a', A, { name: 'DESKTOP-1', version: '0.1.0-rc.81', profiles: 3, conflicts: 0 })).status, 200);
  assert.equal((await h.checkIn('user-a', B, { name: 'LAPTOP', profiles: 1 })).status, 200);
  await h.checkIn('user-a', A, { name: 'DESKTOP-1', version: '0.1.0-rc.81', profiles: 4, conflicts: 1 });
  const listed = (await h.list('user-a')).devices;
  assert.deepEqual(listed.map(d => [d.deviceId, d.profiles, d.conflicts]), [[A, 4, 1], [B, 1, 0]]);
  assert.equal(listed[1].version, null);
});

test('one account never sees or forgets another account’s device', async () => {
  const db = fakeDb(), h = spawnDeviceHandlers(db);
  await h.checkIn('user-a', A, { name: 'MINE' });
  assert.deepEqual((await h.list('user-b')).devices, []);
  await h.forget('user-b', A);
  assert.equal((await h.list('user-a')).devices.length, 1, 'forgetting under another account removed nothing');
  await h.forget('user-a', A);
  assert.equal((await h.list('user-a')).devices.length, 0);
});

test('bad input is refused before anything is written', async () => {
  const db = fakeDb(), h = spawnDeviceHandlers(db);
  assert.equal((await h.checkIn('user-a', 'not-a-uuid', { name: 'X' })).status, 400);
  assert.equal((await h.checkIn('user-a', A, { name: '   ' })).status, 400);
  assert.equal((await h.checkIn('user-a', A, { name: 'X', profiles: -1 })).status, 400);
  assert.equal((await h.checkIn('user-a', A, { name: 'X', conflicts: 1.5 })).status, 400);
  assert.equal((await h.forget('user-a', '../x')).status, 400);
  assert.equal(db.rows.size, 0);
});

test('a device name is one line with no control characters, at most 120 characters', () => {
  assert.equal(cleanDeviceName('  DESKTOP\u0007\n  9LJ2CLU  '), 'DESKTOP 9LJ2CLU');
  assert.equal(cleanDeviceName('x'.repeat(200))?.length, 120);
  assert.equal(cleanDeviceName('‮'), null);
});

test('the route is mounted behind the same account auth as the profiles route', () => {
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /app\.use\('\/api\/v2\/spawn\/devices', databaseMiddleware, oidcAuth, spawnDeviceRoutes\)/);
  const migration = readFileSync(new URL('../database/migrations/20261101090000-spawn-sync-devices.sql', import.meta.url), 'utf8');
  assert.match(migration, /PRIMARY KEY \(user_id, device_id\)/);
  assert.match(migration, /-- DOWN\s+DROP TABLE IF EXISTS spawn_sync_devices;/);
});

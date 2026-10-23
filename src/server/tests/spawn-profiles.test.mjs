/**
 * spawn-profiles.test.mjs — /api/v2/spawn/profiles handlers over a fake db
 * (the route's own queries, no server needed). Covers the spec's acceptance:
 * subject isolation, optimistic revision conflicts, credential/transcript
 * refusal, tombstones. The live SQL + auth wiring is covered by the deployed
 * smoke against the account.
 * Run: node tests/spawn-profiles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnProfileHandlers, bundleViolations } from '../routes/spawnProfileRoutes.js';

/** In-memory stand-in honouring exactly the three queries the handlers make. */
function fakeDb() {
  /** @type {Map<string, any>} */ const rows = new Map();
  const key = (/** @type {string} */ u, /** @type {string} */ p) => `${u}|${p}`;
  return {
    rows,
    async query(/** @type {string} */ sql, /** @type {any[]} */ [u, p, rev, bundle] = []) {
      if (sql.startsWith('SELECT profile_id')) return { rows: [...rows.values()].filter(r => r.user_id === u).map(r => ({ profile_id: r.profile_id, rev: r.rev, bundle: r.bundle, deleted: r.deleted, updated_at: r.updated_at })) };
      if (sql.startsWith('SELECT rev')) { const r = rows.get(key(u, p)); return { rows: r ? [{ rev: r.rev, deleted: r.deleted }] : [] }; }
      if (sql.startsWith('INSERT')) {
        const deleted = sql.includes('NULL,TRUE') || bundle === null && sql.includes('deleted = TRUE');
        rows.set(key(u, p), { user_id: u, profile_id: p, rev, bundle: deleted ? null : JSON.parse(bundle ?? 'null'), deleted, updated_at: new Date() });
        return { rows: [] };
      }
      throw new Error(`unhandled query: ${sql.slice(0, 40)}`);
    },
  };
}
const bundle = { name: 'work', vendor: 'claude', files: { 'settings.json': '{}' } };

test('put then list round-trips under the subject, with rev starting at 1', async () => {
  const h = spawnProfileHandlers(fakeDb());
  assert.deepEqual(await h.put('user-a', 'prof_1', 0, bundle), { status: 200, body: { profileId: 'prof_1', rev: 1 } });
  const listed = await h.list('user-a');
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].bundle.name, 'work');
});

test('another account sees nothing and cannot base a write on it', async () => {
  const h = spawnProfileHandlers(fakeDb());
  await h.put('user-a', 'prof_1', 0, bundle);
  assert.deepEqual(await h.list('user-b'), { profiles: [] });
  const stolen = await h.put('user-b', 'prof_1', 1, bundle); // rev 1 exists only for user-a; user-b's base is 0
  assert.equal(stolen.status, 409, 'user-b cannot base a write on user-a\'s revision');
  assert.equal((await h.put('user-b', 'prof_1', 0, bundle)).status, 200, 'user-b can create its own prof_1 from base 0');
});

test('a stale base revision is a 409 and changes nothing', async () => {
  const db = fakeDb(); const h = spawnProfileHandlers(db);
  await h.put('user-a', 'prof_1', 0, bundle);
  const stale = await h.put('user-a', 'prof_1', 0, { ...bundle, name: 'overwritten' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.currentRev, 1);
  assert.equal((await h.list('user-a')).profiles[0].bundle.name, 'work', 'the first write stands');
});

test('credential files and transcripts are refused server-side too', async () => {
  const h = spawnProfileHandlers(fakeDb());
  assert.equal((await h.put('user-a', 'prof_1', 0, { files: { '.credentials.json': 'token' } })).status, 400);
  assert.equal((await h.put('user-a', 'prof_1', 0, { files: { 'config/auth.json': 'token' } })).status, 400);
  assert.equal((await h.put('user-a', 'prof_1', 0, { files: { 'projects/x/abc.jsonl': 'chat' } })).status, 400);
  assert.match(bundleViolations({ files: { '.credentials.json': 'x' } }).join(' '), /credential file refused/);
});

test('delete tombstones with its own revision; a later put resurrects from the tombstone rev', async () => {
  const h = spawnProfileHandlers(fakeDb());
  await h.put('user-a', 'prof_1', 0, bundle);
  assert.deepEqual(await h.remove('user-a', 'prof_1', 1), { status: 200, body: { profileId: 'prof_1', rev: 2, deleted: true } });
  const listed = await h.list('user-a');
  assert.equal(listed.profiles[0].deleted, true);
  assert.equal(listed.profiles[0].bundle, undefined);
  assert.equal((await h.put('user-a', 'prof_1', 2, bundle)).status, 200);
});

test('bad profile ids and oversize bundles are refused', async () => {
  const h = spawnProfileHandlers(fakeDb());
  assert.equal((await h.put('user-a', '../escape', 0, bundle)).status, 400);
  assert.equal((await h.put('user-a', 'prof_1', 0, { files: { 'big.txt': 'x'.repeat(300 * 1024) } })).status, 400);
});

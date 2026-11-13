/**
 * Spawn backup, standard mode: the account wrap of the data key (wrap type 0x03, the iCloud model), on a real database.
 *
 *  - only an APPROVED device hands the key to the account; the stored wrap is not the key;
 *  - a registered device gets the key back; a revoked or unknown device, or another account, does not;
 *  - a device's FIRST unwrap needs a sign-in in the last 10 minutes and mails the person once; later unwraps do not;
 *  - every unwrap is logged, and GET /keys shows the account copy and the last unwrap;
 *  - a wrap is bound to its account and row: moved anywhere else it does not open; no key configured → refused;
 *  - private mode deletes the account wrap for real; device envelopes still can never be deleted, except with the account.
 *
 * Mutation-checked: remove the fresh-sign-in check in getAccount and "a first unwrap with an old sign-in is refused" fails.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/spawn-backup-account-wrap.test.mjs
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { spawnBackupKeyHandlers, FIRST_UNWRAP_FRESH_SEC } from '../routes/spawnBackupRoutes.js';
import { unwrapDataKey, KekUnavailableError } from '../utils/spawnBackupKek.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const env = { SPAWN_BACKUP_KEK: crypto.randomBytes(32).toString('hex'), SPAWN_BACKUP_KEK_VERSION: '1' };
const b64 = () => crypto.randomBytes(32).toString('base64url');
const NOW = Date.now();
const fresh = Math.floor(NOW / 1000) - 60;                          // signed in a minute ago
const stale = Math.floor(NOW / 1000) - FIRST_UNWRAP_FRESH_SEC - 60;  // signed in eleven minutes ago

async function main() {
  await runAllMigrations(pool);
  const user = async (n) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`,
    [`${n}${Date.now()}`, `${n}${Date.now()}@xeno.test`])).rows[0].id;
  const ada = await user('aw_ada'), eve = await user('aw_eve');
  const h = spawnBackupKeyHandlers(pool);
  const A = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID();
  await h.register(ada, A, { publicKey: b64(), name: 'Desk PC', wrappedKey: b64() });       // first device: approved
  await h.register(ada, B, { publicKey: b64(), name: 'New laptop' });                          // pending
  await h.register(ada, C, { publicKey: b64(), name: 'Old PC' });
  await h.revoke(ada, C, { byDeviceId: A });
  const dataKey = crypto.randomBytes(32);
  const sent = [];
  const notify = (n) => { sent.push(n); };

  try {
    check((await h.setAccount(ada, { byDeviceId: B, dataKey: dataKey.toString('base64url') }, env)).status === 403, 'a pending device cannot hand the key to the account');
    const put = await h.setAccount(ada, { byDeviceId: A, dataKey: dataKey.toString('base64url') }, env);
    check(put.status === 201 && put.body.account.kekVersion === 1, 'an approved device hands the key to the account (201, key version 1)');
    check((await h.setAccount(ada, { byDeviceId: A, dataKey: dataKey.toString('base64url') }, env)).body.replayed === true, 'the same key again is a replay, not a new wrap');
    const row = (await pool.query("SELECT * FROM spawn_backup_keys WHERE user_id=$1 AND kind='account' AND state='current'", [ada])).rows[0];
    check(row && !row.wrapped_key.includes(dataKey.toString('base64url')) && !Buffer.from(row.wrapped_key, 'base64url').includes(dataKey), 'the database holds only the wrap, never the key');

    const tooOld = await h.getAccount(ada, B, { authTime: stale, now: NOW, env, notify });
    check(tooOld.status === 401 && tooOld.body.error.code === 'RECENT_SIGN_IN_REQUIRED', 'a first unwrap with an old sign-in is refused');
    check(sent.length === 0 && !(await pool.query("SELECT 1 FROM spawn_backup_key_events WHERE user_id=$1 AND kind='account_unwrapped'", [ada])).rows.length, 'and leaves no log entry and sends no mail');
    const got = await h.getAccount(ada, B, { authTime: fresh, now: NOW, env, notify });
    await new Promise((r) => setImmediate(r));
    check(got.status === 200 && Buffer.from(got.body.dataKey, 'base64url').equals(dataKey) && got.body.firstUnwrap === true, 'a registered device signed in just now gets the key (the iCloud part: no other device approves it)');
    check(sent.length === 1 && sent[0].deviceName === 'New laptop' && sent[0].userId === ada, 'the person is mailed once, with the device name');
    const again = await h.getAccount(ada, B, { authTime: stale, now: NOW, env, notify });
    await new Promise((r) => setImmediate(r));
    check(again.status === 200 && again.body.firstUnwrap === false && sent.length === 1, 'a repeat unwrap by the same device needs no fresh sign-in and sends no second mail');
    check((await pool.query("SELECT count(*)::int c FROM spawn_backup_key_events WHERE user_id=$1 AND kind='account_unwrapped' AND device_id=$2", [ada, B])).rows[0].c === 2, 'every unwrap is logged with the device');
    check((await h.getAccount(ada, C, { authTime: fresh, now: NOW, env })).status === 403, 'a revoked device gets nothing');
    check((await h.getAccount(ada, crypto.randomUUID(), { authTime: fresh, now: NOW, env })).status === 403, 'an unregistered device gets nothing');
    check((await h.getAccount(eve, B, { authTime: fresh, now: NOW, env })).status === 403, "another account cannot use this account's device");
    const list = await h.list(ada);
    check(list.body.account.present === true && list.body.account.lastUnwrapAt && list.body.events.some((e) => e.kind === 'account_unwrapped' && e.deviceId === B), 'GET /keys shows the account copy, the last unwrap and each unwrap');

    let moved = null; try { unwrapDataKey(row.wrapped_key, { userId: eve, wrapId: row.id, version: 1 }, env); } catch (e) { moved = e; }
    check(moved !== null, 'a wrap moved to another account does not open');
    let otherRow = null; try { unwrapDataKey(row.wrapped_key, { userId: ada, wrapId: crypto.randomUUID(), version: 1 }, env); } catch (e) { otherRow = e; }
    check(otherRow !== null, 'a wrap moved to another row does not open');
    let noKek = null; try { await h.getAccount(ada, B, { authTime: fresh, now: NOW, env: {} }); } catch (e) { noKek = e; }
    check(noKek instanceof KekUnavailableError, 'with no platform key configured nothing is unwrapped (the route answers 503)');
    let otherKek = null; try { await h.getAccount(ada, B, { authTime: fresh, now: NOW, env: { SPAWN_BACKUP_KEK: crypto.randomBytes(32).toString('hex') } }); } catch (e) { otherKek = e; }
    check(otherKek !== null, 'a different platform key does not open it');

    let deviceDelete = null; try { await pool.query("DELETE FROM spawn_backup_keys WHERE user_id=$1 AND kind='device'", [ada]); } catch (e) { deviceDelete = e; }
    check(deviceDelete !== null, 'a device envelope can never be deleted');
    check((await h.deleteAccount(ada, { byDeviceId: B })).status === 403, 'a device without the key cannot remove the account copy');
    check((await h.deleteAccount(ada, { byDeviceId: A })).status === 204, 'private mode: an approved device deletes the account copy (204)');
    check(!(await pool.query("SELECT 1 FROM spawn_backup_keys WHERE user_id=$1 AND kind='account'", [ada])).rows.length, 'it is really gone, superseded copies too');
    check((await h.getAccount(ada, B, { authTime: fresh, now: NOW, env })).status === 404, 'after it, no device can get the key from the account');
    check((await pool.query("SELECT 1 FROM spawn_backup_key_events WHERE user_id=$1 AND kind='account_wrap_deleted'", [ada])).rows.length === 1, 'the deletion is logged');

    await pool.query('DELETE FROM users WHERE id=$1', [ada]);
    check(!(await pool.query('SELECT 1 FROM spawn_backup_keys WHERE user_id=$1', [ada])).rows.length, "deleting the account still removes all of its keys");
  } finally {
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

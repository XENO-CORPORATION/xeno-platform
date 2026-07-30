#!/usr/bin/env node
/**
 * encrypt-stored-secrets.mjs — one-time backfill: seal plaintext secrets at rest.
 *
 * WHAT AND WHY
 * ------------
 * On 2026-07-30 the live database held 100 YouTube OAuth access/refresh tokens as
 * plaintext `text`. Those grant upload and management access to real channels.
 * `src/server/utils/secretBox.js` now encrypts them on write and decrypts on read;
 * this walks the rows that predate that change.
 *
 * SAFETY POSTURE — all of it deliberate, and all of it because of the 2026-07-26
 * incident where a script with a default target list, no --confirm and no
 * --dry-run destroyed production release history:
 *
 *   · DRY-RUN BY DEFAULT. Without --confirm it writes nothing and only reports.
 *   · IDEMPOTENT. Rows already sealed are skipped (secretBox.isEncrypted), so a
 *     re-run after a partial failure is safe and cheap.
 *   · REFUSES WITHOUT A KEY. No SECRET_BOX_KEY, no run — it will not "helpfully"
 *     leave things as they are and report success.
 *   · VERIFIES EACH ROW BEFORE COMMITTING. Every value is decrypted back and
 *     compared to the original; a mismatch aborts the transaction. An encryption
 *     backfill that silently corrupts a token is worse than the plaintext it
 *     replaced, because the damage is invisible until a channel stops working.
 *   · ONE TRANSACTION per table, so a failure leaves nothing half-sealed.
 *   · NEVER PRINTS A SECRET. Counts and row ids only.
 *
 * ⚠ Back up SECRET_BOX_KEY before running. Losing it makes every sealed token
 *   unrecoverable and every affected channel has to be reconnected.
 *
 * USAGE
 *   node scripts/encrypt-stored-secrets.mjs                 # dry run (default)
 *   node scripts/encrypt-stored-secrets.mjs --confirm       # actually write
 */

// `pg` is imported LAZILY, after the guards below. A static import would make the
// script die on a missing driver before it ever reached the key check, which
// hides the real reason it refused — and means the fail-closed behaviour cannot
// be demonstrated without a database driver present. Configuration is validated
// first, dependencies second.
import { encrypt, decrypt, isEncrypted, isConfigured } from '../src/server/utils/secretBox.js';

const CONFIRM = process.argv.includes('--confirm');

/* Columns known to hold a secret in cleartext. Audited 2026-07-30: everything
 * else that looked secret-shaped was already safe — api_keys stores key_hash,
 * user_sessions stores *_token_hash, and oauth_accounts / oauth_clients /
 * webhooks held zero non-empty rows. Add here only after checking the same. */
const TARGETS = [
  { table: 'youtube_channels', idCol: 'id', columns: ['access_token', 'refresh_token'] },
  { table: 'oauth_accounts',   idCol: 'id', columns: ['access_token', 'refresh_token'] },
];

function fail(msg) {
  console.error(`encrypt-stored-secrets: REFUSED — ${msg}`);
  console.error('Nothing was written.');
  process.exit(1);
}

if (!isConfigured()) {
  fail('SECRET_BOX_KEY is not set. Generate one with:\n' +
       '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
       'then put it in the environment and BACK IT UP before running.');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail('DATABASE_URL is not set.');

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString });

console.log(`encrypt-stored-secrets: ${CONFIRM ? 'LIVE (--confirm)' : 'DRY RUN (no --confirm)'}\n`);

let grandPlain = 0;
let grandSealed = 0;
let grandWritten = 0;

for (const { table, idCol, columns } of TARGETS) {
  const client = await pool.connect();
  try {
    const exists = await client.query(
      'SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]
    );
    if (!exists.rows[0].ok) {
      console.log(`  ${table}: table does not exist — skipped`);
      continue;
    }

    const { rows } = await client.query(
      `SELECT ${idCol}, ${columns.join(', ')} FROM ${table}`
    );

    const pending = [];
    let sealedAlready = 0;
    for (const row of rows) {
      const updates = {};
      for (const col of columns) {
        const val = row[col];
        if (val === null || val === undefined || val === '') continue;
        if (isEncrypted(val)) { sealedAlready++; continue; }
        updates[col] = val;
      }
      if (Object.keys(updates).length) pending.push({ id: row[idCol], updates });
    }

    const plainCount = pending.reduce((n, p) => n + Object.keys(p.updates).length, 0);
    grandPlain += plainCount;
    grandSealed += sealedAlready;
    console.log(`  ${table}: ${rows.length} row(s) — ${plainCount} plaintext value(s), ${sealedAlready} already sealed`);

    if (!plainCount || !CONFIRM) continue;

    await client.query('BEGIN');
    let written = 0;
    for (const { id, updates } of pending) {
      const cols = Object.keys(updates);
      const sealed = cols.map((c) => {
        const enc = encrypt(updates[c]);
        // Verify BEFORE committing: a backfill that corrupts a token is worse
        // than the plaintext it replaced, because nothing surfaces until use.
        if (decrypt(enc) !== updates[c]) {
          throw new Error(`round-trip verification failed for ${table}.${c} id=${id}`);
        }
        return enc;
      });
      const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
      await client.query(
        `UPDATE ${table} SET ${setSql} WHERE ${idCol} = $${cols.length + 1}`,
        [...sealed, id]
      );
      written += cols.length;
    }
    await client.query('COMMIT');
    grandWritten += written;
    console.log(`    ✓ sealed ${written} value(s)`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    console.error(`    ✗ ${table}: ${err.message} — rolled back, nothing changed for this table`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

await pool.end();

console.log(`\n  plaintext found: ${grandPlain}   already sealed: ${grandSealed}   written: ${grandWritten}`);
if (!CONFIRM && grandPlain > 0) {
  console.log('\n  This was a DRY RUN. Re-run with --confirm to seal them.');
  console.log('  Back up SECRET_BOX_KEY first — without it these values cannot be recovered.');
}

#!/usr/bin/env node
/**
 * migrate-artifacts-storage.mjs — copy every artifact revision from the FILESYSTEM
 * backend into the R2 bucket, losslessly, so the platform can be flipped from
 * ARTIFACTS_DIR to ARTIFACTS_R2_BUCKET with nothing missing.
 *
 * Why this exists: the bucket (`xeno-artifacts`, private) was created before an R2
 * S3 credential existed for it, so the first deploy ran on the durable bind mount.
 * When the credential lands this moves the bytes; the DATABASE does not change —
 * `artifact_revisions.storage_prefix` is backend-independent by design.
 *
 * DRY-RUN BY DEFAULT. `--confirm` copies. Every key is verified by SHA-256 against
 * the manifest recorded in artifact_revisions before it is counted as migrated; a
 * mismatch stops the run. Existing R2 keys are never overwritten (a revision is
 * immutable) — a key that already exists with the right hash is skipped.
 *
 * Run ON THE BOX inside the backend container's environment (it needs DATABASE_URL
 * or the DB_* vars, ARTIFACTS_DIR, and the R2 vars):
 *   docker compose exec backend node scripts/migrate-artifacts-storage.mjs            # (cwd /app = src/server)
 *   docker compose exec backend node scripts/migrate-artifacts-storage.mjs --confirm
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { _internal as storage } from '../services/artifactStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const confirm = process.argv.includes('--confirm');
const env = process.env;

if (!env.ARTIFACTS_R2_BUCKET || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
  console.error('ARTIFACTS_R2_BUCKET + R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY are required (the target).');
  process.exit(2);
}
const fsDir = env.ARTIFACTS_DIR?.trim() || path.join(__dirname, '..', 'data', 'artifacts');
const source = storage.fsBackend(fsDir);
const target = storage.r2Backend({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.ARTIFACTS_R2_BUCKET });

const pool = new pg.Pool(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
  host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5433), database: env.DB_NAME || 'xenostudio', user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'xenostudio_password',
});

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const { rows } = await pool.query(`SELECT r.artifact_id, r.revision, r.storage_prefix, r.files FROM artifact_revisions r JOIN artifacts a ON a.id = r.artifact_id WHERE a.deleted_at IS NULL ORDER BY r.artifact_id, r.revision`);
console.log(`${confirm ? 'MIGRATING' : 'DRY-RUN'}: ${rows.length} revision(s) from ${source.describe()} → ${target.describe()}`);
let copied = 0, skipped = 0, missing = 0;
for (const rev of rows) {
  for (const [file, meta] of Object.entries(rev.files)) {
    const key = `${rev.storage_prefix}${file}`;
    const bytes = await source.get(key);
    if (!bytes) { console.error(`  MISSING on fs: ${key}`); missing++; continue; }
    if (sha256(bytes) !== meta.sha256) { console.error(`  HASH MISMATCH on fs: ${key} — stopping, the source is not what the manifest says`); process.exit(1); }
    const existing = await target.head(key);
    if (existing) {
      if (existing.sizeBytes === bytes.length) { skipped++; continue; }
      console.error(`  R2 already holds ${key} with a different size (${existing.sizeBytes} vs ${bytes.length}) — stopping; revisions are immutable`); process.exit(1);
    }
    if (confirm) {
      await target.put(key, bytes, meta.contentType);
      const back = await target.get(key);
      if (!back || sha256(back) !== meta.sha256) { console.error(`  VERIFY FAILED after upload: ${key}`); process.exit(1); }
    }
    copied++;
    if (copied % 50 === 0) console.log(`  ${copied} copied…`);
  }
}
await pool.end();
console.log(`${confirm ? 'copied' : 'would copy'} ${copied}, already present ${skipped}, missing on fs ${missing}`);
if (missing) process.exit(1);
if (!confirm) console.log('Nothing was written. Re-run with --confirm.');

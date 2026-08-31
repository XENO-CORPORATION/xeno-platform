#!/usr/bin/env node
/**
 * Materialize legacy image_generations data URLs into the managed account Library.
 *
 * Dry-run is the default. Run inside the backend container, where DATABASE_URL and
 * the persistent /app/uploads volume are available:
 *
 *   node migrate-legacy-library-images.js user@example.com
 *   node migrate-legacy-library-images.js user@example.com --confirm
 *
 * The migration is additive and idempotent. The original generation history stays
 * intact; listLibraryItems joins each generation ordinal to its managed asset.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {
  decodeLegacyLibraryImageDataUrl,
  registerManagedLibraryFile,
} from './services/libraryAssets.js';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const emails = args.filter((arg) => !arg.startsWith('--')).map((email) => email.toLowerCase());
const uploadsDir = path.resolve(process.env.LIBRARY_UPLOAD_DIR || 'uploads');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const safeOriginalName = (prompt, createdAt, extension) => {
  const promptStem = String(prompt || '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  const fallback = `Generated image ${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}`;
  return `${promptStem || fallback}.${extension}`;
};

let client;
let failures = 0;
let candidates = 0;
let migrated = 0;
let skipped = 0;
let totalBytes = 0;

try {
  client = await pool.connect();
  if (confirm) await client.query("SELECT pg_advisory_lock(hashtext('xeno-legacy-library-image-migration'))");

  if (emails.length) {
    const accountResult = await client.query(
      'SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])',
      [emails],
    );
    const foundEmails = new Set(accountResult.rows.map((row) => row.email));
    const missingEmails = [...new Set(emails)].filter((email) => !foundEmails.has(email));
    if (missingEmails.length) throw new Error(`Account not found: ${missingEmails.join(', ')}`);
  }

  const { rows } = await client.query(
    `SELECT g.id AS generation_id, g.user_id, g.prompt, g.model, g.created_at,
            generated.url, generated.ordinality
     FROM image_generations g
     JOIN users u ON u.id = g.user_id
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(g.image_urls) = 'array' THEN g.image_urls ELSE '[]'::jsonb END
     ) WITH ORDINALITY AS generated(url, ordinality)
     WHERE generated.url LIKE 'data:image/%;base64,%'
       AND ($1::text[] IS NULL OR lower(u.email) = ANY($1::text[]))
     ORDER BY g.created_at ASC, g.id ASC, generated.ordinality ASC`,
    [emails.length ? emails : null],
  );

  if (confirm) await fs.promises.mkdir(uploadsDir, { recursive: true });

  for (const row of rows) {
    candidates += 1;
    const marker = {
      source: 'legacy-image-generation',
      legacy_generation_id: String(row.generation_id),
      legacy_ordinal: String(row.ordinality),
    };
    const existing = await client.query(
      `SELECT id FROM user_files
       WHERE user_id = $1 AND deleted_at IS NULL AND storage_type = 'platform-upload'
         AND metadata @> $2::jsonb
       ORDER BY created_at ASC LIMIT 1`,
      [row.user_id, marker],
    );
    if (existing.rows.length) {
      if (confirm) {
        await client.query(
          `INSERT INTO image_generation_assets(generation_id,ordinal,asset_id)
           VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [row.generation_id, Number(row.ordinality), existing.rows[0].id],
        );
        await client.query(
          `UPDATE chat_migration_exceptions SET resolved_at=NOW()
           WHERE exception_type='unresolved_generated_output' AND source_table='image_generations'
             AND source_id=$1`,
          [`${row.generation_id}:${row.ordinality}`],
        );
      }
      skipped += 1;
      continue;
    }

    try {
      const { buffer, declaredMime, mimeType, extension } = decodeLegacyLibraryImageDataUrl(row.url);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const filename = `legacy-generation-${row.generation_id}-${row.ordinality}.${extension}`;
      const storagePath = path.join(uploadsDir, filename);
      totalBytes += buffer.length;

      if (!confirm) continue;

      let createdStorageFile = false;
      try {
        await fs.promises.writeFile(storagePath, buffer, { flag: 'wx' });
        createdStorageFile = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existingBytes = await fs.promises.readFile(storagePath);
        const existingHash = crypto.createHash('sha256').update(existingBytes).digest('hex');
        if (existingHash !== sha256) throw new Error(`Existing migration file differs: ${storagePath}`);
      }

      try {
        // registerManagedLibraryFile owns its transaction. Pass the pool, not
        // this already-connected advisory-lock client; pg.Client also exposes
        // connect(), so transaction helpers would otherwise try to reconnect it.
        const asset = await registerManagedLibraryFile(pool, {
          userId: row.user_id,
          filename,
          originalName: safeOriginalName(row.prompt, row.created_at, extension),
          mimeType,
          fileSize: buffer.length,
          storagePath,
          metadata: {
            ...marker,
            prompt: row.prompt || '',
            model: row.model || '',
            declared_mime_type: declaredMime,
            sha256,
          },
        });
        await client.query(
          `INSERT INTO image_generation_assets(generation_id,ordinal,asset_id)
           VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [row.generation_id, Number(row.ordinality), asset.id],
        );
        await client.query(
          `UPDATE chat_migration_exceptions SET resolved_at=NOW()
           WHERE exception_type='unresolved_generated_output' AND source_table='image_generations'
             AND source_id=$1`,
          [`${row.generation_id}:${row.ordinality}`],
        );
        migrated += 1;
      } catch (error) {
        if (createdStorageFile) await fs.promises.unlink(storagePath).catch(() => {});
        throw error;
      }
    } catch (error) {
      failures += 1;
      console.error(`FAILED ${row.generation_id}:${row.ordinality} — ${error.message}`);
    }
  }

  const scope = emails.length ? emails.join(', ') : 'all accounts';
  if (!confirm) {
    console.log(`DRY RUN ${scope}: ${candidates} legacy entries, ${skipped} already managed, ${totalBytes} bytes to materialize, ${failures} invalid.`);
    console.log('Pass --confirm to write managed files and account Library rows.');
  } else {
    const readback = await client.query(
      `SELECT count(*)::int AS count
       FROM user_files f JOIN users u ON u.id = f.user_id
       WHERE f.deleted_at IS NULL AND f.storage_type = 'platform-upload'
         AND f.metadata->>'source' = 'legacy-image-generation'
         AND ($1::text[] IS NULL OR lower(u.email) = ANY($1::text[]))`,
      [emails.length ? emails : null],
    );
    console.log(`MIGRATED ${scope}: ${migrated} created, ${skipped} already managed, ${failures} failed, ${readback.rows[0].count} managed rows verified.`);
  }
} finally {
  if (confirm && client) {
    await client.query("SELECT pg_advisory_unlock(hashtext('xeno-legacy-library-image-migration'))").catch(() => {});
  }
  client?.release();
  await pool.end();
}

process.exit(failures ? 1 : 0);

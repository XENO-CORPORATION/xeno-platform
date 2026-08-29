import crypto from 'crypto';
import fs from 'fs';

import { CHAT_PROJECT_CONTRACTS } from '../../config/chatProjectContracts.js';
import { withTransaction } from '../chatProjectAuthority.js';
import { sniffMime } from '../libraryAssets.js';

function safeCode(error) {
  const value = String(error?.code || 'asset_backfill_failed');
  return /^[a-z0-9_]{1,64}$/i.test(value) ? value : 'asset_backfill_failed';
}

async function recordFailure(db, assetId, error) {
  await db.query(
    `INSERT INTO chat_migration_exceptions(exception_type, source_table, source_id, details)
     VALUES ('asset_backfill_failed', 'user_files', $1, jsonb_build_object('code', $2))
     ON CONFLICT(exception_type, source_table, source_id) DO UPDATE SET
       details=EXCLUDED.details, created_at=NOW(), resolved_at=NULL`,
    [assetId, safeCode(error)],
  );
}

export async function backfillLibraryAssets(db, {
  batchSize = 50,
  readFile = fs.promises.readFile,
  transaction = withTransaction,
} = {}) {
  const boundedBatchSize = Math.min(Math.max(Number(batchSize) || 50, 1), 500);
  const semanticEnabled = CHAT_PROJECT_CONTRACTS.retrieval.semanticEnabledByDefault
    && process.env.CHAT_SEMANTIC_RETRIEVAL !== '0';
  const count = await db.query(
    `SELECT count(*)::integer AS count
     FROM user_files f
     WHERE f.deleted_at IS NULL AND (
       f.content_sha256 IS NULL
       OR NOT EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id=f.id)
     )`,
  );
  const result = {
    source: Number(count.rows[0]?.count || 0),
    migrated: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
  };
  let cursor = null;

  while (true) {
    const page = await db.query(
      `SELECT f.id, f.storage_path, f.file_size, f.mime_type, f.content_sha256
       FROM user_files f
       WHERE f.deleted_at IS NULL
         AND ($1::uuid IS NULL OR f.id > $1)
         AND (
           f.content_sha256 IS NULL
           OR NOT EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id=f.id)
         )
       ORDER BY f.id
       LIMIT $2`,
      [cursor, boundedBatchSize],
    );
    if (!page.rows.length) break;

    for (const asset of page.rows) {
      cursor = asset.id;
      try {
        const bytes = await readFile(asset.storage_path);
        if (bytes.length !== Number(asset.file_size)) {
          throw Object.assign(new Error('Managed byte length does not match the canonical asset'), {
            code: 'asset_size_mismatch',
          });
        }
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (asset.content_sha256 && asset.content_sha256 !== digest) {
          throw Object.assign(new Error('Managed bytes do not match the canonical digest'), {
            code: 'asset_digest_mismatch',
          });
        }
        const mimeType = sniffMime(bytes, asset.mime_type);
        const outcome = await transaction(db, async (tx) => {
          const updated = await tx.query(
            `UPDATE user_files SET content_sha256=$2, mime_type=$3
             WHERE id=$1 AND deleted_at IS NULL
             RETURNING id`,
            [asset.id, digest, mimeType],
          );
          if (!updated.rowCount) return { migrated: false, queued: false };
          const ingestion = await tx.query(
            `INSERT INTO library_asset_ingestions(
               asset_id, content_sha256, mime_type, state,
               embedding_model_id, embedding_dimensions, semantic_status
             ) VALUES ($1, $2, $3, 'quarantined', $4, $5, $6)
             ON CONFLICT (asset_id, content_sha256, extractor_version, embedding_model_id)
             DO NOTHING
             RETURNING id`,
            [
              asset.id,
              digest,
              mimeType,
              semanticEnabled ? CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId : null,
              semanticEnabled ? CHAT_PROJECT_CONTRACTS.retrieval.embeddingDimensions : null,
              semanticEnabled ? 'pending' : 'disabled',
            ],
          );
          await tx.query(
            `UPDATE chat_migration_exceptions SET resolved_at=NOW()
             WHERE exception_type='asset_backfill_failed'
               AND source_table='user_files' AND source_id=$1 AND resolved_at IS NULL`,
            [asset.id],
          );
          return { migrated: true, queued: ingestion.rowCount === 1 };
        });
        if (!outcome.migrated) result.skipped += 1;
        else {
          result.migrated += 1;
          result.queued += outcome.queued ? 1 : 0;
        }
      } catch (error) {
        result.failed += 1;
        await recordFailure(db, asset.id, error);
      }
    }
  }
  return result;
}

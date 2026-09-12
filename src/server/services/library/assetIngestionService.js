import { execFile } from 'child_process';
import { promisify } from 'util';
import { CHAT_PROJECT_CONTRACTS } from '../../config/chatProjectContracts.js';
import { withTransaction } from '../chatProjectAuthority.js';
import { resolveManagedLibraryPath } from '../libraryAssets.js';
import { chunkExtractedText } from './assetChunker.js';
import { extractAsset, UnsupportedAssetError } from './assetExtractors.js';
import { extractAssetInIsolatedRuntime } from './isolatedExtractorClient.js';
import {
  embedDocuments,
  isSemanticStoreQualified,
  toPgVector,
} from './xenoEmbeddingService.js';

const execFileAsync = promisify(execFile);

export async function scanFile(storagePath, { execFileFn = execFileAsync } = {}) {
  if (CHAT_PROJECT_CONTRACTS.ingestion.scannerMode !== 'clamav-cli-v1') {
    throw Object.assign(new Error('Mandatory malware scanner is unavailable'), { code: 'scanner_unavailable' });
  }
  const executable = process.env.CHAT_ASSET_SCANNER_PATH || 'clamscan';
  try {
    await execFileFn(executable, ['--no-summary', '--infected', storagePath], {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    if (error.code === 1) throw Object.assign(new Error('Malware detected'), { code: 'malware_detected' });
    if (error.code === 'ENOENT') {
      throw Object.assign(new Error('Mandatory malware scanner is unavailable'), { code: 'scanner_unavailable', cause: error });
    }
    throw Object.assign(new Error('Mandatory malware scanner failed'), { code: 'scanner_failed', cause: error });
  }
}

async function setFailure(db, ingestionId, state, error) {
  await db.query(
    `UPDATE library_asset_ingestions SET state = $2, error_code = $3, error_message = $4,
       completed_at = NOW(), lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
    [ingestionId, state, error.code || 'ingestion_failed', String(error.message || 'Ingestion failed').slice(0, 500)],
  );
}

async function setSemanticDegraded(db, ingestionId, error) {
  await db.query(
    `UPDATE library_asset_ingestions
     SET semantic_status = 'degraded', semantic_error_code = $2, semantic_error_message = $3,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [
      ingestionId,
      error.code || 'embedding_failed',
      String(error.message || 'Semantic indexing failed').slice(0, 500),
    ],
  );
}

export async function indexLibraryAssetEmbeddings(db, ingestionId) {
  const { rows } = await db.query(
    `SELECT i.id, i.state, i.semantic_status,
            json_agg(json_build_object('id', c.id, 'content', c.content) ORDER BY c.ordinal) AS chunks
     FROM library_asset_ingestions i
     LEFT JOIN library_asset_chunks c ON c.ingestion_id = i.id
     WHERE i.id = $1
     GROUP BY i.id`,
    [ingestionId],
  );
  const ingestion = rows[0];
  if (!ingestion || ingestion.state !== 'ready' || ingestion.semantic_status === 'ready') return ingestion;
  if (process.env.CHAT_SEMANTIC_RETRIEVAL === '0') {
    return (await db.query(
      `UPDATE library_asset_ingestions SET semantic_status='disabled', lease_owner=NULL,
         lease_expires_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [ingestionId],
    )).rows[0];
  }
  if (!await isSemanticStoreQualified(db)) {
    const error = Object.assign(new Error('Qualified pgvector schema is unavailable'), {
      code: 'semantic_store_unavailable',
    });
    await setSemanticDegraded(db, ingestionId, error);
    return (await db.query('SELECT * FROM library_asset_ingestions WHERE id=$1', [ingestionId])).rows[0];
  }

  const chunks = (ingestion.chunks || []).filter((chunk) => chunk?.id && typeof chunk.content === 'string');
  await db.query(
    `UPDATE library_asset_ingestions
     SET semantic_status='indexing', semantic_attempt_count=semantic_attempt_count+1,
         semantic_error_code=NULL, semantic_error_message=NULL, updated_at=NOW()
     WHERE id=$1`,
    [ingestionId],
  );
  try {
    const vectors = await embedDocuments(chunks.map((chunk) => chunk.content));
    await withTransaction(db, async (tx) => {
      for (let index = 0; index < chunks.length; index += 1) {
        await tx.query(
          `UPDATE library_asset_chunks
           SET embedding=$2::vector, embedding_model_id=$3
           WHERE id=$1 AND ingestion_id=$4`,
          [
            chunks[index].id,
            toPgVector(vectors[index]),
            CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId,
            ingestionId,
          ],
        );
      }
      await tx.query(
        `INSERT INTO chat_project_chunk_embeddings(project_id,chunk_id,asset_id,embedding_model_id,embedding)
         SELECT pa.project_id,c.id,c.asset_id,c.embedding_model_id,c.embedding
         FROM library_asset_chunks c
         JOIN chat_project_assets pa ON pa.asset_id=c.asset_id AND pa.retrieval_enabled=TRUE
         WHERE c.ingestion_id=$1 AND c.embedding IS NOT NULL
         ON CONFLICT(project_id,chunk_id) DO UPDATE SET
           embedding=EXCLUDED.embedding, embedding_model_id=EXCLUDED.embedding_model_id, updated_at=NOW()`,
        [ingestionId],
      );
      await tx.query(
        `UPDATE library_asset_ingestions
         SET semantic_status='ready', embedding_model_id=$2, embedding_dimensions=$3,
             semantic_error_code=NULL, semantic_error_message=NULL,
             lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW()
         WHERE id=$1`,
        [
          ingestionId,
          CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId,
          CHAT_PROJECT_CONTRACTS.retrieval.embeddingDimensions,
        ],
      );
    });
  } catch (error) {
    await setSemanticDegraded(db, ingestionId, error);
  }
  return (await db.query('SELECT * FROM library_asset_ingestions WHERE id=$1', [ingestionId])).rows[0];
}

export async function ingestLibraryAsset(db, assetId, {
  ingestionId = null,
  scanner = scanFile,
  extractor = extractAsset,
  isolatedExtractor = extractAssetInIsolatedRuntime,
  semanticIndexer = indexLibraryAssetEmbeddings,
} = {}) {
  const { rows } = await db.query(
    `SELECT i.*, f.storage_path FROM library_asset_ingestions i
     JOIN user_files f ON f.id = i.asset_id AND f.deleted_at IS NULL
     WHERE i.asset_id = $1 AND ($2::uuid IS NULL OR i.id = $2)
     ORDER BY i.created_at DESC LIMIT 1`,
    [assetId, ingestionId],
  );
  const ingestion = rows[0];
  if (!ingestion) throw Object.assign(new Error('Ingestion not found'), { code: 'ingestion_not_found' });
  if (ingestion.state === 'ready') return semanticIndexer(db, ingestion.id);
  const storagePath = resolveManagedLibraryPath(ingestion.storage_path);
  if (!storagePath) {
    const error = Object.assign(new Error('Managed bytes not found'), { code: 'asset_bytes_missing' });
    await setFailure(db, ingestion.id, 'failed', error);
    throw error;
  }

  await db.query(
    `UPDATE library_asset_ingestions SET state = 'scanning', attempt_count = attempt_count + 1,
       started_at = COALESCE(started_at, NOW()), updated_at = NOW(), error_code = NULL, error_message = NULL
     WHERE id = $1`,
    [ingestion.id],
  );
  try {
    await scanner(storagePath);
  } catch (error) {
    // Scanner absence/outage cannot downgrade quarantine into a generally
    // available failure state. Only a clean scan may advance to extraction.
    await setFailure(db, ingestion.id, 'quarantined', error);
    throw error;
  }

  await db.query("UPDATE library_asset_ingestions SET state = 'extracting', updated_at = NOW() WHERE id = $1", [ingestion.id]);
  try {
    const isolated = (process.env.CHAT_EXTRACTOR_MODE || (process.env.NODE_ENV === 'production' ? 'filesystem-queue' : 'direct')) === 'filesystem-queue';
    const extracted = isolated
      ? await isolatedExtractor({ storagePath, mimeType: ingestion.mime_type })
      : await extractor({ storagePath, mimeType: ingestion.mime_type });
    const sections = extracted.sections?.length
      ? extracted.sections
      : [{ text: extracted.text, locator: extracted.locator }];
    const chunks = sections.flatMap((section) => chunkExtractedText(section.text, { locator: section.locator }));
    chunks.forEach((chunk, ordinal) => { chunk.ordinal = ordinal; });
    if (chunks.length > CHAT_PROJECT_CONTRACTS.ingestion.maxChunksPerAsset) {
      throw Object.assign(new Error('Chunk limit exceeded'), { code: 'extract_limit' });
    }
    await withTransaction(db, async (tx) => {
      await tx.query('DELETE FROM library_asset_chunks WHERE ingestion_id = $1', [ingestion.id]);
      for (const chunk of chunks) {
        await tx.query(
          `INSERT INTO library_asset_chunks(
             ingestion_id, asset_id, ordinal, content, token_count, source_locator
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [ingestion.id, assetId, chunk.ordinal, chunk.content, chunk.tokenCount, JSON.stringify(chunk.sourceLocator)],
        );
      }
      await tx.query(
        `UPDATE library_asset_ingestions SET state = 'ready', extractor_id = $2, extractor_version = $3,
         completed_at = NOW(), lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
        [ingestion.id, extracted.extractorId, extracted.extractorVersion],
      );
    });
    return semanticIndexer(db, ingestion.id);
  } catch (error) {
    const unsupportedCodes = new Set(['unsupported_type', 'transcription_adapter_unavailable', 'extract_limit']);
    await setFailure(
      db,
      ingestion.id,
      error instanceof UnsupportedAssetError || unsupportedCodes.has(error.code) ? 'unsupported' : 'failed',
      error,
    );
    throw error;
  }
}

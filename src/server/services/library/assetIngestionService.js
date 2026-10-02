import { execFile } from 'child_process';
import fs from 'fs';
import net from 'net';
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

const SCANNER_MODES = new Set(['clamav-cli-v1', 'clamd-instream-v1']);

/**
 * Stream a file to clamd with its INSTREAM command and return clamd's verdict line.
 *
 * Why a daemon (2026-10-01): `clamscan` reloads the whole signature database on every run — 16.7 s
 * measured on a 5-byte file — so six images took two minutes to clear. clamd keeps the database
 * resident and answers in milliseconds. The protocol: `zINSTREAM\0`, then chunks each prefixed by a
 * 4-byte big-endian length, then a zero-length chunk; clamd replies `stream: OK`, `stream: <name>
 * FOUND`, or `... ERROR`.
 */
export function clamdInstream(storagePath, {
  host = process.env.CHAT_ASSET_SCANNER_HOST || 'clamav',
  port = Number(process.env.CHAT_ASSET_SCANNER_PORT || 3310),
  timeoutMs = 120_000,
  connect = (options) => net.createConnection(options),
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let reply = '';
    const done = (fn, value) => { if (settled) return; settled = true; socket.destroy(); fn(value); };
    const socket = connect({ host, port });
    socket.setTimeout(timeoutMs, () => done(reject, Object.assign(new Error('clamd timed out'), { code: 'clamd_timeout' })));
    socket.on('error', (error) => done(reject, Object.assign(new Error('clamd unreachable'), { code: 'clamd_unreachable', cause: error })));
    socket.on('data', (chunk) => { reply += chunk.toString('utf8'); });
    socket.on('end', () => done(resolve, reply.replace(/\0+$/, '').trim()));
    socket.on('close', () => done(resolve, reply.replace(/\0+$/, '').trim()));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const file = fs.createReadStream(storagePath, { highWaterMark: 64 * 1024 });
      file.on('error', (error) => done(reject, Object.assign(new Error('scan source unreadable'), { code: 'scanner_failed', cause: error })));
      file.on('data', (data) => {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(data.length, 0);
        if (!socket.write(Buffer.concat([header, data]))) {
          file.pause();
          socket.once('drain', () => file.resume());
        }
      });
      file.on('end', () => socket.write(Buffer.alloc(4)));
    });
  });
}

/** clamd's reply → nothing (clean) or a typed error. Anything not plainly clean is not clean. */
export function interpretClamdReply(reply) {
  if (/^stream: OK$/.test(reply)) return;
  if (/ FOUND$/.test(reply)) throw Object.assign(new Error('Malware detected'), { code: 'malware_detected' });
  throw Object.assign(new Error(`Mandatory malware scanner failed: ${String(reply).slice(0, 200)}`), { code: 'scanner_failed' });
}

export async function scanFile(storagePath, { execFileFn = execFileAsync, instream = clamdInstream } = {}) {
  const mode = CHAT_PROJECT_CONTRACTS.ingestion.scannerMode;
  if (!SCANNER_MODES.has(mode)) {
    throw Object.assign(new Error('Mandatory malware scanner is unavailable'), { code: 'scanner_unavailable' });
  }
  if (mode === 'clamd-instream-v1') {
    let reply;
    try {
      reply = await instream(storagePath);
    } catch (error) {
      // An unreachable daemon is never a pass: the file is scanned by the CLI instead (slow, but
      // scanned). A source that cannot be read is a failure either way.
      if (error.code === 'scanner_failed') throw error;
      console.warn(`[scanner] clamd ${error.code || 'error'}; scanning with the CLI instead`);
      return scanWithCli(storagePath, execFileFn);
    }
    return interpretClamdReply(reply);
  }
  return scanWithCli(storagePath, execFileFn);
}

async function scanWithCli(storagePath, execFileFn) {
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

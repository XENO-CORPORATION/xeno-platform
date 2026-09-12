import crypto from 'crypto';
import { withTransaction } from '../services/chatProjectAuthority.js';
import { ingestLibraryAsset } from '../services/library/assetIngestionService.js';

const LEASE_SECONDS = 5 * 60;

export async function claimLibraryIngestion(pool, workerId) {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, asset_id
       FROM library_asset_ingestions
       WHERE (
         (attempt_count < 3 AND (
           state IN ('queued', 'quarantined', 'failed')
           OR (state IN ('scanning', 'extracting', 'indexing') AND lease_expires_at < NOW())
         ))
         OR (
           state = 'ready' AND semantic_status IN ('pending', 'degraded')
           AND semantic_attempt_count < 3
         )
       )
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    if (!rows[0]) return null;
    const claimed = await tx.query(
      `UPDATE library_asset_ingestions
       SET lease_owner = $2, lease_expires_at = NOW() + ($3 * INTERVAL '1 second'), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [rows[0].id, workerId, LEASE_SECONDS],
    );
    return claimed.rows[0];
  });
}

export async function processLibraryIngestions(pool, { maxItems = 4 } = {}) {
  if (!pool) return [];
  const workerId = `${process.pid}:${crypto.randomUUID()}`;
  const outcomes = [];
  for (let index = 0; index < maxItems; index += 1) {
    const ingestion = await claimLibraryIngestion(pool, workerId);
    if (!ingestion) break;
    try {
      const result = await ingestLibraryAsset(pool, ingestion.asset_id, { ingestionId: ingestion.id });
      outcomes.push({ id: ingestion.id, status: result.state });
    } catch (error) {
      console.error(`[LibraryIngestionWorker] ingestion ${ingestion.id} failed:`, error.message);
      outcomes.push({ id: ingestion.id, status: 'failed', code: error.code || 'ingestion_failed' });
    }
  }
  return outcomes;
}

export function startLibraryIngestionWorker(pool, intervalMs = 15_000) {
  console.log('Library ingestion worker initialized');
  processLibraryIngestions(pool).catch((error) => console.error('[LibraryIngestionWorker] initial sweep:', error.message));
  const intervalId = setInterval(() => {
    processLibraryIngestions(pool).catch((error) => console.error('[LibraryIngestionWorker] sweep:', error.message));
  }, intervalMs);
  intervalId.unref?.();
  return () => clearInterval(intervalId);
}

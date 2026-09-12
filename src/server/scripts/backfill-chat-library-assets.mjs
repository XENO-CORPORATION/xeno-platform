import { pool } from '../middleware/database.js';
import { backfillLibraryAssets } from '../services/library/assetBackfillService.js';

try {
  const result = await backfillLibraryAssets(pool, {
    batchSize: process.env.CHAT_BACKFILL_BATCH_SIZE,
  });
  console.log(JSON.stringify({ event: 'chat_library_asset_backfill_complete', ...result }));
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}

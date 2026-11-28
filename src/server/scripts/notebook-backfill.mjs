#!/usr/bin/env node
/**
 * Read every project file that has no current notebook passages into its notebook (notebooks-in-chat §3.1).
 * Files ingested before notebooks existed have chunks but no passages, so their project would answer only from the
 * files added since. This reads each one again WITHOUT touching its own chunks, scan state or ingestion.
 *
 *   node scripts/notebook-backfill.mjs              # DRY-RUN: list what would be read
 *   node scripts/notebook-backfill.mjs --confirm    # read them (one at a time; a failure is recorded and the run goes on)
 *
 * Idempotent: a file whose passages are current is not a candidate, so a second run reads nothing.
 */
import pg from 'pg';
import { rereadIntoNotebook } from '../services/library/assetIngestionService.js';
import { PASSAGE_VERSION, NOTEBOOK_EXTRACTOR_ID } from '../services/chatNotebook.js';

const confirm = process.argv.includes('--confirm');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const { rows } = await pool.query(
    `SELECT DISTINCT pa.asset_id, COALESCE(f.original_name, f.filename) AS name
       FROM chat_project_assets pa
       JOIN user_files f ON f.id = pa.asset_id AND f.deleted_at IS NULL
       JOIN LATERAL (SELECT content_sha256, completed_at FROM library_asset_ingestions
          WHERE asset_id = pa.asset_id AND state = 'ready' AND extractor_id IS DISTINCT FROM 'corpus-notebook'
          ORDER BY created_at DESC LIMIT 1) p ON TRUE
      WHERE NOT EXISTS (SELECT 1 FROM library_asset_ingestions n
          WHERE n.asset_id = pa.asset_id AND n.extractor_id = '${NOTEBOOK_EXTRACTOR_ID}' AND n.extractor_version = $1
            AND n.content_sha256 = p.content_sha256 AND n.created_at >= COALESCE(p.completed_at, n.created_at))`,
    [PASSAGE_VERSION],
  );
  console.log(`${rows.length} project file(s) without current notebook passages (${PASSAGE_VERSION})`);
  if (!confirm) { for (const r of rows) console.log(`  would read ${r.asset_id}`); console.log('DRY-RUN: pass --confirm to read them'); }
  else {
    let read = 0, failed = 0, skipped = 0;
    for (const r of rows) {
      try {
        const out = await rereadIntoNotebook(pool, r.asset_id);
        if (out.skipped) { skipped++; console.log(`  skipped ${r.asset_id}: ${out.skipped}`); }
        else if (out.refusal) { failed++; console.log(`  no passages ${r.asset_id}: ${out.refusal.code}`); }
        else { read++; console.log(`  read ${r.asset_id}: ${out.passages} passage(s)`); }
      } catch (error) {
        failed++; console.log(`  failed ${r.asset_id}: ${String(error?.code || error?.message || error).slice(0, 120)}`);
      }
    }
    console.log(`read ${read}, no passages or failed ${failed}, skipped ${skipped}`);
  }
} finally {
  await pool.end();
}

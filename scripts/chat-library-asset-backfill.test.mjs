import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillLibraryAssets } from '../src/server/services/library/assetBackfillService.js';

test('legacy Library backfill hashes, sniffs, and queues each canonical asset idempotently', async () => {
  const asset = {
    id: '00000000-0000-4000-8000-000000000001',
    storage_path: '/managed/asset.png',
    file_size: 8,
    mime_type: 'application/octet-stream',
    content_sha256: null,
  };
  const calls = [];
  let page = 0;
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('count(*)::integer')) return { rows: [{ count: 1 }] };
      if (sql.includes('SELECT f.id, f.storage_path')) return { rows: page++ === 0 ? [asset] : [] };
      if (sql.includes('UPDATE user_files SET')) return { rowCount: 1, rows: [{ id: asset.id }] };
      if (sql.includes('INSERT INTO library_asset_ingestions')) return { rowCount: 1, rows: [{ id: 'ingestion' }] };
      return { rowCount: 0, rows: [] };
    },
  };
  const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
  const result = await backfillLibraryAssets(db, {
    readFile: async () => pngSignature,
    transaction: async (_db, fn) => fn(db),
  });

  assert.deepEqual(result, { source: 1, migrated: 1, queued: 1, skipped: 0, failed: 0 });
  const update = calls.find((call) => call.sql.includes('UPDATE user_files SET'));
  assert.equal(update.params[2], 'image/png');
  assert.match(update.params[1], /^[a-f0-9]{64}$/);
  const insertion = calls.find((call) => call.sql.includes('INSERT INTO library_asset_ingestions'));
  assert.equal(insertion.params[5], 'pending');
});

test('legacy Library backfill records a sanitized exception instead of queuing changed bytes', async () => {
  const asset = {
    id: '00000000-0000-4000-8000-000000000002',
    storage_path: '/managed/changed.txt',
    file_size: 9,
    mime_type: 'text/plain',
    content_sha256: null,
  };
  const calls = [];
  let page = 0;
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('count(*)::integer')) return { rows: [{ count: 1 }] };
      if (sql.includes('SELECT f.id, f.storage_path')) return { rows: page++ === 0 ? [asset] : [] };
      if (sql.includes('chat_migration_exceptions')) return { rowCount: 1, rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await backfillLibraryAssets(db, {
    readFile: async () => Buffer.from('short'),
    transaction: async (_db, fn) => fn(db),
  });

  assert.deepEqual(result, { source: 1, migrated: 0, queued: 0, skipped: 0, failed: 1 });
  const exception = calls.find((call) => call.sql.includes('INSERT INTO chat_migration_exceptions'));
  assert.equal(exception.params[1], 'asset_size_mismatch');
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO library_asset_ingestions')), false);
});

#!/usr/bin/env node
/**
 * Rewrite every Office › Write / Notes document still stored as Markdown (the first workspace editor, 2026-10-20 →
 * 10-23) in XENO Docs' `.xdoc` format — the format the workspace now mounts XENO Docs' editor over.
 *
 *   DATABASE_URL=… node src/server/scripts/migrate-workspace-docs-to-xdoc.mjs            # DRY RUN (default)
 *   DATABASE_URL=… node src/server/scripts/migrate-workspace-docs-to-xdoc.mjs --confirm  # write the new versions
 *
 * Run where the uploads live (the backend container: the bytes are read through the one reader, then written as a
 * new version). Each document becomes a NEW version made as its owner, through saveDoc — the same validation, the same
 * Storage versioning — so nothing is overwritten: restoring the previous version (Versions › Restore, or
 * docs.version.restore) undoes it for that document. Idempotent: a document already in `.xdoc` is not listed, so a
 * second run writes nothing. A document whose Markdown would not convert to a valid file is reported and left alone.
 *
 * The dry run reads and converts every document, and writes nothing.
 */
import pg from 'pg';
import { legacyDocs, migrateLegacyDoc, readContent, BUILT_FROM } from '../services/workspaceDocs.js';
import { localLibraryPath } from '../services/storageObjects.js';
import fs from 'node:fs';
import { validateContent } from '../vendor/xdoc-format.mjs';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const confirm = process.argv.includes('--confirm');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const report = { mode: confirm ? 'confirm' : 'dry-run', format: BUILT_FROM, legacy: 0, [confirm ? 'converted' : 'wouldConvert']: 0, failed: [] };
try {
  const rows = await legacyDocs(pool);
  report.legacy = rows.length;
  for (const row of rows) {
    try {
      if (!confirm) {
        // prove it WOULD convert: read the bytes through the one reader and run the same conversion
        const file = (await pool.query('SELECT id, storage_path, content_sha256 FROM user_files WHERE id = $1', [row.id])).rows[0];
        const disk = await localLibraryPath(pool, file);
        if (!disk) throw new Error('contents not available');
        const problems = validateContent(readContent(await fs.promises.readFile(disk, 'utf8'), {}).content);
        if (problems.length) throw Object.assign(new Error('would not convert to a valid document'), { problems });
      } else {
        await migrateLegacyDoc(pool, row);
      }
      report[confirm ? 'converted' : 'wouldConvert'] += 1;
    } catch (e) {
      report.failed.push({ fileId: String(row.file_id), kind: row.kind, error: e.message, ...(e.problems ? { problems: e.problems.slice(0, 3) } : {}) });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length) process.exitCode = 1;
} finally { await pool.end(); }

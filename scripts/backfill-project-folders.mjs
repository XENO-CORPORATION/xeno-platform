#!/usr/bin/env node
/**
 * Give every existing project its own Storage folder (services/chatProjectFolders.js). New projects get one when they
 * are made, and any project gets one on its first open; this makes them for the projects nobody has opened yet.
 *
 * DRY-RUN BY DEFAULT: lists what it would make. `--confirm` makes the folders. Idempotent: a project that already has
 * its folder is left alone, and nothing is ever moved or deleted.
 *
 *   DATABASE_URL=… node scripts/backfill-project-folders.mjs            # plan
 *   DATABASE_URL=… node scripts/backfill-project-folders.mjs --confirm  # make them
 */
import pg from 'pg';
import { ensureChatProjectFolder, PROJECTS_APP } from '../src/server/services/chatProjectFolders.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const confirm = process.argv.includes('--confirm');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query(
    `SELECT p.id, p.workspace_id IS NOT NULL AS team FROM chat_projects p
      WHERE NOT EXISTS (SELECT 1 FROM project_folders pf WHERE pf.app = $1 AND pf.project_id = p.id) ORDER BY p.created_at`, [PROJECTS_APP]);
  console.log(`${rows.length} project(s) without a folder${confirm ? '' : ' (dry run: pass --confirm to make them)'}`);
  let made = 0, failed = 0;
  for (const r of rows) {
    if (!confirm) { console.log(`  would make: project ${r.id} (${r.team ? 'workspace' : 'personal'})`); continue; }
    const out = await ensureChatProjectFolder(pool, r.id);
    if (out.folder) { made++; console.log(`  made: project ${r.id} -> folder ${out.folder.id}`); }
    else { failed++; console.log(`  not now: project ${r.id} (${out.reason})`); }
  }
  if (confirm) console.log(`${made} made, ${failed} not made`);
  process.exitCode = failed ? 1 : 0;
} finally { await pool.end(); }

#!/usr/bin/env node
/**
 * Record one deploy in the platform's release record (services/releaseRecord.js → release_deploys).
 *
 * Run INSIDE the backend container by scripts/deploy-platform.mjs at the end of every deploy, OK or failed:
 *
 *   echo '<json>' | docker exec -i xenostudio-backend node /app/scripts/record-deploy.mjs
 *
 * The JSON is {service, sha, previousSha?, mode, status, startedAt, finishedAt, deployedBy, healthcheck,
 * rollbackPoint, prs[], migrations[], sources?}. `sources` is what the workstation collected for the INTERNAL release note
 * ({prs:[{number,title,body,url,files}], migrations:[{name,text}], env:{added,removed}} — scripts/lib/internal-note-sources.mjs):
 * the note is drafted here, from it, by a deterministic template. It is facts the deploy itself observed — never typed from memory. Idempotent:
 * the same deploy recorded twice is one row. Prints one line: the row id and whether it was new.
 */
import pg from 'pg';
import { recordDeploy } from '../services/releaseRecord.js';
import { draftForDeploy } from '../services/releaseInternalNotes.js';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// `--last <service>`: print the sha of the last OK swap of that service (empty when none), so the deploy can name
// the PRs and migrations between it and what it ships.
const li = process.argv.indexOf('--last');
if (li > 0) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query(`SELECT sha FROM release_deploys WHERE service = $1 AND mode = 'swap' AND status = 'ok' ORDER BY started_at DESC NULLS LAST LIMIT 1`, [process.argv[li + 1]]);
    console.log(r.rows[0]?.sha || '');
  } finally { await pool.end(); }
  process.exit(0);
}

const raw = await readStdin();
let input;
try { input = JSON.parse(raw); } catch { console.error('record-deploy: stdin is not JSON'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('record-deploy: DATABASE_URL is not set'); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { deploy, inserted } = await recordDeploy(pool, { ...input, provenance: 'recorded' });
  console.log(`record-deploy: ${inserted ? 'recorded' : 'updated'} ${deploy.id} ${deploy.service}@${deploy.sha} ${deploy.status}`);
  // the staff-only internal note: drafted from the PRs this deploy shipped. A failure here is loud and never undoes the row.
  try {
    const { action } = await draftForDeploy(pool, deploy.id, input.sources || {}, { provenance: 'drafted_at_deploy' });
    console.log(`record-deploy: internal note ${action}${input.sources ? '' : ' (no PR text was collected)'}`);
  } catch (e) { console.error(`record-deploy: INTERNAL NOTE NOT DRAFTED: ${e.message}`); process.exitCode = 1; }
} catch (e) {
  console.error(`record-deploy: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

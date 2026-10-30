/**
 * The migrate job: the ONE place the superuser credential is used. remote-deploy.sh runs it (compose service
 * `migrate`) before swapping the backend; the running app connects as xeno_app and only verifies (startupSchema.js).
 */
import pg from 'pg';
import { runRequiredStartupMigrations } from '../services/startupSchema.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('[migrate] MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const r = await runRequiredStartupMigrations(pool);
  console.log(`[migrate] OK: ${r.applied} applied, ${r.total} known; grants applied`);
  await pool.end();
} catch (e) {
  console.error('[migrate] FAILED:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}

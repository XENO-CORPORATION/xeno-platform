import { runMigrations } from './migrationService.js';
import { runAllMigrations, migrationStatus } from './migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { applyRuntimeGrants } from '../database/runtime-role.js';

const requiredSteps = Object.freeze({ runMigrations, runAllMigrations, migrateAccountV2, migrateOidcClients, migrationStatus, applyRuntimeGrants });

// One startup contract for the API and isolated qualification. Dependency
// injection is for tests only; no environment variable can replace a phase.
export async function runRequiredStartupMigrations(pool, steps = requiredSteps) {
  await steps.runMigrations(pool);
  const result = await steps.runAllMigrations(pool);
  if (!result || !Number.isInteger(result.total) || result.total < 1) {
    throw new Error('Required versioned migration manifest is empty or invalid');
  }
  if (result.skipped?.length) {
    throw new Error(`Required migrations were deferred: ${result.skipped.map(row => row.version).join(', ')}`);
  }
  await steps.migrateAccountV2(pool);
  await steps.migrateOidcClients(pool);
  const status = await steps.migrationStatus(pool);
  if (!status.length || status.some(row => row.status !== 'applied')) {
    throw new Error('Required startup migration status is incomplete');
  }
  await steps.applyRuntimeGrants(pool);
  return result;
}

/** What the app needs from the migrate job before it may serve: every migration applied, and the ledger's chain in place. */
export async function assertSchemaReady(pool, steps = requiredSteps) {
  const status = await steps.migrationStatus(pool, { readOnly: true });
  const pending = status.filter((row) => row.status !== 'applied').map((row) => row.version);
  if (!status.length || pending.length) {
    throw new Error(`The migrate job has not run: ${pending.length ? pending.join(', ') : 'no migrations known'}`);
  }
  const chain = await pool.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credit_txn_chain_append' AND tgrelid = 'public.credit_transactions'::regclass AND tgenabled <> 'D'`,
  );
  if (!chain.rows.length) throw new Error('The ledger chain trigger is missing or disabled');
}

/**
 * The app's startup. The ROLE decides, not a setting: a superuser connection migrates (local runs, tests); the
 * xeno_app role cannot, so it verifies and refuses to serve an unmigrated schema.
 */
export async function runStartupSchema(pool, steps = requiredSteps) {
  const { rows } = await pool.query(`SELECT current_setting('is_superuser') AS superuser`);
  if (rows[0]?.superuser === 'on') return runRequiredStartupMigrations(pool, steps);
  await assertSchemaReady(pool, steps);
  return { applied: 0, verifiedOnly: true };
}

import { runMigrations } from './migrationService.js';
import { runAllMigrations, migrationStatus } from './migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const requiredSteps = Object.freeze({ runMigrations, runAllMigrations, migrateAccountV2, migrateOidcClients, migrationStatus });

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
  return result;
}

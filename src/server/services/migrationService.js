/**
 * Database Migration Service
 * Automatically runs schema migrations on server startup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run all pending migrations
 * Uses IF NOT EXISTS patterns so safe to run repeatedly
 */
export async function runMigrations(pool) {
  console.log('🔄 Running database migrations...');

  const migrationsDir = path.join(__dirname, '../database');
  const migrationFiles = [
    'youtube-schema.sql',
    'office-canvas-schema.sql',
    // Add more schema files here as needed
  ];

  for (const file of migrationFiles) {
    const schemaPath = path.join(migrationsDir, file);

    if (!fs.existsSync(schemaPath)) {
      console.log(`⏭️  Skipping ${file} (not found)`);
      continue;
    }

    try {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log(`✅ Applied ${file}`);
    } catch (error) {
      // Idempotency collisions (object already exists) are expected on re-runs and safe
      // to ignore — both legacy schema files guard every statement (IF NOT EXISTS / DO-block
      // existence checks), so on a healthy DB the catch never fires. ANY OTHER error is a
      // real, potentially schema-corrupting failure and MUST fail the boot (fail-closed): it
      // propagates to runStartupMigrations' top-level catch which process.exit(1)s, matching
      // runAllMigrations/migrateAccountV2. (D4: was warn-and-continue, which let a broken
      // migration boot a half-migrated schema.)
      // Only genuine "object already exists" (duplicate) codes are benign on a re-run:
      // duplicate_table/object/column/schema/function/database. NOT 42P16
      // (invalid_table_definition) — that is a real schema error and must fail the boot.
      const ALREADY_EXISTS = new Set(['42P07', '42710', '42701', '42P06', '42723', '42P04']);
      if (ALREADY_EXISTS.has(error.code)) {
        console.log(`✅ ${file} (already up to date: ${error.code})`);
      } else {
        console.error(`❌ FATAL migration error in ${file} [${error.code}]:`, error.message);
        throw error;
      }
    }
  }

  console.log('✅ Database migrations complete');
}

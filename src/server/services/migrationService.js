/**
 * Database Migration Service
 * Automatically runs schema migrations on server startup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LEGACY_SCHEMA_FILES = Object.freeze([
  'youtube-schema.sql',
  'office-canvas-schema.sql',
]);

/**
 * Run all pending migrations
 * Uses IF NOT EXISTS patterns so safe to run repeatedly
 */
export async function runMigrations(pool) {
  console.log('🔄 Running database migrations...');

  const migrationsDir = path.join(__dirname, '../database');
  // Validate ALL inputs before making any schema changes. A missing second file
  // is a broken artifact, not an optional feature or a successful migration.
  const schemas = LEGACY_SCHEMA_FILES.map(file => {
    try {
      const schema = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      if (!schema.trim()) throw new Error('Schema is empty');
      return { file, schema };
    } catch (cause) {
      throw new Error(`Required startup schema could not be loaded: ${file}`, { cause });
    }
  });

  for (const { file, schema } of schemas) {
    try {
      await pool.query(schema);
      console.log(`✅ Applied ${file}`);
    } catch (error) {
      // Replay safety belongs to SQL guards. Even a duplicate-object error can
      // abort the remainder of this batch; it never proves an up-to-date schema.
      console.error(`❌ FATAL migration error in ${file} [${error.code}]:`, error.message);
      throw error;
    }
  }

  console.log('✅ Database migrations complete');
}

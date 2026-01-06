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
      // Log but don't crash - some errors are expected (e.g., already exists)
      if (error.code === '42P07') {
        // Relation already exists - this is fine
        console.log(`✅ ${file} (already up to date)`);
      } else if (error.code === '42710') {
        // Object already exists - this is fine
        console.log(`✅ ${file} (already up to date)`);
      } else {
        console.error(`⚠️  Warning in ${file}:`, error.message);
      }
    }
  }

  console.log('✅ Database migrations complete');
}

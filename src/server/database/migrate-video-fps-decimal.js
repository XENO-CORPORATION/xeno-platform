/**
 * Video Studio Database Migration - Change fps to DECIMAL
 * Run this to change fps from INTEGER to DECIMAL(6,2) to support fractional framerates
 *
 * Usage: node database/migrate-video-fps-decimal.js
 */

import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'xenostudio',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'xenostudio_password',
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🎬 Starting fps column migration (INTEGER -> DECIMAL)...');

    // Check current data type
    const checkColumn = await client.query(`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'video_projects'
      AND column_name = 'fps'
    `);

    if (checkColumn.rows.length === 0) {
      console.log('⚠️  Column fps does not exist. Please run the initial schema first.');
      return;
    }

    const currentType = checkColumn.rows[0].data_type;
    console.log(`📊 Current fps data type: ${currentType}`);

    if (currentType === 'numeric') {
      console.log('✅ Column fps is already DECIMAL/NUMERIC. Skipping migration.');
      return;
    }

    // Change fps column to DECIMAL(6,2)
    console.log('🔧 Changing fps column from INTEGER to DECIMAL(6,2)...');
    await client.query(`
      ALTER TABLE video_projects
      ALTER COLUMN fps TYPE DECIMAL(6,2)
    `);

    console.log('✅ fps column changed to DECIMAL(6,2) successfully!');
    console.log('📝 Now supports fractional framerates like 23.976, 29.97, 59.94');
    console.log('');
    console.log('🎉 Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

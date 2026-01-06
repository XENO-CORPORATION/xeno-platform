/**
 * Video Studio Database Migration - Add project_metadata column
 * Run this to add the project_metadata JSONB column to existing video_projects table
 *
 * Usage: node src/server/database/migrate-video-add-metadata.js
 */

import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Pool } = pg;

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'xenolabs',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'xenolabs_password',
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🎬 Starting project_metadata column migration...');

    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'video_projects'
      AND column_name = 'project_metadata'
    `);

    if (checkColumn.rows.length > 0) {
      console.log('⚠️  Column project_metadata already exists. Skipping migration.');
      return;
    }

    // Add project_metadata column
    console.log('📋 Adding project_metadata column to video_projects table...');
    await client.query(`
      ALTER TABLE video_projects
      ADD COLUMN project_metadata JSONB
    `);

    console.log('✅ project_metadata column added successfully!');
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

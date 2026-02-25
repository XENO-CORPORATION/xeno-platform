#!/usr/bin/env node

/**
 * Migration: Increase aspect_ratio column length from VARCHAR(10) to VARCHAR(50)
 *
 * Reason: Professional pixel aspect ratios like "Square Pixels (1.0)" are longer than 10 chars
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'xenostudio_password',
  database: process.env.POSTGRES_DB || 'xenostudio'
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('🔄 Starting migration: aspect_ratio VARCHAR(10) -> VARCHAR(50)');

    // Check current column type
    const checkQuery = `
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'video_projects' AND column_name = 'aspect_ratio';
    `;
    const checkResult = await client.query(checkQuery);

    if (checkResult.rows.length === 0) {
      console.log('❌ Column aspect_ratio does not exist in video_projects table');
      return;
    }

    const currentLength = checkResult.rows[0].character_maximum_length;
    console.log(`📊 Current aspect_ratio length: VARCHAR(${currentLength})`);

    if (currentLength >= 50) {
      console.log('✅ Migration already applied (length >= 50)');
      return;
    }

    // Perform migration
    await client.query('BEGIN');

    const alterQuery = `
      ALTER TABLE video_projects
      ALTER COLUMN aspect_ratio TYPE VARCHAR(50);
    `;

    await client.query(alterQuery);
    await client.query('COMMIT');

    console.log('✅ Migration successful: aspect_ratio is now VARCHAR(50)');

    // Verify
    const verifyResult = await client.query(checkQuery);
    const newLength = verifyResult.rows[0].character_maximum_length;
    console.log(`📊 New aspect_ratio length: VARCHAR(${newLength})`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => {
    console.log('🎉 Migration complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration error:', error);
    process.exit(1);
  });

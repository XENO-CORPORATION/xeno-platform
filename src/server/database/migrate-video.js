/**
 * Video Studio Database Migration Script
 * Run this to initialize video project tables
 * 
 * Usage: node src/server/database/migrate-video.js
 */

import pg from 'pg';
import fs from 'fs';
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
    console.log('🎬 Starting Video Studio database migration...');
    
    // Read SQL schema file
    const schemaPath = path.join(__dirname, 'video-schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute schema
    console.log('📋 Creating tables...');
    await client.query(schemaSql);
    
    console.log('✅ Video Studio tables created successfully!');
    console.log('');
    console.log('Created tables:');
    console.log('  - video_projects');
    console.log('  - video_assets');
    console.log('  - video_render_jobs');
    console.log('  - video_project_sessions');
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

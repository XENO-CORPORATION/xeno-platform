#!/usr/bin/env node
/**
 * Give every existing workspace its default XENO Places building (migration 20261020180000 does it for NEW ones).
 *
 *   DATABASE_URL=… node scripts/places-backfill.mjs            # DRY RUN (default): how many, and in which cities
 *   DATABASE_URL=… node scripts/places-backfill.mjs --confirm  # create them
 *
 * Idempotent: a workspace that already has an active building is left exactly as it is, so a second run creates 0.
 * Where each building stands comes from the owner's own Language & region setting (places_home_city), never guessed.
 */
import pg from 'pg';
import { backfillPlan, backfill } from '../src/server/services/places.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const confirm = process.argv.includes('--confirm');
  const out = confirm ? await backfill(pool) : await backfillPlan(pool);
  const { workspaceIds, ...shown } = out;
  console.log(JSON.stringify({ mode: confirm ? 'confirm' : 'dry-run', ...shown }, null, 2));
} finally { await pool.end(); }

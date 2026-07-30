/**
 * Health Check Endpoints
 *
 * /health       — Simple liveness probe (for Docker/k8s)
 * /api/health   — Detailed health with dependency checks
 * /api/ready    — Readiness probe (are all dependencies available?)
 * /api/live     — Liveness probe (is the process alive?)
 */

import { Router } from 'express';
import Redis from 'ioredis';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { updatesOrigin } from '../config/hosts.js';

const router = Router();

// Track server start time
const SERVER_START_TIME = Date.now();

// Lazy Redis connection for health checks
let redis = null;
function getRedis() {
  if (!redis) {
    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    redis.on('error', () => {}); // Suppress connection errors in health checks
  }
  return redis;
}

// --------------------------------------------------------------------------
// Simple liveness — always returns 200 if the process is running
// --------------------------------------------------------------------------
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// --------------------------------------------------------------------------
// Readiness — checks all critical dependencies
// --------------------------------------------------------------------------
router.get('/ready', async (req, res) => {
  const checks = {};
  let allHealthy = true;

  // Migration gate: not ready until every startup migration has succeeded, so the
  // LB never routes traffic to a box running on a half-migrated schema.
  const migrationsReady = req.app?.locals?.migrationsReady === true;
  if (!migrationsReady) allHealthy = false;
  checks.migrations = { status: migrationsReady ? 'ok' : 'pending' };

  // Database check. SECURITY: never echo driver error messages — pg errors embed
  // hostnames/ports/db names. Coarse state + latency only.
  try {
    const dbStart = Date.now();
    await req.db.query('SELECT 1');
    checks.database = { status: 'ok', responseMs: Date.now() - dbStart };
  } catch (err) {
    allHealthy = false;
    checks.database = { status: 'down' };
  }

  // Redis check (same rule: ioredis errors embed host:port).
  try {
    const redisClient = getRedis();
    const redisStart = Date.now();
    await redisClient.ping();
    checks.redis = { status: 'ok', responseMs: Date.now() - redisStart };
  } catch (err) {
    allHealthy = false;
    checks.redis = { status: 'down' };
  }

  const status = allHealthy ? 'ready' : 'not_ready';
  res.status(allHealthy ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    checks,
  });
});

// --------------------------------------------------------------------------
// Detailed health — comprehensive system information
// --------------------------------------------------------------------------
// SECURITY: this endpoint is public. It must NOT fingerprint the stack — no exact
// Postgres server version, no Node version, no NODE_ENV, no Redis memory internals,
// and NEVER raw driver err.message (pg/ioredis errors embed hostnames/ports/db names).
// Coarse states ('ok'/'degraded'/'down') + latency numbers only.
router.get('/health', async (req, res) => {
  const checks = {};
  let overallStatus = 'ok';

  // 1. Database
  try {
    const dbStart = Date.now();
    await req.db.query('SELECT 1');
    checks.database = {
      status: 'ok',
      responseMs: Date.now() - dbStart,
    };
  } catch (err) {
    overallStatus = 'degraded';
    checks.database = { status: 'down' };
  }

  // 2. Redis
  try {
    const redisClient = getRedis();
    const redisStart = Date.now();
    await redisClient.ping();
    checks.redis = {
      status: 'ok',
      responseMs: Date.now() - redisStart,
    };
  } catch (err) {
    overallStatus = 'degraded';
    checks.redis = { status: 'down' };
  }

  // 3. R2 / CDN connectivity (lightweight — just check DNS resolution)
  try {
    const r2Start = Date.now();
    const response = await fetch(`${updatesOrigin()}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    });
    checks.r2_cdn = {
      status: response.ok || response.status === 403 ? 'ok' : 'degraded',
      responseMs: Date.now() - r2Start,
      statusCode: response.status,
    };
  } catch (err) {
    // CDN being unreachable is degraded, not critical
    if (overallStatus === 'ok') overallStatus = 'degraded';
    checks.r2_cdn = { status: 'degraded' };
  }

  /*
   * 4. Backup freshness.
   *
   * The nightly Postgres backup failed every night from 2026-07-14 to 2026-07-29
   * on the box that holds the credit ledger. The cron fired, pg-backup.sh was not
   * executable (git stored the blob 100644, so a checkout stripped +x), and the
   * only record was "Permission denied" appended to a log on the same machine.
   * A box cannot report that its own backups stopped, for the same reason it
   * cannot report that it died — so the age of the newest dump is published here,
   * where the off-box watcher (xeno-mail-001:/usr/local/bin/xeno-watch) can read
   * it. `backups/` is mounted READ-ONLY into this container solely for this.
   *
   * Deliberately does NOT touch overallStatus. A stale backup is an operational
   * alarm, not "the site is down"; conflating them would drop the platform out of
   * every uptime monitor over a cron failure. The watcher decides what to page on.
   */
  try {
    const dir = process.env.BACKUP_DIR || '/app/backups';
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.dump'));
    if (names.length === 0) {
      checks.backup = { status: 'error', error: 'no dump found', dir };
    } else {
      let newest = 0;
      for (const name of names) {
        const st = await fsp.stat(nodePath.join(dir, name));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
      const ageHours = Math.floor((Date.now() - newest) / 3_600_000);
      // 36h, not 24h, so one late or slow nightly run does not cry wolf.
      checks.backup = { status: ageHours > 36 ? 'stale' : 'ok', ageHours, count: names.length };
    }
  } catch (err) {
    // An unreadable or unmounted directory is itself worth surfacing — silence
    // here is precisely the failure mode this check exists to remove.
    checks.backup = { status: 'unknown', error: String((err && err.code) || err) };
  }

  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);

  res.status(overallStatus === 'ok' ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: uptimeSeconds,
      human: formatUptime(uptimeSeconds),
    },
    checks,
  });
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export default router;

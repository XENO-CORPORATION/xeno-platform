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

  // Database check
  try {
    const dbStart = Date.now();
    await req.db.query('SELECT 1');
    checks.database = { status: 'ok', responseMs: Date.now() - dbStart };
  } catch (err) {
    allHealthy = false;
    checks.database = { status: 'error', error: err.message };
  }

  // Redis check
  try {
    const redisClient = getRedis();
    const redisStart = Date.now();
    await redisClient.ping();
    checks.redis = { status: 'ok', responseMs: Date.now() - redisStart };
  } catch (err) {
    allHealthy = false;
    checks.redis = { status: 'error', error: err.message };
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
router.get('/health', async (req, res) => {
  const checks = {};
  let overallStatus = 'ok';

  // 1. Database
  try {
    const dbStart = Date.now();
    const result = await req.db.query('SELECT NOW() as time, current_setting(\'server_version\') as version');
    checks.database = {
      status: 'ok',
      responseMs: Date.now() - dbStart,
      version: result.rows[0]?.version,
    };
  } catch (err) {
    overallStatus = 'degraded';
    checks.database = { status: 'error', error: err.message };
  }

  // 2. Redis
  try {
    const redisClient = getRedis();
    const redisStart = Date.now();
    const info = await redisClient.info('memory');
    const memMatch = info.match(/used_memory_human:(\S+)/);
    checks.redis = {
      status: 'ok',
      responseMs: Date.now() - redisStart,
      usedMemory: memMatch ? memMatch[1] : 'unknown',
    };
  } catch (err) {
    overallStatus = 'degraded';
    checks.redis = { status: 'error', error: err.message };
  }

  // 3. R2 / CDN connectivity (lightweight — just check DNS resolution)
  try {
    const r2Start = Date.now();
    const response = await fetch('https://updates.xenostudio.ai/', {
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
    checks.r2_cdn = { status: 'degraded', error: err.message };
  }

  // System info
  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);

  res.status(overallStatus === 'ok' ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: {
      seconds: uptimeSeconds,
      human: formatUptime(uptimeSeconds),
    },
    memory: {
      rss: formatBytes(mem.rss),
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      external: formatBytes(mem.external),
    },
    node: process.version,
    environment: process.env.NODE_ENV || 'development',
    checks,
  });
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

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

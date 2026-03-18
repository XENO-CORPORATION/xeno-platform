/**
 * Background Job Queue Service
 *
 * Uses BullMQ + Redis for reliable background job processing.
 * Supports multiple queues:
 * - video-processing   — Transcode, thumbnail, encode
 * - ai-inference       — Long-running AI generation
 * - email              — Send emails with retry
 * - webhook-delivery   — Deliver webhooks with retry
 * - analytics          — Aggregate stats, cleanup
 *
 * Each queue has its own concurrency and retry settings.
 * Jobs are also tracked in PostgreSQL for audit/dashboard.
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --------------------------------------------------------------------------
// Queue class (lightweight BullMQ-compatible without full BullMQ dependency)
// --------------------------------------------------------------------------
class JobQueue {
  constructor(name, options = {}) {
    this.name = name;
    this.concurrency = options.concurrency || 3;
    this.maxAttempts = options.maxAttempts || 3;
    this.backoffMs = options.backoffMs || 5000;
    this.handlers = new Map();
    this.activeJobs = 0;
    this.processing = false;
    this.redis = null;
    this.db = null;
  }

  /**
   * Initialize with connections
   */
  init(db, redis) {
    this.db = db;
    this.redis = redis;
    return this;
  }

  /**
   * Register a job handler for a specific type
   */
  process(type, handler) {
    this.handlers.set(type, handler);
  }

  /**
   * Add a job to the queue
   */
  async add(type, payload, options = {}) {
    const jobId = uuidv4();
    const priority = options.priority || 0;
    const scheduledFor = options.delay
      ? new Date(Date.now() + options.delay)
      : null;

    // Store in PostgreSQL for tracking
    if (this.db) {
      await this.db.query(
        `INSERT INTO background_jobs (id, queue, type, payload, priority, max_attempts, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [jobId, this.name, type, JSON.stringify(payload), priority, options.maxAttempts || this.maxAttempts, scheduledFor]
      );
    }

    // Push to Redis list for processing
    if (this.redis) {
      await this.redis.lpush(
        `queue:${this.name}`,
        JSON.stringify({ id: jobId, type, payload, attempt: 0 })
      );
    }

    // Trigger processing
    this._processNext();

    return jobId;
  }

  /**
   * Process jobs from the queue
   */
  async _processNext() {
    if (this.processing || this.activeJobs >= this.concurrency) return;
    if (!this.redis) return;

    this.processing = true;

    try {
      while (this.activeJobs < this.concurrency) {
        const raw = await this.redis.rpop(`queue:${this.name}`);
        if (!raw) break;

        const job = JSON.parse(raw);
        const handler = this.handlers.get(job.type);

        if (!handler) {
          console.error(`[Queue:${this.name}] No handler for job type: ${job.type}`);
          await this._markFailed(job.id, `No handler for type: ${job.type}`);
          continue;
        }

        this.activeJobs++;
        this._executeJob(job, handler).finally(() => {
          this.activeJobs--;
          // Check for more jobs
          setImmediate(() => this._processNext());
        });
      }
    } finally {
      this.processing = false;
    }
  }

  async _executeJob(job, handler) {
    const startTime = Date.now();

    // Mark as processing
    if (this.db) {
      await this.db.query(
        `UPDATE background_jobs SET status = 'processing', started_at = NOW(), attempts = attempts + 1, updated_at = NOW()
         WHERE id = $1`,
        [job.id]
      ).catch(() => {});
    }

    try {
      const result = await handler(job.payload, {
        id: job.id,
        type: job.type,
        attempt: job.attempt + 1,
      });

      // Mark completed
      if (this.db) {
        await this.db.query(
          `UPDATE background_jobs SET status = 'completed', result = $1, completed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(result || {}), job.id]
        );
      }

      console.log(`[Queue:${this.name}] Job ${job.id} completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      const attempt = (job.attempt || 0) + 1;

      if (attempt < this.maxAttempts) {
        // Retry with exponential backoff
        const delay = this.backoffMs * Math.pow(2, attempt - 1);
        console.warn(`[Queue:${this.name}] Job ${job.id} failed (attempt ${attempt}), retrying in ${delay}ms`);

        if (this.db) {
          await this.db.query(
            `UPDATE background_jobs SET status = 'pending', error = $1, updated_at = NOW()
             WHERE id = $2`,
            [error.message, job.id]
          ).catch(() => {});
        }

        setTimeout(() => {
          if (this.redis) {
            this.redis.lpush(
              `queue:${this.name}`,
              JSON.stringify({ ...job, attempt })
            ).then(() => this._processNext());
          }
        }, delay);
      } else {
        await this._markFailed(job.id, error.message);
        console.error(`[Queue:${this.name}] Job ${job.id} permanently failed after ${attempt} attempts`);
      }
    }
  }

  async _markFailed(jobId, error) {
    if (this.db) {
      await this.db.query(
        `UPDATE background_jobs SET status = 'failed', error = $1, completed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [error, jobId]
      ).catch(() => {});
    }
  }

  /**
   * Get queue stats
   */
  async getStats() {
    if (!this.db) return {};

    const { rows } = await this.db.query(
      `SELECT status, COUNT(*) as count
       FROM background_jobs
       WHERE queue = $1
       GROUP BY status`,
      [this.name]
    );

    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const row of rows) {
      stats[row.status] = parseInt(row.count);
    }
    stats.activeWorkers = this.activeJobs;
    stats.concurrency = this.concurrency;

    return stats;
  }
}

// --------------------------------------------------------------------------
// Pre-defined queues
// --------------------------------------------------------------------------
export const videoQueue = new JobQueue('video-processing', {
  concurrency: 2,
  maxAttempts: 3,
  backoffMs: 10000,
});

export const aiQueue = new JobQueue('ai-inference', {
  concurrency: 5,
  maxAttempts: 2,
  backoffMs: 5000,
});

export const emailQueue = new JobQueue('email', {
  concurrency: 3,
  maxAttempts: 5,
  backoffMs: 15000,
});

export const webhookQueue = new JobQueue('webhook-delivery', {
  concurrency: 10,
  maxAttempts: 5,
  backoffMs: 30000,
});

export const analyticsQueue = new JobQueue('analytics', {
  concurrency: 1,
  maxAttempts: 3,
  backoffMs: 60000,
});

// --------------------------------------------------------------------------
// Initialize all queues
// --------------------------------------------------------------------------
let initialized = false;

export async function initBackgroundJobs(db) {
  if (initialized) return;

  let redis;
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await redis.connect();
    console.log('[BackgroundJobs] Redis connected');
  } catch (err) {
    console.warn('[BackgroundJobs] Redis unavailable, jobs will be DB-only:', err.message);
    redis = null;
  }

  const queues = [videoQueue, aiQueue, emailQueue, webhookQueue, analyticsQueue];
  for (const queue of queues) {
    queue.init(db, redis);
  }

  initialized = true;
  console.log('[BackgroundJobs] All queues initialized');
}

/**
 * Get stats for all queues
 */
export async function getAllQueueStats() {
  const queues = [videoQueue, aiQueue, emailQueue, webhookQueue, analyticsQueue];
  const stats = {};
  for (const queue of queues) {
    stats[queue.name] = await queue.getStats();
  }
  return stats;
}

export default {
  videoQueue,
  aiQueue,
  emailQueue,
  webhookQueue,
  analyticsQueue,
  initBackgroundJobs,
  getAllQueueStats,
};

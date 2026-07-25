/**
 * Background Job Queue Routes
 *
 * Admin endpoints for monitoring and managing background job queues.
 */

import { Router } from 'express';
import { getAllQueueStats } from '../services/backgroundJobs.js';
// DB-backed admin guard (users.role === 'admin'). The old local check tested
// req.user?.is_admin, a column that is never selected AND does not exist — so the
// guard rejected EVERYONE, including real admins (permanently dead endpoints).
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// --------------------------------------------------------------------------
// Get all queue stats
// --------------------------------------------------------------------------
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await getAllQueueStats();
    res.json({ success: true, queues: stats });
  } catch (error) {
    console.error('[Jobs] Stats error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch queue stats' });
  }
});

// --------------------------------------------------------------------------
// List recent jobs (with filters)
// --------------------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { queue, status, limit: limitStr, offset: offsetStr } = req.query;
    const limit = Math.min(parseInt(limitStr) || 20, 100);
    const offset = parseInt(offsetStr) || 0;

    let query = 'SELECT id, queue, type, status, attempts, max_attempts, created_at, started_at, completed_at, error FROM background_jobs';
    const conditions = [];
    const params = [];
    let idx = 1;

    if (queue) {
      conditions.push(`queue = $${idx++}`);
      params.push(queue);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await req.db.query(query, params);

    // Total count
    let countQuery = 'SELECT COUNT(*) as total FROM background_jobs';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const { rows: countRows } = await req.db.query(
      countQuery,
      params.slice(0, params.length - 2) // Remove limit/offset
    );

    res.json({
      success: true,
      jobs: rows,
      total: parseInt(countRows[0]?.total || 0),
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Jobs] List error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list jobs' });
  }
});

// --------------------------------------------------------------------------
// Get a specific job
// --------------------------------------------------------------------------
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM background_jobs WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({ success: true, job: rows[0] });
  } catch (error) {
    console.error('[Jobs] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch job' });
  }
});

// --------------------------------------------------------------------------
// Cancel a pending job
// --------------------------------------------------------------------------
router.post('/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      `UPDATE background_jobs SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'processing')`,
      [req.params.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Job not found or not cancellable' });
    }

    res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    console.error('[Jobs] Cancel error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to cancel job' });
  }
});

// --------------------------------------------------------------------------
// Retry a failed job
// --------------------------------------------------------------------------
router.post('/:id/retry', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE background_jobs SET status = 'pending', error = NULL, attempts = 0, updated_at = NOW()
       WHERE id = $1 AND status = 'failed'
       RETURNING id, queue, type`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found or not in failed state' });
    }

    res.json({ success: true, message: 'Job queued for retry', job: rows[0] });
  } catch (error) {
    console.error('[Jobs] Retry error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to retry job' });
  }
});

// --------------------------------------------------------------------------
// Cleanup old completed jobs
// --------------------------------------------------------------------------
router.post('/cleanup', requireAdmin, async (req, res) => {
  try {
    const days = Math.max(parseInt(req.body.days) || 30, 7);

    const { rowCount } = await req.db.query(
      `DELETE FROM background_jobs
       WHERE status IN ('completed', 'cancelled')
       AND completed_at < NOW() - INTERVAL '1 day' * $1`,
      [days]
    );

    res.json({ success: true, deleted: rowCount, message: `Cleaned up jobs older than ${days} days` });
  } catch (error) {
    console.error('[Jobs] Cleanup error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to cleanup jobs' });
  }
});

export default router;

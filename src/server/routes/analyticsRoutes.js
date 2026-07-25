/**
 * Analytics Endpoints
 *
 * Usage statistics for the admin dashboard:
 * - Downloads per app
 * - Active users (DAU/MAU)
 * - API calls by endpoint
 * - Credit usage breakdown
 * - Revenue/billing stats
 *
 * All endpoints require authentication. Admin-only endpoints
 * check users.role === 'admin' in the DB (shared requireAdmin guard).
 */

import { Router } from 'express';
// DB-backed admin guard (users.role === 'admin'). The old local check tested
// req.user?.is_admin, a column that is never selected AND does not exist — so the
// guard rejected EVERYONE, including real admins (permanently dead endpoints).
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// --------------------------------------------------------------------------
// Track an analytics event (public — used by frontend/apps)
// --------------------------------------------------------------------------
router.post('/event', async (req, res) => {
  try {
    const { event_type, properties, session_id } = req.body;

    if (!event_type || typeof event_type !== 'string') {
      return res.status(400).json({ success: false, error: 'event_type is required' });
    }

    await req.db.query(
      `INSERT INTO analytics_events (event_type, user_id, session_id, properties, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event_type,
        req.user?.id || null,
        session_id || null,
        JSON.stringify(properties || {}),
        req.ip,
        (req.headers['user-agent'] || '').substring(0, 500),
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Analytics] Event tracking error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to track event' });
  }
});

// --------------------------------------------------------------------------
// Admin Dashboard: Overview stats
// --------------------------------------------------------------------------
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();

    // Run queries in parallel
    const [
      totalUsersResult,
      activeUsersResult,
      newUsersResult,
      totalCreditsResult,
      recentEventsResult,
    ] = await Promise.all([
      // Total registered users
      req.db.query('SELECT COUNT(*) as count FROM users WHERE is_active = true'),

      // Active users (last 30 days)
      req.db.query(
        `SELECT COUNT(DISTINCT user_id) as count
         FROM analytics_events
         WHERE created_at > $1 AND user_id IS NOT NULL`,
        [thirtyDaysAgo]
      ),

      // New users (last 7 days)
      req.db.query(
        'SELECT COUNT(*) as count FROM users WHERE created_at > $1',
        [sevenDaysAgo]
      ),

      // Total credits in circulation
      req.db.query('SELECT COALESCE(SUM(credits), 0) as total FROM users WHERE is_active = true'),

      // Events by type (last 24h)
      req.db.query(
        `SELECT event_type, COUNT(*) as count
         FROM analytics_events
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY event_type
         ORDER BY count DESC
         LIMIT 20`
      ),
    ]);

    res.json({
      success: true,
      timestamp: now.toISOString(),
      stats: {
        totalUsers: parseInt(totalUsersResult.rows[0]?.count || 0),
        activeUsersLast30d: parseInt(activeUsersResult.rows[0]?.count || 0),
        newUsersLast7d: parseInt(newUsersResult.rows[0]?.count || 0),
        totalCreditsCirculation: parseInt(totalCreditsResult.rows[0]?.total || 0),
        recentEventsByType: recentEventsResult.rows,
      },
    });
  } catch (error) {
    console.error('[Analytics] Dashboard error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
  }
});

// --------------------------------------------------------------------------
// Admin: Downloads per app (last N days)
// --------------------------------------------------------------------------
router.get('/downloads', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await req.db.query(
      `SELECT
         properties->>'app' as app,
         DATE(created_at) as date,
         COUNT(*) as count
       FROM analytics_events
       WHERE event_type = 'app_download' AND created_at > $1
       GROUP BY properties->>'app', DATE(created_at)
       ORDER BY date DESC, count DESC`,
      [since]
    );

    // Also get totals
    const { rows: totals } = await req.db.query(
      `SELECT
         properties->>'app' as app,
         COUNT(*) as total
       FROM analytics_events
       WHERE event_type = 'app_download' AND created_at > $1
       GROUP BY properties->>'app'
       ORDER BY total DESC`,
      [since]
    );

    res.json({ success: true, period: `${days}d`, daily: rows, totals });
  } catch (error) {
    console.error('[Analytics] Downloads error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch download stats' });
  }
});

// --------------------------------------------------------------------------
// Admin: Active users over time (DAU/WAU/MAU)
// --------------------------------------------------------------------------
router.get('/active-users', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await req.db.query(
      `SELECT
         DATE(created_at) as date,
         COUNT(DISTINCT user_id) as unique_users,
         COUNT(*) as total_events
       FROM analytics_events
       WHERE created_at > $1 AND user_id IS NOT NULL
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [since]
    );

    res.json({ success: true, period: `${days}d`, data: rows });
  } catch (error) {
    console.error('[Analytics] Active users error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch active user stats' });
  }
});

// --------------------------------------------------------------------------
// Admin: API usage by endpoint
// --------------------------------------------------------------------------
router.get('/api-usage', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await req.db.query(
      `SELECT
         properties->>'endpoint' as endpoint,
         properties->>'method' as method,
         COUNT(*) as count,
         AVG((properties->>'durationMs')::numeric) as avg_duration_ms
       FROM analytics_events
       WHERE event_type = 'api_request' AND created_at > $1
       GROUP BY properties->>'endpoint', properties->>'method'
       ORDER BY count DESC
       LIMIT 50`,
      [since]
    );

    res.json({ success: true, period: `${days}d`, endpoints: rows });
  } catch (error) {
    console.error('[Analytics] API usage error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch API usage stats' });
  }
});

// --------------------------------------------------------------------------
// Admin: Credit usage breakdown
// --------------------------------------------------------------------------
router.get('/credit-usage', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await req.db.query(
      `SELECT
         feature,
         COUNT(*) as request_count,
         COALESCE(SUM(credits_used), 0) as total_credits,
         ROUND(AVG(credits_used), 2) as avg_credits
       FROM credit_usage
       WHERE created_at > $1
       GROUP BY feature
       ORDER BY total_credits DESC`,
      [since]
    );

    // Daily trend
    const { rows: daily } = await req.db.query(
      `SELECT
         DATE(created_at) as date,
         COALESCE(SUM(credits_used), 0) as credits
       FROM credit_usage
       WHERE created_at > $1
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [since]
    );

    res.json({ success: true, period: `${days}d`, byFeature: rows, dailyTrend: daily });
  } catch (error) {
    console.error('[Analytics] Credit usage error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch credit usage stats' });
  }
});

// --------------------------------------------------------------------------
// User: My own usage stats
// --------------------------------------------------------------------------
router.get('/my-usage', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await req.db.query(
      `SELECT
         feature,
         COUNT(*) as request_count,
         COALESCE(SUM(credits_used), 0) as total_credits
       FROM credit_usage
       WHERE user_id = $1 AND created_at > $2
       GROUP BY feature
       ORDER BY total_credits DESC`,
      [req.user.id, since]
    );

    res.json({ success: true, period: `${days}d`, usage: rows });
  } catch (error) {
    console.error('[Analytics] My usage error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch usage stats' });
  }
});

export default router;

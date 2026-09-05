/**
 * Account API — /api/account
 *
 * Read-aggregation surface the account UI (accountService.ts) calls:
 *   GET /overview       → { success, overview: AccountOverview }
 *   GET /notifications  → { success, notifications: Notification[] }
 *
 * Pure reads over existing data (users + v2 ledger + plan + ReBAC workspaces).
 * Auth-gated per route (mirrors billingRoutes); req.db from databaseMiddleware.
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { getPlan } from '../services/billingService.js';
import { creditsView, workspaceCount } from '../utils/accountViews.js';

const router = express.Router();

// GET /api/account/overview
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const row = (await req.db.query(
      `SELECT id, username, email, display_name, avatar_url, email_verified, role, created_at, last_login
         FROM users WHERE id = $1`,
      [uid],
    )).rows[0] || {};
    const [plan, credits, wsCount] = await Promise.all([
      getPlan(req.db, uid),
      creditsView(req.db, uid),
      workspaceCount(req.db, uid),
    ]);
    res.json({
      success: true,
      overview: {
        user: {
          id: row.id || uid,
          username: row.username || '',
          email: row.email || req.user.email || '',
          display_name: row.display_name || row.username || '',
          avatar_url: row.avatar_url || null,
          plan: plan.plan,
          role: row.role || 'user',
          email_verified: !!row.email_verified,
          created_at: row.created_at || null,
          last_login: row.last_login || null,
        },
        credits: {
          balance: credits.balance,
          lifetime_earned: credits.lifetime_earned,
          lifetime_spent: credits.lifetime_spent,
          monthly_allowance: credits.monthly_allowance,
        },
        workspace_count: wsCount,
      },
    });
  } catch (err) {
    console.error('[account] overview error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load account overview' });
  }
});

// GET /api/account/notifications — real signals: pending workspace invites + email nudge.
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const me = (await req.db.query('SELECT email, email_verified FROM users WHERE id = $1', [uid])).rows[0] || {};
    const notifications = [];

    const invites = (await req.db.query(
      `SELECT i.id, i.role, i.created_at, w.name AS workspace_name
         FROM workspace_invites i
         JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.status = 'pending'
          AND (i.invited_user_id = $1 OR lower(i.invited_email) = lower($2))
        ORDER BY i.created_at DESC LIMIT 50`,
      [uid, me.email || ''],
    )).rows;
    for (const r of invites) {
      notifications.push({
        id: `invite:${r.id}`,
        type: 'workspace_invite',
        title: 'Workspace invitation',
        message: `You've been invited to join ${r.workspace_name} as ${r.role === 'editor' ? 'member' : r.role}.`,
        read: false,
        created_at: r.created_at,
        metadata: { invite_id: r.id },
      });
    }

    if (me.email_verified === false) {
      notifications.push({
        id: 'verify-email',
        type: 'system',
        title: 'Verify your email',
        message: 'Confirm your email address to secure your account and receive receipts.',
        read: false,
        created_at: new Date().toISOString(),
        metadata: {},
      });
    }

    res.json({ success: true, notifications });
  } catch (err) {
    console.error('[account] notifications error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load notifications' });
  }
});

// GET /api/account/sessions — user-owned session inventory. Bearer tokens and
// token hashes never leave the server; the current row is identified from the
// already-verified sid claim attached by authMiddleware.
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, created_at, last_active_at, expires_at, ip_address,
              user_agent, device_type, browser, os
         FROM user_sessions
        WHERE user_id = $1 AND expires_at > NOW()
        ORDER BY last_active_at DESC NULLS LAST, created_at DESC`,
      [req.user.id],
    );
    res.json({
      success: true,
      sessions: rows.map((row) => ({ ...row, current: Boolean(req.auth?.sid && row.id === req.auth.sid) })),
    });
  } catch (err) {
    console.error('[account] sessions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load sessions' });
  }
});

// DELETE /api/account/sessions/:id — exact, owner-scoped revocation. Reading the
// list again is the client-side completion proof; a missing id is not reported
// as success because that would hide stale or cross-account requests.
router.delete('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const removed = await req.db.query(
      'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id],
    );
    if (!removed.rowCount) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, revoked_session_id: removed.rows[0].id });
  } catch (err) {
    console.error('[account] session revoke error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to revoke session' });
  }
});

export default router;

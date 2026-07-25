/**
 * Dashboard API — /api/dashboard
 *
 *   GET /stats → { success, stats }  — the signed-in home dashboard's real numbers
 *   (credits, plan, workspaces, 30-day usage) so the UI can stop showing mock data.
 *
 * Pure reads over the v2 ledger + api_usage_logs + ReBAC workspaces.
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { getPlan } from '../services/billingService.js';
import { usageSummary } from '../utils/creditLedgerV2.js';
import { creditsView, workspaceCount } from '../utils/accountViews.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const [credits, wsCount, plan] = await Promise.all([
      creditsView(req.db, uid),
      workspaceCount(req.db, uid),
      getPlan(req.db, uid),
    ]);

    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    let usage = { rows: [] };
    try { usage = await usageSummary(req.db, uid, { from, to, groupBy: 'surface' }); } catch { /* usage optional */ }

    const requests30d = usage.rows.reduce((a, r) => a + (r.events || 0), 0);

    res.json({
      success: true,
      stats: {
        credits: credits.balance,
        lifetime_spent: credits.lifetime_spent,
        plan: plan.plan,
        workspace_count: wsCount,
        requests_30d: requests30d,
        usage_by_surface: usage.rows.map((r) => ({
          surface: r.key || 'other',
          events: r.events || 0,
          credits: Math.floor((r.costMicro || 0) / 1_000_000),
        })),
      },
    });
  } catch (err) {
    console.error('[dashboard] stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load dashboard stats' });
  }
});

export default router;

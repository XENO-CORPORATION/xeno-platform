/**
 * /api/compensation — how workspace members are paid (services/workforceCompensation.js). A person decides:
 * every write is a human workspace administrator's; a member reads their own.
 *
 *   GET  /agreements?workspace=              · POST /agreements {workspaceId, principalId, basis, …}
 *   POST /agreements/:id/end {workspaceId}
 *   GET  /payouts?workspace=&state=          · POST /payouts/prepare {workspaceId, periodStart, period}
 *   POST /payouts/:id/decide {workspaceId, decision: approve|skip, amountMicro?, note?}   approving pays it
 *   GET  /export.csv?workspace=&periodStart=&period=   agreements (salaries included) and payouts, for payroll
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import * as C from '../services/workforceCompensation.js';

const router = express.Router();
const fail = (res, e, what) => {
  if (e instanceof C.CompensationError) return res.status(e.status).json({ success: false, code: e.code, error: e.details.reason });
  console.error(`Compensation ${what} failed:`, e); return res.status(500).json({ success: false, error: 'Internal server error' });
};
const run = (what, fn) => [authMiddleware, async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, { actorUserId: req.user.id })) }); } catch (e) { fail(res, e, what); }
}];
const b = (req) => req.body || {};

router.get('/agreements', ...run('agreements', (req, c) => C.listAgreements(req.db, c, { workspaceId: req.query.workspace })));
router.post('/agreements', ...run('set agreement', (req, c) => C.setAgreement(req.db, c, b(req))));
router.post('/agreements/:id/end', ...run('end agreement', (req, c) => C.endAgreement(req.db, c, { workspaceId: b(req).workspaceId, agreementId: req.params.id })));
router.get('/payouts', ...run('payouts', (req, c) => C.listPayouts(req.db, c, { workspaceId: req.query.workspace, ...(req.query.state ? { state: req.query.state } : {}) })));
router.post('/payouts/prepare', ...run('prepare', (req, c) => C.preparePayouts(req.db, c, b(req))));
router.post('/payouts/:id/decide', ...run('decide', (req, c) => C.decidePayout(req.db, c, { ...b(req), payoutId: req.params.id })));
router.get('/export.csv', authMiddleware, async (req, res) => {
  try {
    const out = await C.exportCsv(req.db, { actorUserId: req.user.id }, { workspaceId: req.query.workspace, periodStart: req.query.periodStart, ...(req.query.period ? { period: req.query.period } : {}) });
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${out.filename}"`).send(out.csv);
  } catch (e) { fail(res, e, 'export'); }
});

export default router;

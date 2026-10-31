/**
 * /api/orgs/:id — a company's legal entity (services/companyEntity.js; xeno-company/SPEC.md §4.2).
 *
 *   GET    /:id                         the entity: profile, registrations, identifiers, mandates
 *   PUT    /:id/profile                 legal name, form, governing law, registered office, central administration
 *   POST   /:id/registrations | /tax | /customs | /financial | /mandates     add one
 *   DELETE /:id/:kind/:itemId           remove one
 *   POST   /:id/tax/:itemId/check       ask VIES, and keep the answer
 *
 * Anyone in the workspace reads; a person who administers it changes it.
 */
import express from 'express';
import * as company from '../services/companyEntity.js';

const router = express.Router();
const me = (req) => ({ id: req.user.id });
const handled = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof company.CompanyError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[company]', e.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
router.get('/:id', handled((req) => company.read(req.db, me(req), req.params.id)));
router.put('/:id/profile', handled((req) => company.saveProfile(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/registrations', handled((req) => company.addRegistration(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/tax', handled((req) => company.addTax(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/customs', handled((req) => company.addCustoms(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/financial', handled((req) => company.addFinancial(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/mandates', handled((req) => company.addMandate(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/tax/:itemId/check', handled((req) => company.checkVat(req.db, me(req), req.params.id, req.params.itemId)));
router.delete('/:id/:kind/:itemId', handled((req) => company.remove(req.db, me(req), req.params.id, req.params.kind, req.params.itemId)));

export default router;

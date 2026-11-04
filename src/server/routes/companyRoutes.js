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
 *
 * The rest is XENO Company's dashboard (services/companyOrgs.js, the contract in xeno-company/packages/client). Those answer the
 * bare shape that client reads, with { error, message } on a refusal:
 *
 *   GET  /  ·  POST /                                    the orgs I'm in; found one
 *   POST /:id/registration/verify                        ask the national register, and keep the answer
 *   GET  /:id/members  ·  DELETE|PATCH /:id/members/:s   humans and agents in one list
 *   GET|POST /:id/invites  ·  DELETE /:id/invites/:i
 *   POST /:id/agents  ·  PUT /:id/agents/:a/capabilities employ an agent; what it may do
 *   GET  /:id/activity | /wallet | /transactions         read only
 *   GET|POST /:id/invoices  ·  POST /:id/invoices/:n/credit   legal documents, corrected only by a credit note
 */
import express from 'express';
import * as company from '../services/companyEntity.js';
import * as orgs from '../services/companyOrgs.js';

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
/** The dashboard's shape: the value itself, 204 when there is none. */
const bare = (fn, status = 200) => async (req, res) => {
  try {
    const value = await fn(req);
    if (value === undefined) return res.status(204).end();
    res.status(status).json(value);
  } catch (e) {
    if (e instanceof company.CompanyError) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[company]', e.message);
    res.status(500).json({ error: 'internal', message: 'Something went wrong on our side.' });
  }
};
router.get('/', bare((req) => orgs.listOrgs(req.db, me(req))));
router.post('/', bare((req) => orgs.createOrg(req.db, me(req), req.body || {}), 201));
router.post('/:id/registration/verify', bare((req) => orgs.verifyRegistration(req.db, me(req), req.params.id)));
router.get('/:id/members', bare((req) => orgs.listMembers(req.db, me(req), req.params.id)));
router.delete('/:id/members/:subject', bare((req) => orgs.removeMember(req.db, me(req), req.params.id, req.params.subject)));
router.patch('/:id/members/:subject', bare((req) => orgs.changeRole(req.db, me(req), req.params.id, req.params.subject, req.body?.role)));
router.get('/:id/invites', bare((req) => orgs.listInvites(req.db, me(req), req.params.id)));
router.post('/:id/invites', bare((req) => orgs.inviteMember(req.db, me(req), req.params.id, req.body || {}), 201));
router.delete('/:id/invites/:inviteId', bare((req) => orgs.revokeInvite(req.db, me(req), req.params.id, req.params.inviteId)));
router.post('/:id/agents', bare((req) => orgs.employAgent(req.db, me(req), req.params.id, req.body || {}), 201));
router.put('/:id/agents/:agentId/capabilities', bare((req) => orgs.setAgentCapabilities(req.db, me(req), req.params.id, req.params.agentId, req.body?.capabilities)));
router.get('/:id/activity', bare((req) => orgs.listActivity(req.db, me(req), req.params.id)));
router.get('/:id/wallet', bare((req) => orgs.getWallet(req.db, me(req), req.params.id)));
router.get('/:id/transactions', bare((req) => orgs.listTransactions(req.db, me(req), req.params.id)));
router.get('/:id/invoices', bare((req) => orgs.listInvoices(req.db, me(req), req.params.id)));
router.post('/:id/invoices', bare((req) => orgs.issueInvoice(req.db, me(req), req.params.id, req.body || {}), 201));
router.post('/:id/invoices/:number/credit', bare((req) => orgs.creditInvoice(req.db, me(req), req.params.id, req.params.number, req.body?.reason), 201));

// The entity for Corpo › Company, and the Org the dashboard reads, in one answer: neither has a key the other uses.
router.get('/:id', handled(async (req) => ({ ...(await company.read(req.db, me(req), req.params.id)), ...(await orgs.getOrg(req.db, me(req), req.params.id)) })));
router.put('/:id/profile', handled((req) => company.saveProfile(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/registrations', handled((req) => company.addRegistration(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/tax', handled((req) => company.addTax(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/customs', handled((req) => company.addCustoms(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/financial', handled((req) => company.addFinancial(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/mandates', handled((req) => company.addMandate(req.db, me(req), req.params.id, req.body || {})));
router.post('/:id/tax/:itemId/check', handled((req) => company.checkVat(req.db, me(req), req.params.id, req.params.itemId)));
router.delete('/:id/:kind/:itemId', handled((req) => company.remove(req.db, me(req), req.params.id, req.params.kind, req.params.itemId)));

export default router;

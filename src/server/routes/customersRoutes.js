/**
 * /api/customers — XENO Customers, the workspace CRM (services/customers.js). Every route resolves the caller as a
 * PRINCIPAL and calls the one service; who may read or change what is decided there. `?workspace=<id>` (or body
 * `workspace`) picks the workspace, default the caller's Personal one.
 *
 *   GET  /summary · GET /contacts (?q=&companyId=&tag=) · POST /contacts · GET|PATCH|DELETE /contacts/:id
 *   GET  /contacts/:id/export (GDPR access) · POST /contacts/:id/erase (GDPR erasure, admin)
 *   POST /contacts/:id/activities · POST /activities/:id/keep {discard?}
 *   POST /contacts/:id/links {kind, key} · DELETE /contacts/:id/links/:kind/:key · POST /contacts/:id/task {title}
 *   GET  /companies · POST /companies · DELETE /companies/:id
 *   GET  /pipeline · POST /stages · POST /deals · POST /deals/:id/move {stageId} · POST /deals/:id/confirm · DELETE /deals/:id
 *   POST /import {csv, confirm?, onDuplicate?} (dry-run unless confirm) · GET /duplicates · POST /merge {into, from}
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as crm from '../services/customers.js';

const router = express.Router();
async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[customers] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof crm.CustomersError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code, ...(e.existingId ? { existingId: e.existingId } : {}) });
    if (e && e.name === 'TaskError') return res.status(e.status || e.statusCode || 400).json({ success: false, error: e.message, code: e.code });
    console.error('[customers]', e);
    return res.status(500).json({ success: false, error: 'Customers is unavailable right now' });
  }
};
const A = [authMiddleware, loadActor];
const b = (req) => req.body || {};
const ws = (req) => b(req).workspace || req.query.workspace;

router.get('/summary', ...A, run(async (req) => ({ summary: await crm.summary(req.db, req.actor, { workspace: ws(req) }) })));
router.get('/contacts', ...A, run(async (req) => ({ contacts: await crm.listContacts(req.db, req.actor, { workspace: ws(req), q: req.query.q, companyId: req.query.companyId, tag: req.query.tag }) })));
router.post('/contacts', ...A, run(async (req) => ({ contact: await crm.createContact(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.get('/contacts/:id', ...A, run(async (req) => ({ contact: await crm.getContact(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.patch('/contacts/:id', ...A, run(async (req) => ({ contact: await crm.updateContact(req.db, req.actor, req.params.id, { ...b(req), workspace: ws(req) }) })));
router.delete('/contacts/:id', ...A, run(async (req) => crm.deleteContact(req.db, req.actor, req.params.id, { workspace: ws(req) })));
router.get('/contacts/:id/export', ...A, run(async (req) => ({ export: await crm.exportContact(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.post('/contacts/:id/erase', ...A, run(async (req) => crm.eraseContact(req.db, req.actor, req.params.id, { workspace: ws(req) })));
router.post('/contacts/:id/activities', ...A, run(async (req) => ({ activity: await crm.addActivity(req.db, req.actor, req.params.id, { workspace: ws(req), kind: b(req).kind, body: b(req).body }) })));
router.post('/activities/:id/keep', ...A, run(async (req) => crm.keepActivity(req.db, req.actor, req.params.id, { workspace: ws(req), discard: b(req).discard === true })));
router.post('/contacts/:id/links', ...A, run(async (req) => crm.link(req.db, req.actor, req.params.id, { workspace: ws(req), kind: b(req).kind, key: b(req).key })));
router.delete('/contacts/:id/links/:kind/:key', ...A, run(async (req) => crm.unlink(req.db, req.actor, req.params.id, { workspace: ws(req), kind: req.params.kind, key: req.params.key })));
router.post('/contacts/:id/task', ...A, run(async (req) => ({ task: await crm.createTaskFor(req.db, req.actor, req.params.id, { workspace: ws(req), title: b(req).title, projectId: b(req).projectId }) })));
router.get('/companies', ...A, run(async (req) => ({ companies: await crm.listCompanies(req.db, req.actor, { workspace: ws(req) }) })));
router.post('/companies', ...A, run(async (req) => ({ company: await crm.createCompany(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.delete('/companies/:id', ...A, run(async (req) => crm.deleteCompany(req.db, req.actor, req.params.id, { workspace: ws(req) })));
router.get('/pipeline', ...A, run(async (req) => ({ pipeline: await crm.pipeline(req.db, req.actor, { workspace: ws(req) }) })));
router.post('/stages', ...A, run(async (req) => ({ stage: await crm.createStage(req.db, req.actor, { workspace: ws(req), name: b(req).name, outcome: b(req).outcome }) })));
router.post('/deals', ...A, run(async (req) => ({ deal: await crm.createDeal(req.db, req.actor, { ...b(req), workspace: ws(req) }) })));
router.post('/deals/:id/move', ...A, run(async (req) => ({ deal: await crm.moveDeal(req.db, req.actor, req.params.id, { workspace: ws(req), stageId: b(req).stageId }) })));
router.post('/deals/:id/confirm', ...A, run(async (req) => ({ deal: await crm.confirmDeal(req.db, req.actor, req.params.id, { workspace: ws(req) }) })));
router.delete('/deals/:id', ...A, run(async (req) => crm.deleteDeal(req.db, req.actor, req.params.id, { workspace: ws(req) })));
router.post('/import', ...A, run(async (req) => ({ report: await crm.importCsv(req.db, req.actor, { workspace: ws(req), csv: b(req).csv, confirm: b(req).confirm === true, onDuplicate: b(req).onDuplicate }) })));
router.get('/duplicates', ...A, run(async (req) => ({ duplicates: await crm.findDuplicates(req.db, req.actor, { workspace: ws(req) }) })));
router.post('/merge', ...A, run(async (req) => ({ contact: await crm.mergeContacts(req.db, req.actor, { workspace: ws(req), into: b(req).into, from: b(req).from }) })));

export default router;

/**
 * XENO-WORKFORCE-01 RES-01..06 -- the contributed-resource API.
 *
 * resourceOffers, resourceDrivers, contributedCompute, computeReceipts, resourceLeases and grantComposition were
 * built and tested with no route. The adapter binds the actor from the session and adds the rules the services
 * leave to their caller:
 *   - QUALIFYING a compute worker and ADMITTING a resource driver are platform-operator acts (RES-02/03: a donated
 *     worker is untrusted until separately qualified). Neither service checks who asks, so the route allows only a
 *     usable human platform admin. A donor qualifying their own worker would be self-attestation.
 *   - Reading a lease is for its holder or its offer's owner; anyone else gets not_found, like a missing id.
 *   - The worker-side calls (credential validation, output reports) authenticate with the per-task credential,
 *     not a person's session; they belong to the runner/Box transport and are deliberately not routed here.
 * Contributed compute EXECUTION still requires a qualified Box backend (RES-03); this API records offers,
 * scheduling, receipts and settlement basis, and executes nothing.
 */
import express from 'express';
import { resolvePrincipal } from '../services/agentIdentity.js';
import * as offers from '../services/resourceOffers.js';
import * as drivers from '../services/resourceDrivers.js';
import * as compute from '../services/contributedCompute.js';
import * as receipts from '../services/computeReceipts.js';
import * as leases from '../services/resourceLeases.js';
import * as grants from '../services/grantComposition.js';
import { classify, IDENTITY } from './workforcePublicContributionRoutes.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

async function requirePlatformAdmin(db, actorUserId) {
  const p = await resolvePrincipal(db, actorUserId);
  const role = (await db.query('SELECT role FROM users WHERE id=$1', [actorUserId])).rows[0]?.role;
  if (!p?.usable || p.kind !== 'human' || role !== 'admin') refuse('denied', 'platform_operator_required');
}

export function createResourceRouter() {
  const router = express.Router();
  const route = (keys, service) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if (IDENTITY.includes(k) || !keys.includes(k)) refuse('bad_input', 'unknown_field');
      const me = req.workforceContext.actorUserId;
      return res.json({ success: true, result: await service(req.db, { ...body, actorUserId: me }, me) });
    } catch (error) {
      const e = classify(error);
      if (Object.hasOwn(STATUS, e?.code)) return res.status(STATUS[e.code]).json({ success: false, code: e.code, reason: e.reason || e.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  const operator = (fn) => async (db, v, me) => { await requirePlatformAdmin(db, me); return fn(db, v); };
  // RES-01: offers
  router.post('/offers', route(['offer'], offers.createResourceOffer));
  router.post('/offers/revoke', route(['offerId'], offers.revokeResourceOffer));
  router.post('/offers/accept', route(['offerId', 'projectId', 'taskRef', 'quantity', 'validUntil'], offers.acceptResourceOffer));
  // RES-02: families and drivers (driver admission is an operator act)
  router.post('/drivers/admit', route(['family', 'driverName', 'receipt'], operator(drivers.admitResourceDriver)));
  router.post('/proposals', route(['offer'], drivers.recordResourceProposal));
  router.post('/offers/usable', route([], drivers.listUsableOffers));
  // RES-03: contributed compute -- registered untrusted; qualification is an operator act
  router.post('/workers', route(['isolation', 'egress', 'devices'], compute.registerComputeWorker));
  router.post('/workers/qualify', route(['workerId', 'evidence'], operator(compute.qualifyComputeWorker)));
  router.post('/workers/caps', route(['workerId', 'caps'], compute.approveWorkerCaps));
  router.post('/workers/schedule', route(['workerId', 'inputClassification', 'request', 'credentialTtlSeconds'], compute.scheduleComputeTask));
  // RES-04: receipts are verified and accepted by people, never trusted as reported
  router.post('/tasks/cancel', route(['taskId'], receipts.cancelComputeTask));
  router.post('/receipts/verify', route(['receiptId', 'artifactHash', 'method'], receipts.verifyTaskReceipt));
  router.post('/receipts/accept', route(['receiptId'], receipts.acceptTaskResult));
  // RES-05: leases
  router.post('/leases/read', route(['leaseId'], async (db, v, me) => {
    const l = (await db.query(`SELECT l.holder_user_id, o.owner_user_id FROM resource_leases l JOIN resource_offers o ON o.id=l.offer_id WHERE l.id=$1`, [v.leaseId])).rows[0];
    if (!l || ![String(l.holder_user_id), String(l.owner_user_id)].includes(String(me))) refuse('not_found', 'lease_not_found');
    return leases.readLease(db, { leaseId: v.leaseId });
  }));
  router.post('/leases/revoke', route(['leaseId'], leases.revokeLease));
  router.post('/leases/release', route(['leaseId'], leases.releaseLease));
  router.post('/leases/retention', route(['offerId', 'retentionDays', 'exportGraceDays'], leases.setRetentionTerms));
  router.post('/leases/settle', route(['leaseId', 'method', 'reference', 'receiptIds'], leases.recordLeaseSettlement));
  // RES-06: grants composed into one admission
  router.post('/grants', route(['type', 'resourceLeaseId', 'creditAmount', 'consentScope'], grants.issueGrant));
  router.post('/grants/revoke', route(['grantId'], grants.revokeGrant));
  router.post('/grants/compose', route(['taskRef', 'grantIds'], grants.composeAdmission));
  return router;
}

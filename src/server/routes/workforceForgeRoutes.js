/**
 * XENO-WORKFORCE-01 FORGE-01 / 02 / 04 / 06 -- the repository-host-neutral contribution API.
 *
 * forgeAdapter (bind, revisions, branches, forks, change requests, checks, reviews, reconcile, integrate),
 * forgeAuthority (single-owner mirrors) and forgeExternalActors (verified identity links, per-scope consent) were
 * built and tested with no route. Writes are authorized by the services (project admin; a link and its consent
 * are the linked person's own); the adapter binds identity from the session and guards id-only reads by the
 * binding's project visibility.
 *
 * Deliberately NOT routed, and why:
 *   - FORGE-03 App approval / installation tokens: no GitHub App is approved or installed. Registering one is an
 *     operator act against GitHub that defines the credentials this path would hand out.
 *   - FORGE-05 webhook intake: GitHub's delivery format belongs to that App, and the service's HMAC master falls
 *     back to a development secret when WEBHOOK_MASTER_SECRET is unset -- a public endpoint over that fallback
 *     would accept forged deliveries. It is exposed only once the App and the secret exist.
 *   - Ingest calls (recordExternalActor, attributeExternalWork, ingestGithubEvent, recordGithubMerge) are what
 *     that webhook path performs, never a person's call.
 */
import express from 'express';
import * as forge from '../services/forgeAdapter.js';
import * as authority from '../services/forgeAuthority.js';
import * as external from '../services/forgeExternalActors.js';
import { classify, assertProjectVisible, IDENTITY } from './workforcePublicContributionRoutes.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

async function bindingProject(db, bindingId) {
  const r = (await db.query('SELECT project_id FROM forge_bindings WHERE id=$1', [bindingId])).rows[0];
  if (!r) refuse('not_found', 'not_found');
  return r.project_id;
}
async function crProject(db, crId) {
  const r = (await db.query('SELECT b.project_id FROM forge_change_requests c JOIN forge_bindings b ON b.id=c.binding_id WHERE c.id=$1', [crId])).rows[0];
  if (!r) refuse('not_found', 'not_found');
  return r.project_id;
}

export function createForgeRouter() {
  const router = express.Router();
  const route = (keys, service, bind = ['actorUserId']) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if ([...IDENTITY, 'grantedByUserId', 'revokedByUserId'].includes(k) || !keys.includes(k)) refuse('bad_input', 'unknown_field');
      const me = req.workforceContext.actorUserId;
      const value = { ...body }; for (const k of bind) value[k] = me;
      return res.json({ success: true, result: await service(req.db, value, me) });
    } catch (error) {
      const e = classify(error);
      if (Object.hasOwn(STATUS, e?.code)) return res.status(STATUS[e.code]).json({ success: false, code: e.code, reason: e.reason || e.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  const readOn = (of, idKey, fn) => async (db, v, me) => { await assertProjectVisible(db, me, await of(db, v[idKey])); return fn(db, v); };
  // FORGE-01 / 02: bindings and the neutral operations
  router.post('/capabilities', route(['provider'], (db, v) => forge.describeCapabilities(v.provider), []));
  router.post('/bindings', route(['projectId', 'provider', 'remoteId', 'installationRef', 'refs', 'accessPolicy', 'displayName'], forge.bindRepository));
  router.post('/bindings/list', route(['projectId'], async (db, v, me) => { await assertProjectVisible(db, me, v.projectId); return forge.listProjectBindings(db, v.projectId); }, []));
  router.post('/revisions/read', route(['bindingId', 'rev'], readOn(bindingProject, 'bindingId', forge.readRevision), []));
  router.post('/branches', route(['bindingId', 'name', 'fromRev'], forge.createBranch));
  router.post('/forks', route(['bindingId', 'name'], forge.forkRepository));
  router.post('/change-requests', route(['bindingId', 'sourceBranch', 'targetRef', 'title', 'body'], forge.submitChangeRequest));
  router.post('/change-requests/update', route(['crId', 'title', 'body', 'headRev'], forge.updateChangeRequest));
  router.post('/change-requests/checks', route(['crId'], readOn(crProject, 'crId', forge.listChecks), []));
  router.post('/change-requests/reviews', route(['crId'], readOn(crProject, 'crId', forge.listReviews), []));
  router.post('/change-requests/reconcile', route(['crId'], readOn(crProject, 'crId', forge.reconcileStatus), []));
  router.post('/change-requests/integrate', route(['crId', 'policy'], forge.integrateChangeRequest));
  router.post('/change-requests/check', route(['crId', 'name', 'status', 'detail'], forge.recordForgeCheck));
  router.post('/change-requests/review', route(['crId', 'decision', 'body'], forge.recordForgeReview, ['reviewerUserId']));
  // FORGE-04: single-owner mirrors -- XENO writes only XENO-owned fields
  router.post('/mirrors', route(['bindingId', 'subjectType', 'subjectId', 'githubRef'], authority.linkMirror));
  router.post('/mirrors/update', route(['mirrorId', 'fields'], authority.updateXenoMirror));
  router.post('/mirrors/read', route(['mirrorId'], async (db, v, me) => {
    const m = (await db.query('SELECT binding_id FROM forge_mirrors WHERE id=$1', [v.mirrorId])).rows[0];
    if (!m) refuse('not_found', 'not_found');
    await assertProjectVisible(db, me, await bindingProject(db, m.binding_id));
    return authority.readMirror(db, v.mirrorId);
  }, []));
  // FORGE-06: an external contributor links their own identity and grants their own consent
  router.post('/external/link', route(['actorId', 'method', 'proofRef'], external.linkExternalIdentity, ['actorUserId', 'userId']));
  router.post('/external/consent', route(['actorId', 'scope'], external.grantExternalConsent, ['grantedByUserId']));
  router.post('/external/consent/revoke', route(['actorId', 'scope'], external.revokeExternalConsent, ['revokedByUserId']));
  router.post('/external/attribution', route(['actorId'], (db, v) => external.readExternalAttribution(db, v.actorId), []));
  return router;
}

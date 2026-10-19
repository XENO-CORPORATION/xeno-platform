/**
 * XENO-WORKFORCE-01 PUB-03..07 / PUB-10 / PUB-12 -- the public-contribution API.
 *
 * participationOffers, contributions, contributionLifecycle, taskClaims, submissionIntegrity and taskDiscussion
 * were built and tested with no route. Their writes authorize the actor themselves (policy, maintainer,
 * claimant, reviewer rules); this adapter does three things and nothing else:
 *   1. binds EVERY identity parameter -- actor, author, responsible human, payer, claimant, reviewer, reporter,
 *      appellant -- to the authenticated principal. No body may name a person; that is how a contributor-funded
 *      offer stays funded by its offerer (PUB-09) and a review stays the reviewer's own.
 *   2. guards the reads that take only an id: the row's project must be public, or the actor must hold it.
 *      Anything else answers not_found, exactly like a missing id (NFR-07).
 *   3. classifies the services' plain Errors: "... not found" is 404, an authorization refusal is 403, any
 *      other is the caller's input (400) -- never a 503 that would read as an outage.
 */
import express from 'express';
import { check } from '../utils/authzReBAC.js';
import { readProjectPolicies } from '../services/projectPolicies.js';
import * as offers from '../services/participationOffers.js';
import * as contrib from '../services/contributions.js';
import { transitionContribution, readTransitions } from '../services/contributionLifecycle.js';
import * as claims from '../services/taskClaims.js';
import * as integrity from '../services/submissionIntegrity.js';
import * as discussion from '../services/taskDiscussion.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };
export const IDENTITY = ['actorUserId', 'authorUserId', 'responsibleUserId', 'payerUserId', 'claimantUserId', 'reviewerUserId',
  'reporterUserId', 'appellantUserId', 'readerUserId', 'userId', 'principal', 'auth'];

/** A plain Error from these services, classified. Messages are the services' own and safe to return. */
export function classify(e) {
  if (e?.code && Object.hasOwn(STATUS, e.code)) return e;
  const m = String(e?.message || '');
  if (/not found/i.test(m)) return Object.assign(e, { code: 'not_found', reason: m });
  if (/already|conflict|mismatch|collid|key_conflict/i.test(m) && !/not found/i.test(m)) return Object.assign(e, { code: 'conflict', reason: m });
  if (/no_live_scope|external_agent_denied|not_owner|_required$/i.test(m)) return Object.assign(e, { code: /_required$/.test(m) ? 'bad_input' : 'denied', reason: m });
  if (/not_authorized|not authorized|only the|maintainer|administrator|blocked|refused|forbidden|not allowed/i.test(m)) return Object.assign(e, { code: 'denied', reason: m });
  if (e instanceof Error && !e.code) return Object.assign(e, { code: 'bad_input', reason: m });
  return e;
}

/** Visible: public/unlisted project, or the actor holds it. */
export async function assertProjectVisible(db, actorUserId, projectId) {
  let policies;
  try { policies = await readProjectPolicies(db, projectId); } catch { refuse('not_found', 'not_found'); }
  if (policies.visibility && policies.visibility !== 'private') return;
  if (String(policies.ownerUserId) === String(actorUserId)) return;
  if ((await check(db, { object: `project:${projectId}`, relation: 'viewer', subject: `user:${actorUserId}` })).allowed) return;
  refuse('not_found', 'not_found');
}
async function projectOfTask(db, taskId) {
  const r = (await db.query(`SELECT g.project_id FROM project_tasks t JOIN project_milestones m ON m.id=t.milestone_id
    JOIN project_goals g ON g.id=m.goal_id WHERE t.id=$1`, [taskId])).rows[0];
  if (!r) refuse('not_found', 'not_found');
  return r.project_id;
}
const rowProject = (table) => async (db, id) => {
  const r = (await db.query(`SELECT project_id FROM ${table} WHERE id=$1`, [id])).rows[0];
  if (!r) refuse('not_found', 'not_found');
  return r.project_id;
};

export function createPublicContributionRouter() {
  const router = express.Router();
  const route = (keys, service, bind = ['actorUserId']) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if (IDENTITY.includes(k) || !keys.includes(k)) refuse('bad_input', 'unknown_field');
      const me = req.workforceContext.actorUserId;
      const value = { ...body }; for (const k of bind) value[k] = me;
      return res.json({ success: true, result: await service(req.db, value, me) });
    } catch (error) {
      const e = classify(error);
      if (Object.hasOwn(STATUS, e?.code)) return res.status(STATUS[e.code]).json({ success: false, code: e.code, reason: e.reason || e.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  const guardedRead = (idKey, projectOf, read) => async (db, v, me) => {
    await assertProjectVisible(db, me, await projectOf(db, v[idKey]));
    return read(db, v[idKey]);
  };
  // PUB-03: participation offers -- an offer is contributor-funded: its payer IS its offerer
  router.post('/offers/policy', route(['projectId', 'autoAccept', 'maxSpendMicro'], offers.setOfferPolicy));
  router.post('/offers', route(['projectId', 'resourceId', 'resourceKind', 'taskId', 'spendLimitMicro', 'executeRequested', 'expiresAt'],
    offers.submitOffer, ['actorUserId', 'payerUserId']));
  router.post('/offers/accept', route(['offerId'], offers.acceptOffer));
  router.post('/offers/decline', route(['offerId'], offers.declineOffer));
  router.post('/offers/withdraw', route(['offerId'], offers.withdrawOffer));
  router.post('/offers/read', route(['offerId'], guardedRead('offerId', rowProject('participation_offers'), offers.readOffer)));
  router.post('/engagements/read', route(['engagementId'], guardedRead('engagementId', rowProject('task_engagements'), offers.readEngagement)));
  // PUB-04/05: contributions -- the author and the responsible human are the caller
  router.post('/terms', route(['projectId', 'requiresCla', 'claId', 'claVersion'], contrib.setContributionTerms));
  router.post('/contributions', route(['projectId', 'taskId', 'type', 'provenance', 'revisionHash', 'evidence', 'origin', 'rightsLicense', 'claId', 'artifact'],
    contrib.submitContribution, ['authorUserId', 'responsibleUserId']));
  router.post('/contributions/revise', route(['contributionId', 'revisionHash', 'evidence', 'artifact'], contrib.submitRevision));
  router.post('/contributions/read', route(['contributionId'], guardedRead('contributionId', rowProject('contributions'), contrib.readContribution)));
  // PUB-06: the shared lifecycle
  router.post('/contributions/transition', route(['contributionId', 'toState', 'rationale'], transitionContribution));
  router.post('/contributions/transitions', route(['contributionId'], guardedRead('contributionId', rowProject('contributions'), readTransitions)));
  // PUB-10: reviews, checks, integration
  router.post('/contributions/reviews', route(['contributionId', 'revisionNo', 'decision', 'rationale'], integrity.recordReview, ['reviewerUserId']));
  router.post('/contributions/checks', route(['contributionId', 'revisionNo', 'checks'], integrity.recordChecks));
  router.post('/contributions/integrate', route(['contributionId', 'expectedRevisionNo', 'rationale'], integrity.integrateContribution));
  router.post('/contributions/reviews/read', route(['contributionId'], guardedRead('contributionId', rowProject('contributions'), integrity.readReviews)));
  router.post('/contributions/checks/read', route(['contributionId'], guardedRead('contributionId', rowProject('contributions'), integrity.readChecks)));
  // PUB-07: bounded task claims (commit, reveal, award, release)
  // A task on a project the claimant cannot see does not exist for them; claimTask itself never asks.
  router.post('/claims', route(['taskId', 'commitment', 'idempotencyKey', 'ttlSeconds'], async (db, v, me) => {
    await assertProjectVisible(db, me, await projectOfTask(db, v.taskId));
    return claims.claimTask(db, v);
  }, ['claimantUserId']));
  router.post('/claims/reveal', route(['claimId', 'secret'], claims.revealClaim, ['claimantUserId']));
  router.post('/claims/award', route(['claimId'], claims.awardClaim));
  router.post('/claims/release', route(['claimId'], claims.releaseClaim));
  router.post('/claims/read', route(['claimId'], async (db, v, me) => {
    const c = (await db.query('SELECT task_id FROM task_claims WHERE id=$1', [v.claimId])).rows[0];
    if (!c) refuse('not_found', 'not_found');
    await assertProjectVisible(db, me, await projectOfTask(db, c.task_id));
    return claims.readClaim(db, v.claimId);
  }));
  // PUB-12: discussion, reports, appeals, blocks, attribution
  // postTaskComment checks blocks and rate, not whether the author may see the project: the route does.
  router.post('/discussion', route(['taskId', 'body'], async (db, v, me) => {
    await assertProjectVisible(db, me, await projectOfTask(db, v.taskId));
    return discussion.postTaskComment(db, v);
  }, ['authorUserId']));
  router.post('/discussion/read', route(['taskId'], async (db, v, me) => {
    await assertProjectVisible(db, me, await projectOfTask(db, v.taskId));
    return discussion.readTaskDiscussion(db, { taskId: v.taskId, readerUserId: me });
  }));
  const postProject = async (db, postId) => {
    const r = (await db.query('SELECT task_id FROM task_discussion_posts WHERE id=$1', [postId])).rows[0];
    if (!r) refuse('not_found', 'not_found');
    return projectOfTask(db, r.task_id);
  };
  router.post('/discussion/report', route(['postId', 'reason', 'detail'], async (db, v, me) => {
    await assertProjectVisible(db, me, await postProject(db, v.postId));
    return discussion.reportPost(db, v);
  }, ['reporterUserId']));
  router.post('/discussion/reports/decide', route(['reportId', 'decision', 'action'], discussion.decideReport));
  router.post('/discussion/appeal', route(['postId', 'grounds'], async (db, v, me) => {
    await assertProjectVisible(db, me, await postProject(db, v.postId));
    return discussion.appealModeration(db, v);
  }, ['appellantUserId']));
  router.post('/discussion/appeals/decide', route(['appealId', 'decision'], discussion.decideAppeal));
  router.post('/discussion/block', route(['projectId', 'blockedUserId', 'reason'], discussion.blockDiscusser));
  router.post('/discussion/unblock', route(['projectId', 'blockedUserId'], discussion.unblockDiscusser));
  router.post('/attributions', route(['contributionId'], discussion.recordAttribution));
  router.post('/attributions/mine', route([], (db, _v, me) => discussion.readAttributions(db, me)));
  return router;
}

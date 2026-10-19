/**
 * XENO-WORKFORCE-01 PUB-08 / PUB-09 / PUB-11 / PUB-13 / PUB-14 -- external scope, project-funded work grants,
 * conversation publication, visibility retreat and forks.
 *
 * externalAgentScope, workFunding, conversationPublication, visibilityRetreat and projectFork were built and
 * tested with no route. Same adapter rules as the contribution API (workforcePublicContributionRoutes.js):
 *   - every identity parameter is bound to the session -- the external agent reading its own scope IS the caller,
 *     the requester/dispatcher/consenting owner/forker is the caller;
 *   - published reads gate themselves on publication state (a revoked publication reads as gone); the bundle
 *     export reads only the PUBLIC projection; fork provenance is guarded by the fork's visibility;
 *   - services' plain Errors are classified, never surfaced as an outage.
 * No ledger movement happens here: a budget grant is a decision record, and spending still goes through run
 * admission against a funding pool (FUND-06), never a second path.
 */
import express from 'express';
import * as scope from '../services/externalAgentScope.js';
import * as work from '../services/workFunding.js';
import * as pub from '../services/conversationPublication.js';
import * as retreat from '../services/visibilityRetreat.js';
import * as fork from '../services/projectFork.js';
import { assertConversationAccess } from './workforceSessionRoutes.js';
import { classify, assertProjectVisible, IDENTITY } from './workforcePublicContributionRoutes.js';

const STATUS = { bad_input: 400, denied: 403, not_found: 404, conflict: 409, unavailable: 503 };
const refuse = (code, reason) => { throw Object.assign(new Error(reason), { code, reason }); };

export function createPublicationRouter() {
  const router = express.Router();
  const route = (keys, service, bind = ['actorUserId']) => async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_input', 'invalid_body');
      for (const k of Object.keys(body)) if ([...IDENTITY, 'requesterUserId', 'dispatcherUserId', 'ownerUserId', 'forkerUserId', 'agentUserId'].includes(k) || !keys.includes(k)) refuse('bad_input', 'unknown_field');
      const me = req.workforceContext.actorUserId;
      const value = { ...body }; for (const k of bind) value[k] = me;
      return res.json({ success: true, result: await service(req.db, value, me) });
    } catch (error) {
      const e = classify(error);
      if (Object.hasOwn(STATUS, e?.code)) return res.status(STATUS[e.code]).json({ success: false, code: e.code, reason: e.reason || e.message });
      return res.status(503).json({ success: false, code: 'unavailable' });
    }
  };
  // PUB-08: a maintainer binds an external agent to an engagement; the agent reads only its scope
  router.post('/external/bind', route(['engagementId', 'agentPrincipalId', 'ttlSeconds'],
    (db, v) => scope.bindExternalAgent(db, { engagementId: v.engagementId, agentUserId: v.agentPrincipalId, actorUserId: v.actorUserId, ttlSeconds: v.ttlSeconds })));
  for (const [path, fn, keys] of [['/external/task', scope.readScopedTask, ['taskId']], ['/external/engagement', scope.readScopedEngagement, ['engagementId']],
    ['/external/claim', scope.readScopedClaim, ['claimId']], ['/external/contribution', scope.readScopedContribution, ['contributionId']],
    ['/external/transitions', scope.readScopedTransitions, ['contributionId']], ['/external/conversation', scope.readScopedConversation, ['conversationId']],
    ['/external/project', scope.readScopedProject, ['projectId']], ['/external/draft', scope.readScopedDraft, ['projectId']]]) {
    router.post(path, route(keys, fn, ['agentUserId']));
  }
  // PUB-09: project-funded work needs an accepted grant and the resource owner's invocation consent
  router.post('/grants', route(['projectId', 'taskId', 'amountMicro', 'expiresAt'], work.requestBudgetGrant, ['requesterUserId']));
  router.post('/grants/accept', route(['grantId'], work.acceptBudgetGrant));
  router.post('/grants/decline', route(['grantId'], work.declineBudgetGrant));
  router.post('/grants/revoke', route(['grantId'], work.revokeBudgetGrant));
  router.post('/grants/consent', route(['resourceId', 'taskId', 'expiresAt'], work.consentAgentInvocation, ['ownerUserId']));
  router.post('/grants/dispatch', route(['grantId', 'resourceId'], work.dispatchProjectFundedWork, ['dispatcherUserId']));
  router.post('/grants/read', route(['grantId'], async (db, v, me) => {
    const g = (await db.query('SELECT project_id FROM project_budget_grants WHERE id=$1', [v.grantId])).rows[0];
    if (!g) refuse('not_found', 'not_found');
    await assertProjectVisible(db, me, g.project_id);
    return work.readBudgetGrant(db, v.grantId);
  }));
  // PUB-11: selected updates vs full transcripts, with every participant's consent
  router.post('/conversations/updates', route(['conversationId', 'messageIds'], pub.publishSelectedUpdates));
  router.post('/conversations/full/request', route(['conversationId', 'mode', 'scope'], pub.requestFullPublication));
  router.post('/conversations/full/consent', route(['conversationId', 'scopeHash'], async (db, v, me) => {
    await assertConversationAccess(db, me, v.conversationId, 'viewer');
    return pub.recordPublicationConsent(db, { conversationId: v.conversationId, userId: me, scopeHash: v.scopeHash });
  }, []));
  router.post('/conversations/full/withdraw', route(['conversationId'], (db, v, me) => pub.withdrawPublicationConsent(db, { conversationId: v.conversationId, userId: me }), []));
  router.post('/conversations/full/publish', route(['conversationId'], pub.publishFullConversation));
  router.post('/conversations/revoke', route(['conversationId'], pub.revokePublication));
  router.post('/conversations/updates/read', route(['conversationId'], (db, v) => pub.readPublishedUpdates(db, v.conversationId), []));
  router.post('/conversations/transcript', route(['conversationId'], (db, v) => pub.readPublishedTranscript(db, v.conversationId), []));
  router.post('/conversations/live', route(['conversationId', 'after', 'limit'], (db, v) => pub.readPublishedLiveEvents(db, v), []));
  router.post('/artifact-links', route(['artifactId', 'revision', 'ttlSeconds', 'retentionDays', 'projectId'], pub.publishArtifactLink));
  router.post('/artifact-links/revoke', route(['linkId'], pub.revokeArtifactLink));
  // PUB-13: repository visibility and the public->private retreat
  router.post('/repository', route(['projectId', 'provider', 'remoteUrl', 'repoVisibility'], retreat.linkRepository));
  router.post('/repository/visibility', route(['projectId', 'repoVisibility'], retreat.setRepositoryVisibility));
  router.post('/repository/read', route(['projectId'], async (db, v, me) => {
    await assertProjectVisible(db, me, v.projectId);
    return retreat.readRepositoryLink(db, v.projectId);
  }, []));
  router.post('/retreat', route(['projectId', 'acknowledgeUnrecallable'], (db, v, me) =>
    retreat.retreatProjectToPrivate(db, { projectId: v.projectId, actorUserId: me, acknowledgeUnrecallable: v.acknowledgeUnrecallable, clientId: 'workforce-public-api' }), []));
  // PUB-14: export/fork only the redistributable public projection
  router.post('/export', route(['projectId'], (db, v) => fork.exportProjectBundle(db, v.projectId), []));
  router.post('/fork', route(['upstreamProjectId', 'name'], fork.forkProject, ['forkerUserId']));
  router.post('/fork/provenance', route(['forkProjectId'], async (db, v, me) => {
    await assertProjectVisible(db, me, v.forkProjectId);
    return fork.readForkProvenance(db, v.forkProjectId);
  }, []));
  return router;
}

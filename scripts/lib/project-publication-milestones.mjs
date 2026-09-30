import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as publication from '../../src/server/services/projectPublication.js';
import router from '../../src/server/routes/projectPublicationRoutes.js';
import { createAuthorizedProject, userPrincipal } from '../../src/server/services/chatProjectAuthority.js';
import { provePublicationBrowser } from './project-publication-browser.mjs';

// Called only after the real funded-admission HTTP journey has accepted this milestone.
// No acceptance, evidence, or producer rows are fabricated for publication.
export async function proveAcceptedPublication({ pool, app, server, call, projectId, owner, approver, contributor,
  milestone, unacceptedMilestoneId, admissionId, contributorStatement }) {
  app.use('/api/public-projects', router);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const base = { projectId, expectedActorAccountId: owner };
  const context = { actorUserId: owner, clientId: 'xeno-agent-interface' };
  const listPath = '/api/public-projects/milestones';
  assert.equal((await call(base, 'openid', listPath)).status, 403, 'milestone selection requires project read scope');
  assert.equal((await call({ ...base, expectedActorAccountId: contributor }, 'openid projects:read', listPath, contributor)).status, 404, 'contributing funds grants no publication authority');
  assert.equal((await call({ ...base, expectedActorAccountId: approver }, 'openid projects:read', listPath)).status, 403, 'selection binds the authenticated account');
  const listed = await call(base, 'openid projects:read', listPath);
  assert.equal(listed.status, 200, 'accepted milestone selection is reachable through real auth');
  const selected = listed.body.result.milestones.find(row => row.milestoneId === milestone.id);
  assert(selected, 'the actually accepted milestone is selectable');
  assert(!listed.body.result.milestones.some(row => row.milestoneId === unacceptedMilestoneId), 'unaccepted milestones are not selectable');
  const after = await call({ ...base, after: milestone.id }, 'openid projects:read', listPath);
  assert(!after.body.result.milestones.some(row => row.milestoneId === milestone.id), 'selection cursor advances past the last identity');
  const evidence = (await pool.query('SELECT report_hash FROM workforce_milestone_evidence WHERE milestone_id=$1', [milestone.id])).rows[0];
  const forbidden = [milestone.id, admissionId, selected.acceptanceHash, evidence.report_hash, approver, contributor,
    contributorStatement, 'PRIVATE PROMPT CONTENT', 'artifact:private-result', '_acceptedSources', 'criteriaCount', 'fundingTotals'];

  // Exercise selection, private draft, exact preview, lost acknowledgement/reconciliation,
  // direct public entry/reload/Back/Forward and withdrawal with real components and HTTP.
  const jwt = createRequire(new URL('../../src/server/package.json', import.meta.url))('jsonwebtoken');
  process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
  const token = jwt.sign({ userId: owner }, process.env.JWT_SECRET, { expiresIn: '5m' });
  await provePublicationBrowser({ app, baseUrl, projectId, accountId: owner, token,
    milestone: selected, forbidden });
  let state = await publication.readProjectPublication(pool, context, base);
  const item = state.draft.acceptedMilestones[0];
  const save = async content => {
    const result = await publication.mutateProjectPublication(pool, context, { ...base, action: 'draft', content,
      operationId: randomUUID(), expectedRevision: state.revision });
    state = await publication.readProjectPublication(pool, context, base);
    return result;
  };
  const preview = () => publication.previewProjectPublication(pool, context, { ...base, visibility: 'public' });
  const goodDraft = state.draft;
  const approverContext = { ...context, actorUserId: approver };
  const approverPreview = await publication.previewProjectPublication(pool, approverContext, { ...base, expectedActorAccountId: approver, visibility: 'public' });
  await pool.query("DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1 AND subject_id=$2", [projectId, approver]);
  try {
    await assert.rejects(publication.mutateProjectPublication(pool, approverContext, { ...base, expectedActorAccountId: approver,
      action: 'publish', operationId: randomUUID(), expectedRevision: state.revision, visibility: 'public', previewHash: approverPreview.previewHash }),
      { code: 'project_not_found' }, 'revoked admin cannot publish accepted summary after preview');
    await assert.rejects(publication.readPublicationMilestones(pool, approverContext, { ...base, expectedActorAccountId: approver }),
      { code: 'project_not_found' }, 'revoked admin cannot read acceptance selection');
  } finally {
    await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)", [projectId, approver]);
  }
  const foreign = await createAuthorizedProject(pool, { principal: userPrincipal(owner), name: 'Foreign private project' });
  await publication.mutateProjectPublication(pool, context, { projectId: foreign.id, expectedActorAccountId: owner,
    action: 'draft', operationId: randomUUID(), expectedRevision: '0', content: goodDraft });
  await assert.rejects(publication.previewProjectPublication(pool, context, { projectId: foreign.id, expectedActorAccountId: owner, visibility: 'public' }),
    { code: 'accepted_milestone_unavailable' }, 'foreign project cannot publish accepted source');
  await save({ ...goodDraft, acceptedMilestones: [{ ...item, milestoneId: unacceptedMilestoneId }] });
  await assert.rejects(preview(), { code: 'accepted_milestone_unavailable' }, 'unaccepted source cannot be announced as accepted');
  await save({ ...goodDraft, acceptedMilestones: [{ ...item, acceptanceHash: '0'.repeat(64) }] });
  await assert.rejects(preview(), { code: 'accepted_milestone_unavailable' }, 'changed acceptance binding refuses preview');
  await save(goodDraft);
  const exact = await preview();
  assert.deepEqual(Object.keys(exact.projection.acceptedMilestones[0]).sort(), ['label', 'status', 'summary']);
  for (const secret of forbidden) assert(!JSON.stringify(exact).includes(secret), `preview excludes ${secret}`);
  const publish = { ...base, action: 'publish', operationId: randomUUID(), expectedRevision: state.revision,
    visibility: 'public', previewHash: exact.previewHash };
  await assert.rejects(publication.mutateProjectPublication(pool, context, { ...publish, previewHash: '0'.repeat(64) }), { code: 'preview_changed' }, 'accepted summaries require the exact preview');
  await pool.query("UPDATE workforce_funding_milestones SET status='cancelled',revision=revision+1 WHERE id=$1", [milestone.id]);
  await assert.rejects(publication.mutateProjectPublication(pool, context, publish), { code: 'accepted_milestone_unavailable' }, 'publication rechecks acceptance after preview');
  await pool.query("UPDATE workforce_funding_milestones SET status='accepted',revision=revision+1 WHERE id=$1", [milestone.id]);
  await publication.mutateProjectPublication(pool, context, publish);
  const visible = await publication.readPublicProject(pool, projectId);
  for (const secret of forbidden) assert(!JSON.stringify(visible).includes(secret), `public JSON excludes ${secret}`);
  const retained = (await pool.query('SELECT projection FROM project_publication_versions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1', [projectId])).rows[0].projection;
  assert.deepEqual(retained._acceptedSources, [{ milestoneId: milestone.id, acceptanceHash: selected.acceptanceHash }], 'retained version privately binds acceptance');
  state = await publication.readProjectPublication(pool, context, base);
  await save({ ...goodDraft, acceptedMilestones: [] });
  assert.equal((await publication.readPublicProject(pool, projectId)).acceptedMilestones.length, 1, 'draft removal does not edit the live snapshot');
  const removed = await preview();
  await publication.mutateProjectPublication(pool, context, { ...publish, operationId: randomUUID(), expectedRevision: state.revision, previewHash: removed.previewHash });
  assert.equal((await publication.readPublicProject(pool, projectId)).acceptedMilestones.length, 0, 'confirmed removal withdraws selected summary');
  state = await publication.readProjectPublication(pool, context, base);
  await publication.mutateProjectPublication(pool, context, { ...base, action: 'revoke', operationId: randomUUID(), expectedRevision: state.revision });
  await assert.rejects(publication.readPublicProject(pool, projectId), { code: 'project_not_found' }, 'withdrawal blocks public accepted summaries');
  assert.equal((await publication.mutateProjectPublication(pool, context, publish)).replayed, true);
  await assert.rejects(publication.readPublicProject(pool, projectId), { code: 'project_not_found' }, 'old publication receipt cannot resurrect accepted summaries');
}

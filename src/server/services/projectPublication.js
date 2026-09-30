import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { normalizePublicationContent, publicationRecord, publicationId, publicationRevision,
  publicationVisibility, publicProjectPath } from '../config/projectPublicationContract.js';

export class ProjectPublicationError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new ProjectPublicationError(code, status); };
function actorOf(context, expected) {
  const actor = publicationId(context.actorUserId);
  if (actor !== publicationId(expected)) fail('actor_changed', 403);
  if (typeof context.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(context.clientId)) fail('invalid_client', 400);
  return { id: actor, clientId: context.clientId };
}
async function lockProject(db, actor, projectId) {
  const peek = (await db.query('SELECT workspace_id,owner_user_id FROM chat_projects WHERE id=$1', [projectId])).rows[0];
  if (!peek) fail('project_not_found', 404);
  if (peek.workspace_id) {
    await lockWorkspaceAuthority(db, peek.workspace_id);
    const ws = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [peek.workspace_id])).rows[0];
    if (ws?.status !== 'active') fail('project_not_found', 404);
  }
  const identities = [actor.id, peek.owner_user_id].filter(Boolean);
  await db.query(`SELECT id FROM users WHERE id=ANY($1::uuid[]) OR id IN
    (SELECT owner_user_id FROM agent_identities WHERE user_id=ANY($1::uuid[])) ORDER BY id FOR SHARE`, [identities]);
  await db.query('SELECT user_id FROM agent_identities WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE', [identities]);
  const principal = await resolvePrincipal(db, actor.id);
  // Publication discloses material to strangers. No implicit agent owner impersonation.
  if (!principal?.usable || principal.kind !== 'human') fail('publication_authority_required', 403);
  if (peek.owner_user_id) {
    const owner = await resolvePrincipal(db, peek.owner_user_id);
    if (!owner?.usable || owner.kind !== 'human') fail('project_not_found', 404);
  }
  const project = (await db.query(`SELECT id,workspace_id,owner_user_id,is_archived,
    extract(epoch FROM created_at)::text AS incarnation,extract(epoch FROM updated_at)::text AS version
    FROM chat_projects WHERE id=$1 FOR UPDATE`, [projectId])).rows[0];
  if (!project || project.workspace_id !== peek.workspace_id || project.owner_user_id !== peek.owner_user_id) fail('project_changed');
  await db.query(`SELECT object_id FROM relationship_tuples WHERE (object_type='project' AND object_id=$1)
    OR (object_type='workspace' AND object_id=$2) ORDER BY object_type,object_id,relation,subject_type,subject_id FOR SHARE`, [projectId, project.workspace_id]);
  const allowed = !project.is_archived && (await check(db, { object: `project:${projectId}`, relation: 'admin', subject: `user:${actor.id}` })).allowed;
  const user = (await db.query('SELECT extract(epoch FROM created_at)::text AS incarnation FROM users WHERE id=$1', [actor.id])).rows[0];
  return { project, principal, allowed, incarnation: operationHash({ project: project.incarnation, actor: user.incarnation }) };
}
const receiptKey = (actor, operationId) => [actor.id, actor.clientId, operationId];
const receiptWhere = 'actor_user_id=$1 AND client_id=$2 AND operation_id=$3';
async function stateOf(db, projectId) {
  return (await db.query('SELECT * FROM project_publications WHERE project_id=$1', [projectId])).rows[0]
    || { project_id: projectId, revision: '0', draft: null, visibility: 'private', published_revision: null };
}
function stateView(state) {
  return { projectId: state.project_id, revision: String(state.revision), draft: state.draft && normalizePublicationContent(state.draft),
    visibility: state.visibility, publishedRevision: state.published_revision === null ? null : String(state.published_revision), url: publicProjectPath(state.project_id) };
}
function previewOf(project, principal, state, visibility) {
  if (!state.draft || visibility === 'private') fail('draft_and_audience_required', 400);
  const projection = { projectId: project.id, ...normalizePublicationContent(state.draft),
    maintainer: { id: principal.id, handle: principal.handle, displayName: principal.displayName },
    url: publicProjectPath(project.id) };
  const previewHash = operationHash({ projection, revision: String(state.revision), projectVersion: project.version,
    owner: project.owner_user_id, workspace: project.workspace_id, visibility });
  return { projection, previewHash, revision: String(state.revision), visibility };
}
function readInput(value, keys = []) {
  const v = publicationRecord(value, ['projectId', 'expectedActorAccountId', ...keys]);
  return { ...v, projectId: publicationId(v.projectId) };
}
export async function readProjectPublication(pool, context, value) {
  const v = readInput(value), actor = actorOf(context, v.expectedActorAccountId);
  return authorityTransaction(pool, async db => {
    const authority = await lockProject(db, actor, v.projectId);
    if (!authority.allowed) fail('project_not_found', 404);
    return stateView(await stateOf(db, v.projectId));
  });
}
export async function previewProjectPublication(pool, context, value) {
  const v = readInput(value, ['visibility']), actor = actorOf(context, v.expectedActorAccountId), visibility = publicationVisibility(v.visibility);
  return authorityTransaction(pool, async db => {
    const authority = await lockProject(db, actor, v.projectId);
    if (!authority.allowed) fail('project_not_found', 404);
    return previewOf(authority.project, authority.principal, await stateOf(db, v.projectId), visibility);
  });
}
export async function readProjectPublicationOperation(pool, context, value) {
  const v = readInput(value, ['operationId']), actor = actorOf(context, v.expectedActorAccountId), operationId = publicationId(v.operationId);
  return authorityTransaction(pool, async db => {
    const authority = await lockProject(db, actor, v.projectId);
    const prior = (await db.query(`SELECT * FROM project_publication_operations WHERE ${receiptWhere}`, receiptKey(actor, operationId))).rows[0];
    if (!prior) return { state: 'not-observed', operation: null };
    if (prior.project_id !== v.projectId || prior.incarnation_hash !== authority.incarnation) fail('operation_identity_conflict');
    return { state: 'committed', operation: prior.receipt };
  });
}
export async function mutateProjectPublication(pool, context, value) {
  const v = readInput(value, ['operationId', 'action', 'expectedRevision', 'content', 'visibility', 'previewHash']);
  const actor = actorOf(context, v.expectedActorAccountId), operationId = publicationId(v.operationId);
  const expectedRevision = publicationRevision(v.expectedRevision);
  if (!['draft', 'publish', 'revoke'].includes(v.action)) fail('invalid_action', 400);
  const input = { projectId: v.projectId, operationId, expectedRevision, action: v.action };
  if (v.action === 'draft') {
    if (v.visibility !== undefined || v.previewHash !== undefined) fail('invalid_action_fields', 400);
    input.content = normalizePublicationContent(v.content);
  } else if (v.action === 'publish') {
    if (v.content !== undefined) fail('invalid_action_fields', 400);
    input.visibility = publicationVisibility(v.visibility);
    if (input.visibility === 'private' || typeof v.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.previewHash)) fail('invalid_preview', 400);
    input.previewHash = v.previewHash;
  } else if (v.content !== undefined || v.visibility !== undefined || v.previewHash !== undefined) fail('invalid_action_fields', 400);
  const requestHash = operationHash(input);
  return authorityTransaction(pool, async db => {
    const authority = await lockProject(db, actor, v.projectId);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`project-publication:${actor.id}:${actor.clientId}:${operationId}`]);
    const prior = (await db.query(`SELECT * FROM project_publication_operations WHERE ${receiptWhere}`, receiptKey(actor, operationId))).rows[0];
    if (prior) {
      if (prior.project_id !== v.projectId || prior.incarnation_hash !== authority.incarnation || prior.request_hash !== requestHash) fail('operation_identity_conflict');
      return { state: 'committed', operation: prior.receipt, replayed: true };
    }
    if (!authority.allowed) fail('project_not_found', 404);
    const current = await stateOf(db, v.projectId);
    if (String(current.revision) !== expectedRevision) fail('publication_revision_conflict');
    const revision = (BigInt(expectedRevision) + 1n).toString();
    await db.query('INSERT INTO project_publications(project_id) VALUES($1) ON CONFLICT DO NOTHING', [v.projectId]);
    if (v.action === 'draft') {
      await db.query('UPDATE project_publications SET draft=$2,revision=$3,updated_at=now() WHERE project_id=$1', [v.projectId, JSON.stringify(input.content), revision]);
    } else if (v.action === 'publish') {
      const preview = previewOf(authority.project, authority.principal, current, input.visibility);
      if (preview.previewHash !== input.previewHash) fail('preview_changed');
      await db.query(`INSERT INTO project_publication_versions(project_id,revision,projection,preview_hash,actor_user_id)
        VALUES($1,$2,$3,$4,$5)`, [v.projectId, revision, JSON.stringify(preview.projection), preview.previewHash, actor.id]);
      await db.query('UPDATE project_publications SET revision=$2,published_revision=$2,visibility=$3,updated_at=now() WHERE project_id=$1', [v.projectId, revision, input.visibility]);
    } else {
      await db.query("UPDATE project_publications SET revision=$2,visibility='private',updated_at=now() WHERE project_id=$1", [v.projectId, revision]);
    }
    const receipt = { schemaVersion: 1, operationId, projectId: v.projectId, action: v.action, revision,
      visibility: v.action === 'publish' ? input.visibility : v.action === 'revoke' ? 'private' : current.visibility };
    await db.query(`INSERT INTO project_publication_operations(actor_user_id,client_id,operation_id,project_id,request_hash,incarnation_hash,receipt)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [...receiptKey(actor, operationId), v.projectId, requestHash, authority.incarnation, JSON.stringify(receipt)]);
    return { state: 'committed', operation: receipt, replayed: false };
  });
}

// Single statement snapshot: visibility and project/owner liveness cannot be read
// from different commits. Neither a public version ID nor UUID bypasses revocation.
const publicFrom = `FROM project_publications p JOIN project_publication_versions v
  ON v.project_id=p.project_id AND v.revision=p.published_revision
  JOIN chat_projects c ON c.id=p.project_id AND NOT c.is_archived
  LEFT JOIN users u ON u.id=c.owner_user_id
  LEFT JOIN workspaces w ON w.id=c.workspace_id
  WHERE ((c.owner_user_id IS NOT NULL AND u.is_active=true AND u.status IS DISTINCT FROM 'suspended'
    AND u.role IS DISTINCT FROM 'service' AND NOT EXISTS(SELECT 1 FROM agent_identities a WHERE a.user_id=u.id))
    OR (c.workspace_id IS NOT NULL AND w.status='active'))`;
function publicView(row) {
  const value = row.projection;
  const content = normalizePublicationContent(Object.fromEntries(['schemaVersion', 'title', 'purpose', 'license', 'termsVersion', 'contributionGuide', 'roadmap', 'updates'].map(k => [k, value[k]])));
  return { projectId: row.project_id, revision: String(row.published_revision), visibility: row.visibility, ...content,
    maintainer: { id: publicationId(value.maintainer.id), handle: String(value.maintainer.handle), displayName: String(value.maintainer.displayName) }, url: publicProjectPath(row.project_id) };
}
export async function readPublicProject(db, id) {
  const projectId = publicationId(id);
  const row = (await db.query(`SELECT p.project_id,p.published_revision,p.visibility,v.projection ${publicFrom}
    AND p.project_id=$1 AND p.visibility IN ('public','unlisted')`, [projectId])).rows[0];
  if (!row) fail('project_not_found', 404);
  return publicView(row);
}
export async function discoverPublicProjects(db, { after = null, limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('invalid_limit', 400);
  const cursor = after === null ? null : publicationId(after);
  const rows = (await db.query(`SELECT p.project_id,p.published_revision,p.visibility,v.projection ${publicFrom}
    AND p.visibility='public' AND ($1::uuid IS NULL OR p.project_id>$1::uuid) ORDER BY p.project_id LIMIT $2`, [cursor, limit + 1])).rows;
  return { projects: rows.slice(0, limit).map(publicView), nextCursor: rows.length > limit ? rows[limit - 1].project_id : null };
}

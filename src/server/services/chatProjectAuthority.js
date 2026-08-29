import { check, writeTuples } from '../utils/authzReBAC.js';
import { UUID_RE } from '../utils/workspaceContext.js';

export class ChatAuthorizationError extends Error {
  constructor(message = 'Resource not found or access denied', code = 'resource_not_found') {
    super(message);
    this.name = 'ChatAuthorizationError';
    this.code = code;
    this.status = code === 'invalid_id' ? 400 : 404;
  }
}

export function userPrincipal(userId) {
  if (!UUID_RE.test(String(userId || ''))) throw new ChatAuthorizationError('User id must be a UUID', 'invalid_id');
  return { type: 'user', id: String(userId) };
}

export async function withTransaction(db, operation) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

export async function requireResourceRelation(db, principal, resourceType, resourceId, relation) {
  if (!UUID_RE.test(String(resourceId || ''))) {
    throw new ChatAuthorizationError(`${resourceType} id must be a UUID`, 'invalid_id');
  }
  const verdict = await check(db, {
    object: `${resourceType}:${resourceId}`,
    relation,
    subject: `${principal.type}:${principal.id}`,
  });
  if (!verdict.allowed) throw new ChatAuthorizationError();
  return verdict;
}

export async function createAuthorizedProject(db, {
  principal,
  workspaceId = null,
  name,
  description = null,
  customInstructions = null,
  settings = {},
}) {
  if (!String(name || '').trim()) throw Object.assign(new Error('Project name is required'), { code: 'invalid_project' });
  if (workspaceId && !UUID_RE.test(workspaceId)) throw new ChatAuthorizationError('Workspace id must be a UUID', 'invalid_id');

  return withTransaction(db, async (tx) => {
    if (workspaceId) await requireResourceRelation(tx, principal, 'workspace', workspaceId, 'editor');
    const { rows } = await tx.query(
      `INSERT INTO chat_projects (
         user_id, owner_user_id, workspace_id, created_by_user_id, updated_by_user_id,
         name, description, custom_instructions, settings
       ) VALUES (CASE WHEN $3::uuid IS NULL THEN $1::uuid ELSE NULL::uuid END, $2, $3, $1, $1, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        principal.id,
        workspaceId ? null : principal.id,
        workspaceId,
        String(name).trim(),
        description || null,
        customInstructions || null,
        JSON.stringify(settings || {}),
      ],
    );
    const project = rows[0];
    await writeTuples(tx, {
      writes: [{
        object: `project:${project.id}`,
        relation: workspaceId ? 'parent' : 'owner',
        subject: workspaceId ? `workspace:${workspaceId}` : `user:${principal.id}`,
      }],
    });
    if (workspaceId) {
      await tx.query(
        `INSERT INTO workspace_audit(workspace_id, actor_user_id, action, target, metadata)
         VALUES ($1, $2, 'chat_project_created', $3, $4::jsonb)`,
        [workspaceId, principal.id, `project:${project.id}`, JSON.stringify({ source: 'chat' })],
      );
    }
    return project;
  });
}

export async function linkAssetToProject(db, { principal, projectId, assetId }) {
  return withTransaction(db, async (tx) => {
    await requireResourceRelation(tx, principal, 'project', projectId, 'editor');
    await requireResourceRelation(tx, principal, 'library_asset', assetId, 'viewer');
    const project = (await tx.query(
      'SELECT id, owner_user_id, workspace_id FROM chat_projects WHERE id = $1 AND is_archived = FALSE FOR UPDATE',
      [projectId],
    )).rows[0];
    const asset = (await tx.query(
      `SELECT id, owner_user_id, workspace_id FROM user_files
       WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [assetId],
    )).rows[0];
    if (!project || !asset) throw new ChatAuthorizationError();
    if (project.owner_user_id && asset.owner_user_id !== project.owner_user_id) throw new ChatAuthorizationError();
    if (project.workspace_id && asset.workspace_id && asset.workspace_id !== project.workspace_id) throw new ChatAuthorizationError();

    const { rows } = await tx.query(
      `INSERT INTO chat_project_assets(project_id, asset_id, added_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT(project_id, asset_id) DO UPDATE SET retrieval_enabled = TRUE
       RETURNING *`,
      [projectId, assetId, principal.id],
    );
    await writeTuples(tx, {
      writes: [{ object: `library_asset:${assetId}`, relation: 'parent', subject: `project:${projectId}` }],
    });
    const semanticIndexExists = (await tx.query(
      "SELECT to_regclass('chat_project_chunk_embeddings') IS NOT NULL AS present",
    )).rows[0]?.present;
    if (semanticIndexExists) {
      await tx.query(
        `INSERT INTO chat_project_chunk_embeddings(project_id,chunk_id,asset_id,embedding_model_id,embedding)
         SELECT $1,c.id,c.asset_id,c.embedding_model_id,c.embedding
         FROM library_asset_chunks c
         JOIN library_asset_ingestions i ON i.id=c.ingestion_id AND i.state='ready' AND i.semantic_status='ready'
         WHERE c.asset_id=$2 AND c.embedding IS NOT NULL
         ON CONFLICT(project_id,chunk_id) DO UPDATE SET
           embedding=EXCLUDED.embedding, embedding_model_id=EXCLUDED.embedding_model_id, updated_at=NOW()`,
        [projectId, assetId],
      );
    }
    return rows[0];
  });
}

export async function unlinkAssetFromProject(db, { principal, projectId, assetId }) {
  return withTransaction(db, async (tx) => {
    await requireResourceRelation(tx, principal, 'project', projectId, 'editor');
    const removed = await tx.query(
      'DELETE FROM chat_project_assets WHERE project_id = $1 AND asset_id = $2 RETURNING id',
      [projectId, assetId],
    );
    if (!removed.rowCount) throw new ChatAuthorizationError();
    await writeTuples(tx, {
      deletes: [{ object: `library_asset:${assetId}`, relation: 'parent', subject: `project:${projectId}` }],
    });
    return removed.rows[0];
  });
}

export function sendChatAuthorityError(res, error) {
  if (!(error instanceof ChatAuthorizationError)) return false;
  res.status(error.status).json({ success: false, error: error.message, code: error.code });
  return true;
}

import { UUID_RE, isWorkspaceMember } from '../utils/workspaceContext.js';

/** An explicit workspace is a boundary, never a hint that may fall back to personal scope. */
export function requestedChatWorkspace(req) {
  const values = [req.headers?.['x-xeno-workspace'], req.query?.workspace_id, req.body?.workspace_id]
    .filter(value => value !== undefined);
  if (values.some(value => typeof value !== 'string' || !UUID_RE.test(value))) {
    throw Object.assign(new Error('Invalid workspace id'), { status: 400, code: 'invalid_workspace_id' });
  }
  const ids = values.map(value => value.toLowerCase());
  if (new Set(ids).size > 1) {
    throw Object.assign(new Error('Workspace context does not match the requested resource scope'), {
      status: 409, code: 'workspace_context_mismatch',
    });
  }
  return ids[0] || null;
}

export async function chatWorkspaceScope(req, res, next) {
  try {
    const workspaceId = requestedChatWorkspace(req);
    req.chatWorkspaceId = workspaceId;
    // Compatibility for existing non-workspace clients; resource authorization
    // still runs in each handler. Explicit workspace requests never use it.
    if (!workspaceId) return next();
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!(await isWorkspaceMember(req.db, workspaceId, req.user.id))) {
      return res.status(404).json({ success: false, error: 'Workspace not found', code: 'workspace_not_found' });
    }
    const projectPath = req.path.match(/^\/projects\/([^/]+)/)?.[1];
    const conversationPath = req.path.match(/^\/conversations\/([^/]+)/)?.[1];
    const references = [
      ...new Set([projectPath, req.body?.project_id, req.query?.project_id].filter(Boolean)),
    ].map(id => ['project', id]);
    for (const id of new Set([conversationPath, req.body?.conversation_id, req.query?.conversation_id].filter(Boolean))) {
      references.push(['conversation', id]);
    }
    for (const [kind, id] of references) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return res.status(400).json({ success: false, error: `Invalid ${kind} id`, code: 'invalid_reference_id' });
      }
      const result = kind === 'project'
        ? await req.db.query('SELECT id FROM chat_projects WHERE id=$1 AND workspace_id=$2', [id, workspaceId])
        : await req.db.query(`SELECT c.id FROM chat_conversations c
            LEFT JOIN chat_projects p ON p.id=c.project_id
            WHERE c.id=$1 AND COALESCE(p.workspace_id,c.workspace_id)=$2 AND c.deleted_at IS NULL`, [id, workspaceId]);
      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: 'Resource not found in active workspace', code: 'resource_not_found' });
      }
    }
    return next();
  } catch (error) {
    if (!error.status) console.error('[chatWorkspaceScope]', error.message);
    return res.status(error.status || 500).json({ success: false,
      error: error.status ? error.message : 'Workspace scope could not be verified',
      code: error.code || 'workspace_scope_unavailable' });
  }
}

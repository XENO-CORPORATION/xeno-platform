/**
 * A project at a glance — the backend for the workspace project page (Overview, Team, Activity).
 *
 *   people(db, me, projectId)            who is on it: people and agents, their role, and what the caller may manage
 *   summary(db, me, projectId)           task progress and the numbers the Overview shows
 *   activity(db, me, projectId, opts)    one feed: task changes and reports, conversations started, files added,
 *                                         people joining — newest first, paged by a time cursor
 *
 * Every call needs the caller to see the project (viewer). The feed never shows a conversation the caller cannot
 * open: conversations carry their own permissions, so each one is checked. Emails are shown only to project admins
 * (Linear, Jira and GitHub show members to everyone on a project; contact details to those who manage it).
 */
import { check } from '../utils/authzReBAC.js';

export class ProjectInsightError extends Error {
  constructor(message, code = 'invalid', status = 400) { super(message); this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK = { viewer: 1, client: 1, reviewer: 2, editor: 3, admin: 4, owner: 5 };
const allowed = async (db, userId, projectId, relation) => (await check(db, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed;

async function project(db, me, projectId) {
  if (!UUID.test(String(projectId || ''))) throw new ProjectInsightError('Project not found', 'project_not_found', 404);
  const p = (await db.query('SELECT id, name, area, owner_user_id, user_id, created_at, created_by_user_id FROM chat_projects WHERE id = $1', [projectId])).rows[0];
  if (!p || !(await allowed(db, me.id, projectId, 'viewer'))) throw new ProjectInsightError('Project not found', 'project_not_found', 404);
  return p;
}
const role = async (db, userId, projectId) => { for (const r of ['owner', 'admin', 'editor', 'reviewer', 'viewer']) if (await allowed(db, userId, projectId, r)) return r; return null; };

export async function people(db, me, projectId) {
  const p = await project(db, me, projectId);
  const admin = await allowed(db, me.id, projectId, 'admin');
  const rows = (await db.query(`
    SELECT u.id, u.username, COALESCE(u.display_name, u.username) AS name, u.email, u.avatar_url,
           ai.owner_user_id AS agent_owner, COALESCE(ou.display_name, ou.username) AS agent_owner_name,
           max(r.created_at) AS since,
           (array_agg(r.relation ORDER BY CASE r.relation WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'reviewer' THEN 2 ELSE 1 END DESC))[1] AS relation
      FROM relationship_tuples r
      JOIN users u ON u.id::text = r.subject_id
      LEFT JOIN agent_identities ai ON ai.user_id = u.id
      LEFT JOIN users ou ON ou.id = ai.owner_user_id
     WHERE r.object_type = 'project' AND r.object_id = $1 AND r.subject_type = 'user'
     GROUP BY u.id, u.username, u.display_name, u.email, u.avatar_url, ai.owner_user_id, ou.display_name, ou.username`, [String(projectId)])).rows;
  const ownerId = String(p.owner_user_id || p.user_id || '');
  const out = rows.map((r) => ({
    id: String(r.id), name: r.name || 'Someone', username: r.username || null, avatarUrl: r.avatar_url || null,
    kind: r.agent_owner ? 'agent' : 'human', ...(r.agent_owner ? { owner: { id: String(r.agent_owner), name: r.agent_owner_name } } : {}),
    relation: String(r.id) === ownerId ? 'owner' : r.relation, since: r.since, me: String(r.id) === String(me.id),
    ...(admin && !r.agent_owner && r.email ? { email: r.email } : {}),
  }));
  if (ownerId && !out.some((x) => x.id === ownerId)) {
    const o = (await db.query('SELECT id, username, COALESCE(display_name, username) AS name, email, avatar_url FROM users WHERE id = $1', [ownerId])).rows[0];
    if (o) out.push({ id: String(o.id), name: o.name, username: o.username, avatarUrl: o.avatar_url || null, kind: 'human', relation: 'owner', since: p.created_at, me: String(o.id) === String(me.id), ...(admin && o.email ? { email: o.email } : {}) });
  }
  // people first, then agents (Linear lists them apart); each by role, then name
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'human' ? -1 : 1) || (RANK[b.relation] || 0) - (RANK[a.relation] || 0) || a.name.localeCompare(b.name));
  return { project: { id: String(p.id), name: p.name }, people: out, you: { relation: await role(db, me.id, projectId), canManage: admin } };
}

export async function summary(db, me, projectId) {
  const p = await project(db, me, projectId);
  const t = (await db.query(`
    SELECT count(*) FILTER (WHERE status NOT IN ('done','wont_do'))::int AS open,
           count(*) FILTER (WHERE status = 'raised')::int AS triage,
           count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
           count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
           count(*) FILTER (WHERE status = 'in_review')::int AS in_review,
           count(*) FILTER (WHERE status = 'done')::int AS done,
           count(*) FILTER (WHERE status = 'wont_do')::int AS wont_do,
           count(*) FILTER (WHERE status = 'done' AND updated_at > now() - interval '7 days')::int AS done_week,
           count(*) FILTER (WHERE due_at < now() AND status NOT IN ('done','wont_do'))::int AS overdue,
           count(*) FILTER (WHERE assignee_id IS NULL AND delegate_id IS NULL AND status IN ('raised','todo'))::int AS unassigned,
           count(*) FILTER (WHERE delegate_id IS NOT NULL AND status NOT IN ('done','wont_do'))::int AS with_agents,
           count(*)::int AS total
      FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`, [projectId])).rows[0];
  const counts = (await db.query(`
    SELECT (SELECT count(*)::int FROM chat_conversations WHERE project_id = $1 AND deleted_at IS NULL) AS conversations,
           (SELECT count(*)::int FROM chat_project_files WHERE project_id = $1) AS files`, [projectId])).rows[0];
  const ppl = await people(db, me, projectId);
  const last = (await activity(db, me, projectId, { limit: 1 })).items[0] || null;
  const closed = t.done + t.wont_do;
  return {
    project: { id: String(p.id), name: p.name, area: p.area || null, createdAt: p.created_at },
    tasks: { ...t, progress: t.total ? Math.round((closed / t.total) * 100) : null },
    conversations: counts.conversations, files: counts.files,
    people: ppl.people.filter((x) => x.kind === 'human').length, agents: ppl.people.filter((x) => x.kind === 'agent').length,
    lastActivityAt: last ? last.at : null,
  };
}

const TASK_KINDS = ['created', 'status', 'assigned', 'claimed', 'delegated', 'comment', 'activity', 'attached', 'linked', 'parent', 'deleted', 'restored'];
export async function activity(db, me, projectId, { before, limit = 40 } = {}) {
  await project(db, me, projectId);
  const n = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const cut = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : new Date(Date.now() + 60000);
  const over = n + 1;   // one extra row tells whether there is another page
  const rows = (await db.query(`
    (SELECT 'task' AS src, e.id::text AS id, e.created_at AS at, e.actor_id, e.kind, e.field, e.from_value, e.to_value,
            CASE WHEN e.kind = 'comment' THEN left(e.note, 280) WHEN e.kind IN ('status','activity','attached') THEN left(e.note, 280) ELSE NULL END AS note,
            t.number AS task_number, t.title AS task_title, t.status AS task_status, NULL::text AS ref_id
       FROM task_events e JOIN tasks t ON t.id = e.task_id
      WHERE t.project_id = $1 AND e.created_at < $2 AND e.kind = ANY($4::text[]) AND e.removed_at IS NULL
        AND NOT (e.kind = 'activity' AND e.from_value IN ('thought', 'action'))
      ORDER BY e.created_at DESC LIMIT $3)
    UNION ALL
    (SELECT 'conversation', c.id::text, c.created_at, c.user_id, 'started', NULL, NULL, NULL, c.title, NULL, NULL, NULL, c.id::text
       FROM chat_conversations c WHERE c.project_id = $1 AND c.deleted_at IS NULL AND c.created_at < $2 ORDER BY c.created_at DESC LIMIT $3)
    UNION ALL
    (SELECT 'file', f.id::text, f.created_at, f.user_id, 'added', NULL, NULL, NULL, f.name, NULL, NULL, NULL, NULL
       FROM chat_project_files f WHERE f.project_id = $1 AND f.created_at < $2 ORDER BY f.created_at DESC LIMIT $3)
    UNION ALL
    (SELECT 'member', r.id::text, r.created_at, r.subject_id::uuid, 'joined', NULL, NULL, r.relation, NULL, NULL, NULL, NULL, NULL
       FROM relationship_tuples r WHERE r.object_type = 'project' AND r.object_id = $1::text AND r.subject_type = 'user' AND r.created_at < $2
        AND r.subject_id ~ '^[0-9a-f-]{36}$' ORDER BY r.created_at DESC LIMIT $3)
    ORDER BY at DESC LIMIT $3`, [projectId, cut, over * 2, TASK_KINDS])).rows;
  // people for the actors, and per-row visibility for conversations
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean).map(String))];
  const users = ids.length ? new Map((await db.query(`SELECT u.id, COALESCE(u.display_name, u.username) AS name, EXISTS (SELECT 1 FROM agent_identities a WHERE a.user_id = u.id) AS agent FROM users u WHERE u.id = ANY($1::uuid[])`, [ids])).rows.map((u) => [String(u.id), u])) : new Map();
  const items = [];
  for (const r of rows) {
    if (items.length >= over) break;
    if (r.src === 'conversation' && !(await check(db, { object: `conversation:${r.ref_id}`, relation: 'viewer', subject: `user:${me.id}` })).allowed) continue;
    const u = r.actor_id ? users.get(String(r.actor_id)) : null;
    items.push({
      id: `${r.src}:${r.id}`, type: r.src, kind: r.kind, at: r.at,
      actor: u ? { id: String(r.actor_id), name: u.name, kind: u.agent ? 'agent' : 'human' } : null,
      ...(r.src === 'task' ? { task: { key: `T-${r.task_number}`, title: r.task_title, status: r.task_status }, field: r.field || null, from: r.from_value, to: r.to_value } : {}),
      ...(r.src === 'member' ? { relation: r.to_value } : {}),
      ...(r.src === 'conversation' ? { conversation: { id: r.ref_id, title: r.note || 'Conversation' } } : {}),
      ...(r.src === 'file' ? { file: { name: r.note } } : {}),
      ...(r.src === 'task' && r.note ? { note: r.note } : {}),
    });
  }
  const more = items.length > n;
  const page = items.slice(0, n);
  return { items: page, next: more && page.length ? new Date(page[page.length - 1].at).toISOString() : null };
}

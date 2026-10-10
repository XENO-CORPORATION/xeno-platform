/**
 * XENO Tasks (codename Telos) — the shared work tracker for people and agents. Product spec: xeno-tasks/SPEC.md.
 *
 * WHO SEES A TASK
 *   in a project → whoever the project's relationship rows let view the project (the same check the project uses);
 *   with no project → its owner, its reporter and its assignee.
 *   Anyone else is told it does not exist (404).
 *
 * WHO MOVES IT (SPEC §3) — one state machine for everyone:
 *   raised → todo | in_progress | wont_do          triage: project editor (personal: the owner)
 *   todo ↔ in_progress ↔ blocked, → in_review      the assignee or an editor
 *   in_progress → done                             the assignee or an editor, only when no review is required
 *   in_review → done                               the reviewer or a project admin — never the assignee
 *   in_review → in_progress                        the reviewer or an editor (changes asked)
 *   done → todo, wont_do → raised (reopen)         an editor or the reporter
 *
 * Every change is a row in task_events. Agents are principals like people (actor_kind 'agent'): they may raise,
 * claim, move and comment, never accept their own work.
 */
import { check } from '../utils/authzReBAC.js';

export class TaskError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
export const STATUSES = ['raised', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'wont_do'];
export const KINDS = ['task', 'bug', 'feature', 'question'];
export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const SOURCES = ['manual', 'chat', 'forum_ticket', 'forum_thread', 'agent'];
const AREA = /^[a-z][a-z0-9_-]{0,39}$/, UUID = /^[0-9a-f-]{36}$/i;
const MOVES = {
  raised: ['todo', 'in_progress', 'wont_do'],
  todo: ['in_progress', 'blocked', 'wont_do', 'raised'],
  in_progress: ['blocked', 'in_review', 'todo', 'done', 'wont_do'],
  blocked: ['in_progress', 'todo', 'wont_do'],
  in_review: ['done', 'in_progress'],
  done: ['todo'],
  wont_do: ['raised'],
};
export const allowedMoves = (status) => MOVES[status] || [];
const kindOf = (p) => (p.kind === 'agent' ? 'agent' : p.kind === 'service' ? 'service' : 'human');
const text = (v, field, max, required = true) => { const s = String(v ?? '').trim(); if (required && !s) throw new TaskError(`${field} is required`, `${field}_required`); if (s.length > max) throw new TaskError(`${field} is longer than ${max} characters`, `${field}_too_long`); return s; };
const oneOf = (v, list, field, d) => { if (v == null || v === '') return d; if (!list.includes(v)) throw new TaskError(`Unknown ${field}`, `invalid_${field}`); return v; };
const keyToNumber = (key) => { const m = /^T-(\d{1,15})$/i.exec(String(key || '').trim()); return m ? m[1] : null; };

const rel = async (db, userId, projectId, relation) => (await check(db, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed;
/** What this caller may do to this task: { view, edit, admin } (edit = triage/move/assign; admin = accept in place of the reviewer). */
async function standing(db, me, t) {
  if (t.project_id) {
    const view = await rel(db, me.id, t.project_id, 'viewer');
    if (!view) return { view: false };
    const edit = await rel(db, me.id, t.project_id, 'editor'), admin = edit && await rel(db, me.id, t.project_id, 'admin');
    return { view, edit, admin };
  }
  const own = String(t.owner_user_id) === String(me.id);
  const involved = own || String(t.reporter_id) === String(me.id) || String(t.assignee_id) === String(me.id) || String(t.reviewer_id) === String(me.id);
  return { view: involved, edit: own, admin: own };
}

const SELECT = `SELECT t.*, COALESCE(t.area, (SELECT p.area FROM chat_projects p WHERE p.id = t.project_id)) AS effective_area,
  (SELECT p.name FROM chat_projects p WHERE p.id = t.project_id) AS project_name,
  COALESCE(ru.display_name, ru.username) AS reporter_name, COALESCE(au.display_name, au.username) AS assignee_name, COALESCE(vu.display_name, vu.username) AS reviewer_name,
  EXISTS (SELECT 1 FROM agent_identities ai WHERE ai.user_id = t.assignee_id) AS assignee_is_agent
  FROM tasks t LEFT JOIN users ru ON ru.id = t.reporter_id LEFT JOIN users au ON au.id = t.assignee_id LEFT JOIN users vu ON vu.id = t.reviewer_id`;
const person = (id, name, agent = false) => (id ? { id: String(id), name: name || 'Someone', kind: agent ? 'agent' : 'human' } : null);
function shape(t, s, events, files) {
  return {
    key: `T-${t.number}`, id: t.id, number: Number(t.number), title: t.title, body: t.body, kind: t.kind, status: t.status, priority: t.priority,
    project: t.project_id ? { id: t.project_id, name: t.project_name || 'Project' } : null, milestoneId: t.milestone_id || null, area: t.effective_area || null,
    reporter: person(t.reporter_id, t.reporter_name, t.reporter_kind === 'agent'), assignee: person(t.assignee_id, t.assignee_name, t.assignee_is_agent), reviewer: person(t.reviewer_id, t.reviewer_name),
    reviewRequired: t.review_required, labels: t.labels || [], dueAt: t.due_at, source: t.source, sourceRef: t.source_ref, conversationId: t.conversation_id,
    createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at,
    ...(s ? { can: { edit: !!s.edit, moves: s.moves || [], attach: !!s.attach, delete: !!s.del } } : {}),
    ...(files ? { attachments: files.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size_bytes, at: a.created_at, uploader: person(a.uploader_id, a.uploader_name) })) } : {}),
    ...(events ? { events: events.map((e) => ({ id: e.id, kind: e.kind, from: e.from_value, to: e.to_value, note: e.note, at: e.created_at, actor: person(e.actor_id, e.actor_name, e.actor_kind === 'agent') })) } : {}),
  };
}
async function loadByKey(db, key) { const n = keyToNumber(key); if (!n) return null; return (await db.query(`${SELECT} WHERE t.number = $1 AND t.deleted_at IS NULL`, [n])).rows[0] || null; }
async function readable(db, me, key) { const t = await loadByKey(db, key), s = t ? await standing(db, me, t) : null; if (!s || !s.view) throw new TaskError('Task not found', 'task_not_found', 404); return { t, s }; }
const event = (db, t, me, kind, from, to, note) => db.query('INSERT INTO task_events (task_id, actor_id, actor_kind, kind, from_value, to_value, note) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t.id, me.id, kindOf(me), kind, from ?? null, to ?? null, note ?? null]);
/** The moves this caller may make from the task's current status. */
function movesFor(me, t, s) {
  const mine = String(t.assignee_id) === String(me.id), reviewer = String(t.reviewer_id) === String(me.id), reporter = String(t.reporter_id) === String(me.id);
  return allowedMoves(t.status).filter((to) => {
    if (t.status === 'raised') return s.edit;
    if (t.status === 'in_review' && to === 'done') return !mine && (reviewer || s.admin);
    if (t.status === 'in_review') return reviewer || s.edit;
    if (to === 'done') return !t.review_required && (mine || s.edit);
    if (t.status === 'done' || t.status === 'wont_do') return s.edit || reporter;
    return mine || s.edit;
  });
}

async function assertAssignable(db, userId, projectId) {
  if (!UUID.test(String(userId))) throw new TaskError('That person was not found', 'assignee_not_found', 404);
  const u = (await db.query('SELECT id FROM users WHERE id = $1', [userId])).rows[0];
  if (!u) throw new TaskError('That person was not found', 'assignee_not_found', 404);
  if (projectId && !(await rel(db, userId, projectId, 'viewer'))) throw new TaskError('They cannot see this project. Share it with them first.', 'assignee_without_access', 409);
}

export async function createTask(db, me, input = {}) {
  const projectId = input.projectId || null;
  if (projectId) { if (!UUID.test(String(projectId)) || !(await rel(db, me.id, projectId, 'viewer'))) throw new TaskError('Project not found', 'project_not_found', 404); }
  const area = projectId ? null : (input.area == null || input.area === '' ? null : String(input.area));
  if (area && !AREA.test(area)) throw new TaskError('Unknown area', 'invalid_area');
  if (input.assigneeId) await assertAssignable(db, input.assigneeId, projectId);
  if (input.reviewerId) await assertAssignable(db, input.reviewerId, projectId);
  const review = !!input.reviewRequired;
  if (review && !input.reviewerId) throw new TaskError('Name a reviewer when review is required', 'reviewer_required');
  const labels = Array.isArray(input.labels) ? input.labels.map((l) => String(l).trim().toLowerCase()).filter(Boolean).slice(0, 20).map((l) => l.slice(0, 40)) : [];
  const due = input.dueAt ? new Date(input.dueAt) : null; if (due && Number.isNaN(due.getTime())) throw new TaskError('dueAt must be a date', 'invalid_due');
  const row = (await db.query(
    `INSERT INTO tasks (title, body, kind, priority, project_id, area, owner_user_id, reporter_id, reporter_kind, assignee_id, reviewer_id, review_required, labels, due_at, source, source_ref, conversation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [text(input.title, 'title', 300), text(input.body, 'body', 50000, false), oneOf(input.kind, KINDS, 'kind', 'task'), oneOf(input.priority, PRIORITIES, 'priority', 'none'), projectId, area,
     projectId ? null : me.id, me.id, kindOf(me), input.assigneeId || null, input.reviewerId || null, review, labels, due, oneOf(input.source, SOURCES, 'source', kindOf(me) === 'agent' ? 'agent' : 'manual'),
     input.sourceRef ? String(input.sourceRef).slice(0, 200) : null, input.conversationId && UUID.test(String(input.conversationId)) ? input.conversationId : null])).rows[0];
  await event(db, row, me, 'created', null, 'raised', null);
  if (input.assigneeId) await event(db, row, me, 'assigned', null, String(input.assigneeId), null);
  return getTask(db, me, `T-${row.number}`);
}

export async function getTask(db, me, key) {
  const { t, s } = await readable(db, me, key);
  const events = (await db.query(`SELECT e.*, COALESCE(u.display_name, u.username) AS actor_name FROM task_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.task_id = $1 ORDER BY e.created_at, e.id`, [t.id])).rows;
  const files = (await db.query(`SELECT a.id, a.filename, a.mime, a.size_bytes, a.created_at, a.uploader_id, COALESCE(u.display_name, u.username) AS uploader_name FROM task_attachments a LEFT JOIN users u ON u.id = a.uploader_id WHERE a.task_id = $1 ORDER BY a.created_at, a.id`, [t.id])).rows;
  return shape(t, { ...s, moves: movesFor(me, t, s), attach: mayAttach(me, t, s), del: mayDelete(me, t, s) }, events, files);
}

/** Tasks the caller can see. Filters: area (id | 'none'), projectId, status (one or a comma list), assignee ('me' | 'none' | id), q. */
export async function listTasks(db, me, f = {}) {
  const params = [me.id], where = [];
  // visible: in a project the caller can view, or personal and involving the caller
  where.push('t.deleted_at IS NULL');
  where.push(`(
    (t.project_id IS NULL AND (t.owner_user_id = $1 OR t.reporter_id = $1 OR t.assignee_id = $1 OR t.reviewer_id = $1))
    OR (t.project_id IS NOT NULL AND t.project_id::text IN (SELECT object_id FROM relationship_tuples WHERE object_type = 'project' AND subject_type = 'user' AND subject_id = $1::text)))`);
  const EFF = `COALESCE(t.area, (SELECT p.area FROM chat_projects p WHERE p.id = t.project_id))`;
  if (f.area === 'none') where.push(`${EFF} IS NULL`); else if (f.area) { if (!AREA.test(String(f.area))) throw new TaskError('Unknown area', 'invalid_area'); params.push(String(f.area)); where.push(`${EFF} = $${params.length}`); }
  if (f.projectId) { if (!UUID.test(String(f.projectId))) throw new TaskError('Project not found', 'project_not_found', 404); params.push(f.projectId); where.push(`t.project_id = $${params.length}`); }
  if (f.status) { const st = String(f.status).split(',').filter(Boolean); if (st.some((x) => !STATUSES.includes(x))) throw new TaskError('Unknown status', 'invalid_status'); params.push(st); where.push(`t.status = ANY($${params.length}::text[])`); }
  if (f.assignee === 'me') where.push('t.assignee_id = $1'); else if (f.assignee === 'none') where.push('t.assignee_id IS NULL'); else if (f.assignee) { if (!UUID.test(String(f.assignee))) throw new TaskError('Unknown assignee', 'invalid_assignee'); params.push(f.assignee); where.push(`t.assignee_id = $${params.length}`); }
  if (f.q && String(f.q).trim()) { params.push(`%${String(f.q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`); where.push(`(t.title ILIKE $${params.length} ESCAPE '\\' OR t.body ILIKE $${params.length} ESCAPE '\\')`); }
  const limit = Math.min(Math.max(parseInt(f.limit, 10) || 200, 1), 500);
  const rows = (await db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, t.updated_at DESC LIMIT ${limit}`, params)).rows;
  // a project row being present does not prove the caller may VIEW it (a relation like 'blocked' could exist): re-check
  // each row carries what the caller may do with it (moves, attach, delete), so a board's right-click menu offers
  // exactly what the server will accept; standing is computed once per project, not once per task
  const out = [], byProject = new Map();
  for (const t of rows) {
    let s;
    if (t.project_id) { if (!byProject.has(t.project_id)) byProject.set(t.project_id, await standing(db, me, t)); s = byProject.get(t.project_id); if (!s.view) continue; }
    else s = await standing(db, me, t);
    out.push(shape(t, { ...s, moves: movesFor(me, t, s), attach: mayAttach(me, t, s), del: mayDelete(me, t, s) }));
  }
  return out;
}

export async function updateTask(db, me, key, input = {}) {
  const { t, s } = await readable(db, me, key);
  const mine = String(t.assignee_id) === String(me.id);
  if (!s.edit && !mine) throw new TaskError('Only the assignee or someone who manages the project can change this task', 'not_allowed', 403);
  const set = [], vals = [], changes = [];
  const put = (col, val, label, from) => { vals.push(val); set.push(`${col} = $${vals.length}`); changes.push([label, from, val]); };
  if (input.title !== undefined) put('title', text(input.title, 'title', 300), 'title', t.title);
  if (input.body !== undefined) put('body', text(input.body, 'body', 50000, false), 'body', null);
  if (input.kind !== undefined) put('kind', oneOf(input.kind, KINDS, 'kind', t.kind), 'kind', t.kind);
  if (input.priority !== undefined) put('priority', oneOf(input.priority, PRIORITIES, 'priority', t.priority), 'priority', t.priority);
  if (input.labels !== undefined) put('labels', (Array.isArray(input.labels) ? input.labels : []).map((l) => String(l).trim().toLowerCase()).filter(Boolean).slice(0, 20), 'labels', null);
  if (input.dueAt !== undefined) { const d = input.dueAt ? new Date(input.dueAt) : null; if (d && Number.isNaN(d.getTime())) throw new TaskError('dueAt must be a date', 'invalid_due'); put('due_at', d, 'due', null); }
  if (input.area !== undefined) { if (t.project_id) throw new TaskError('A task in a project lives where its project lives', 'area_follows_project', 409); const a = input.area || null; if (a && !AREA.test(a)) throw new TaskError('Unknown area', 'invalid_area'); put('area', a, 'area', t.area); }
  // assigning someone else, and choosing the reviewer, are management acts
  if (input.assigneeId !== undefined) { if (!s.edit && !(input.assigneeId === null && mine)) throw new TaskError('Only someone who manages the project can assign this task', 'not_allowed', 403);
    if (input.assigneeId) await assertAssignable(db, input.assigneeId, t.project_id); put('assignee_id', input.assigneeId || null, 'assignee', t.assignee_id); }
  if (input.reviewerId !== undefined || input.reviewRequired !== undefined) { if (!s.edit) throw new TaskError('Only someone who manages the project can set the review', 'not_allowed', 403);
    const reviewer = input.reviewerId !== undefined ? input.reviewerId : t.reviewer_id, required = input.reviewRequired !== undefined ? !!input.reviewRequired : t.review_required;
    if (reviewer) await assertAssignable(db, reviewer, t.project_id); if (required && !reviewer) throw new TaskError('Name a reviewer when review is required', 'reviewer_required');
    put('reviewer_id', reviewer || null, 'reviewer', t.reviewer_id); put('review_required', required, 'review', String(t.review_required)); }
  if (!set.length) return getTask(db, me, key);
  vals.push(t.id);
  await db.query(`UPDATE tasks SET ${set.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  for (const [label, from, to] of changes) await event(db, t, me, label === 'assignee' ? 'assigned' : 'edited', label === 'assignee' ? (from ? String(from) : null) : label, label === 'assignee' ? (to ? String(to) : null) : null, null);
  return getTask(db, me, key);
}

export async function transitionTask(db, me, key, { to, note, from } = {}) {
  const { t, s } = await readable(db, me, key);
  // `from` is the status the caller's screen showed. If the task has moved since, the move is refused rather than
  // applied to a state the person never saw (optimistic concurrency, as Linear and Jira do with a version).
  if (from !== undefined && from !== null && from !== t.status) throw new TaskError('Someone moved this task first. Reload it and try again.', 'conflict', 409);
  if (!STATUSES.includes(to)) throw new TaskError('Unknown status', 'invalid_status');
  if (!allowedMoves(t.status).includes(to)) throw new TaskError(`A task cannot go from ${t.status} to ${to}`, 'invalid_transition', 409);
  if (!movesFor(me, t, s).includes(to)) {
    const why = t.status === 'in_review' && to === 'done' && String(t.assignee_id) === String(me.id) ? 'You cannot accept your own work. The reviewer does.'
      : to === 'done' && t.review_required ? 'This task needs review: move it to In review.' : 'You are not allowed to make that move on this task.';
    throw new TaskError(why, 'not_allowed', 403);
  }
  // the move only happens if nobody moved it first: a stale screen cannot overwrite a newer state
  const done = (await db.query(`UPDATE tasks SET status = $2, updated_at = now(), closed_at = CASE WHEN $2 IN ('done', 'wont_do') THEN now() ELSE NULL END WHERE id = $1 AND status = $3 RETURNING id`, [t.id, to, t.status])).rowCount;
  if (!done) throw new TaskError('Someone moved this task first. Reload it and try again.', 'conflict', 409);
  await event(db, t, me, 'status', t.status, to, note ? text(note, 'note', 20000, false) : null);
  return getTask(db, me, key);
}

/** Take an unassigned task. Atomic: if someone already holds it, nothing changes and the caller is told. */
export async function claimTask(db, me, key) {
  const { t } = await readable(db, me, key);
  if (['done', 'wont_do'].includes(t.status)) throw new TaskError('This task is closed', 'task_closed', 409);
  if (t.project_id && !(await rel(db, me.id, t.project_id, 'viewer'))) throw new TaskError('Task not found', 'task_not_found', 404);
  const ok = (await db.query('UPDATE tasks SET assignee_id = $2, updated_at = now() WHERE id = $1 AND assignee_id IS NULL RETURNING id', [t.id, me.id])).rowCount;
  if (!ok) throw new TaskError(String(t.assignee_id) === String(me.id) ? 'You already hold this task' : 'Someone already holds this task', 'already_claimed', 409);
  await event(db, t, me, 'claimed', null, String(me.id), null);
  return getTask(db, me, key);
}

export async function commentTask(db, me, key, { body } = {}) {
  const { t } = await readable(db, me, key);
  await event(db, t, me, 'comment', null, null, text(body, 'body', 20000));
  await db.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [t.id]);
  return getTask(db, me, key);
}

// ───────────────────────────── images, deleting, who can be assigned

const mine = (me, t, col) => String(t[col]) === String(me.id);
/** Anyone working on the task may add images to it: whoever manages it, the assignee, the reviewer, the reporter. */
const mayAttach = (me, t, s) => !!(s.edit || mine(me, t, 'assignee_id') || mine(me, t, 'reviewer_id') || mine(me, t, 'reporter_id'));
/** Deleting is for whoever owns the place the task lives (project admin, or the owner of a personal task), and for the
 *  reporter while it is still waiting in triage — a task raised by mistake can be withdrawn, accepted work cannot. */
const mayDelete = (me, t, s) => !!(s.admin || (mine(me, t, 'reporter_id') && t.status === 'raised'));
export const ATTACH_MAX_BYTES = 8 * 1024 * 1024, ATTACH_MAX_PER_TASK = 20;
/** The image type from the file's own first bytes. Anything else is refused: no SVG (it can carry script), no HTML. */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const BAD_NAME_CHARS = new Set('/\\:*?"<>|');
function cleanName(name, mime) {
  let s = '';
  for (const ch of String(name || '')) { const c = ch.codePointAt(0); s += c < 32 || c === 127 || BAD_NAME_CHARS.has(ch) ? ' ' : ch; }
  s = s.split(' ').filter(Boolean).join(' ').slice(0, 200);
  return s || 'image.' + mime.split('/')[1];
}

export async function addAttachment(db, me, key, { filename, data } = {}) {
  const { t, s } = await readable(db, me, key);
  if (!mayAttach(me, t, s)) throw new TaskError('Only the people working on this task can add images to it', 'not_allowed', 403);
  if (!Buffer.isBuffer(data) || !data.length) throw new TaskError('Send the image as the request body', 'image_required');
  if (data.length > ATTACH_MAX_BYTES) throw new TaskError('Images can be at most 8 MB', 'image_too_large', 413);
  const mime = sniffImage(data);
  if (!mime) throw new TaskError('Only PNG, JPEG, GIF and WebP images can be added', 'unsupported_image', 415);
  const name = cleanName(filename, mime);
  const ins = (await db.query(
    `INSERT INTO task_attachments (task_id, uploader_id, filename, mime, size_bytes, data)
     SELECT $1, $2, $3, $4, $5, $6 WHERE (SELECT count(*) FROM task_attachments WHERE task_id = $1) < $7 RETURNING id`,
    [t.id, me.id, name, mime, data.length, data, ATTACH_MAX_PER_TASK])).rows[0];
  if (!ins) throw new TaskError(`A task can hold at most ${ATTACH_MAX_PER_TASK} images`, 'too_many_images', 409);
  await event(db, t, me, 'attached', null, ins.id, name);
  await db.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [t.id]);
  return getTask(db, me, key);
}
export async function getAttachment(db, me, key, id) {
  const { t } = await readable(db, me, key);
  if (!UUID.test(String(id))) throw new TaskError('Image not found', 'image_not_found', 404);
  const a = (await db.query('SELECT filename, mime, size_bytes, data FROM task_attachments WHERE id = $1 AND task_id = $2', [id, t.id])).rows[0];
  if (!a) throw new TaskError('Image not found', 'image_not_found', 404);
  return a;
}
export async function removeAttachment(db, me, key, id) {
  const { t, s } = await readable(db, me, key);
  if (!UUID.test(String(id))) throw new TaskError('Image not found', 'image_not_found', 404);
  const a = (await db.query('SELECT id, uploader_id, filename FROM task_attachments WHERE id = $1 AND task_id = $2', [id, t.id])).rows[0];
  if (!a) throw new TaskError('Image not found', 'image_not_found', 404);
  if (!s.edit && String(a.uploader_id) !== String(me.id)) throw new TaskError('Only whoever added it, or someone who manages the project, can remove this image', 'not_allowed', 403);
  await db.query('DELETE FROM task_attachments WHERE id = $1', [a.id]);
  await event(db, t, me, 'detached', a.id, null, a.filename);
  await db.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [t.id]);
  return getTask(db, me, key);
}
export async function deleteTask(db, me, key) {
  const { t, s } = await readable(db, me, key);
  if (!mayDelete(me, t, s)) throw new TaskError(mine(me, t, 'reporter_id') ? 'Once a task has been accepted, only someone who manages the project can delete it' : 'Only someone who manages the project can delete this task', 'not_allowed', 403);
  const ok = (await db.query('UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [t.id])).rowCount;
  if (!ok) throw new TaskError('Task not found', 'task_not_found', 404);
  await event(db, t, me, 'deleted', t.status, null, null);
  return { key: `T-${t.number}`, deleted: true };
}
/** Who a task here can be assigned to: everyone the project is shared with (people and agents), or, for a personal
 *  task, the caller. The caller's own agents are always listed; one not yet on the project is marked needsShare. */
export async function listAssignees(db, me, { projectId } = {}) {
  const out = new Map();
  const add = (r, extra = {}) => { if (r && !out.has(String(r.id))) out.set(String(r.id), { id: String(r.id), name: r.name || 'Someone', kind: r.is_agent ? 'agent' : 'human', ...extra }); };
  const PERSON = `u.id, COALESCE(u.display_name, u.username) AS name, EXISTS (SELECT 1 FROM agent_identities ai WHERE ai.user_id = u.id) AS is_agent`;
  if (projectId) {
    if (!UUID.test(String(projectId)) || !(await rel(db, me.id, projectId, 'viewer'))) throw new TaskError('Project not found', 'project_not_found', 404);
    const rows = (await db.query(`SELECT DISTINCT ${PERSON} FROM relationship_tuples r JOIN users u ON u.id::text = r.subject_id
      WHERE r.object_type = 'project' AND r.object_id = $1 AND r.subject_type = 'user' ORDER BY 2`, [String(projectId)])).rows;
    for (const r of rows) if (await rel(db, r.id, projectId, 'viewer')) add(r);
  } else add((await db.query(`SELECT ${PERSON} FROM users u WHERE u.id = $1`, [me.id])).rows[0]);
  const agents = (await db.query(`SELECT ${PERSON} FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.owner_user_id = $1 ORDER BY 2`, [me.id])).rows;
  for (const a of agents) add(a, projectId && !out.has(String(a.id)) ? { needsShare: true } : {});
  return [...out.values()].map((p) => ({ ...p, me: p.id === String(me.id) }));
}

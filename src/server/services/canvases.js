/**
 * Canvases — an infinite board where tasks, notes, links and groups sit together (owner, 2026-10-15).
 * Table and reasoning: database/migrations/20261015230000-canvases.sql. Product: xeno-tasks/SPEC.md §4b.
 *
 * FORMAT: JSON Canvas 1.0 (jsoncanvas.org) — `{nodes, edges}`. Node types: text, link, group (the standard ones) and
 * `xeno-ref`, which POINTS at a record by stable id (`ref: {kind: 'task', id: 'T-12'}`) and stores only its place.
 * A ref node never stores a title or status: reading a canvas resolves every task ref live, as the reader, so a
 * task the reader may not see shows as hidden and a deleted one shows as missing — never as a stale copy.
 *
 * WHO: a project canvas follows the project (viewer reads, editor saves, admin or its creator deletes); a personal
 * canvas is its owner's. Agents act through the same rules — they are principals like people.
 *
 * WIRES BETWEEN TASKS: an edge between two task refs with `xeno.link` set ('blocks' | 'relates' | 'duplicates')
 * is a real task link. Saving creates it through Tasks' own addLink, so the same permission rules apply and the
 * link shows on both task pages. A plain edge is only a drawing.
 */
import { check } from '../utils/authzReBAC.js';
import * as tasks from './xenoTasks.js';
import { latestFor } from './storageVersions.js';

export class CanvasError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA = /^[a-z][a-z0-9_-]{0,39}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TASK_KEY = /^T-\d{1,15}$/;
const NODE_TYPES = new Set(['text', 'link', 'group', 'xeno-ref']);
const REF_KINDS = new Set(['task', 'file', 'chat']);
const COLORS = /^([1-6]|#[0-9a-fA-F]{6})$/;
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const ENDS = new Set(['none', 'arrow']);
const LINK_KINDS = new Set(['blocks', 'relates', 'duplicates']);
export const MAX_NODES = 2000, MAX_EDGES = 4000;
const notFound = () => new CanvasError('Canvas not found', 'canvas_not_found', 404);

const num = (v, field) => { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw new CanvasError(`Invalid ${field}`, 'invalid_content'); return Math.round(n * 100) / 100; };
const str = (v, max) => (v == null ? undefined : String(v).slice(0, max));

/** Validate and normalise JSON Canvas content. Unknown top-level node fields are dropped; this is a data contract. */
export function cleanContent(content) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.nodes) || !Array.isArray(content.edges)) throw new CanvasError('A canvas is {nodes: [], edges: []}', 'invalid_content');
  if (content.nodes.length > MAX_NODES) throw new CanvasError(`A canvas holds at most ${MAX_NODES} items`, 'too_many_nodes', 413);
  if (content.edges.length > MAX_EDGES) throw new CanvasError(`A canvas holds at most ${MAX_EDGES} connections`, 'too_many_edges', 413);
  const ids = new Set(), refs = new Set();
  const nodes = content.nodes.map((n) => {
    if (!n || typeof n !== 'object' || !ID.test(String(n.id)) || ids.has(String(n.id))) throw new CanvasError('Every item needs a unique id', 'invalid_content');
    if (!NODE_TYPES.has(n.type)) throw new CanvasError(`Unknown item type: ${String(n.type).slice(0, 20)}`, 'invalid_content');
    ids.add(String(n.id));
    const out = { id: String(n.id), type: n.type, x: num(n.x, 'x'), y: num(n.y, 'y'), width: Math.max(40, num(n.width, 'width')), height: Math.max(30, num(n.height, 'height')) };
    if (n.color != null) { if (!COLORS.test(String(n.color))) throw new CanvasError('Invalid colour', 'invalid_content'); out.color = String(n.color); }
    if (n.type === 'text') out.text = str(n.text, 20000) ?? '';
    if (n.type === 'link') { const u = String(n.url || ''); if (!/^https?:\/\//i.test(u) || u.length > 2000) throw new CanvasError('A link must be an http(s) address', 'invalid_content'); out.url = u; }
    if (n.type === 'group') out.label = str(n.label, 200) ?? '';
    if (n.type === 'xeno-ref') {
      const r = n.ref || {};
      if (!REF_KINDS.has(r.kind)) throw new CanvasError('Unknown reference kind', 'invalid_content');
      if (r.kind === 'task' && !TASK_KEY.test(String(r.id || '').toUpperCase())) throw new CanvasError('A task reference names a task key (T-12)', 'invalid_content');
      if ((r.kind === 'file' || r.kind === 'chat') && !UUID.test(String(r.id || ''))) throw new CanvasError(`A ${r.kind} reference names its id`, 'invalid_content');
      const key = r.kind === 'task' ? String(r.id).toUpperCase() : String(r.id).toLowerCase();
      if (refs.has(r.kind + ':' + key)) throw new CanvasError(`${r.kind === 'task' ? key : 'That ' + r.kind} is already on this canvas`, 'duplicate_ref', 409);
      refs.add(r.kind + ':' + key); out.ref = { kind: r.kind, id: key };
    }
    return out;
  });
  const eids = new Set();
  const edges = content.edges.map((e) => {
    if (!e || !ID.test(String(e.id)) || eids.has(String(e.id))) throw new CanvasError('Every connection needs a unique id', 'invalid_content');
    if (!ids.has(String(e.fromNode)) || !ids.has(String(e.toNode)) || e.fromNode === e.toNode) throw new CanvasError('A connection joins two different items on the canvas', 'invalid_content');
    eids.add(String(e.id));
    const out = { id: String(e.id), fromNode: String(e.fromNode), toNode: String(e.toNode) };
    for (const k of ['fromSide', 'toSide']) if (e[k] != null) { if (!SIDES.has(e[k])) throw new CanvasError('Invalid side', 'invalid_content'); out[k] = e[k]; }
    for (const k of ['fromEnd', 'toEnd']) if (e[k] != null) { if (!ENDS.has(e[k])) throw new CanvasError('Invalid end', 'invalid_content'); out[k] = e[k]; }
    if (e.label != null) out.label = str(e.label, 200);
    if (e.color != null) { if (!COLORS.test(String(e.color))) throw new CanvasError('Invalid colour', 'invalid_content'); out.color = String(e.color); }
    if (e.xeno && e.xeno.link != null) { if (!LINK_KINDS.has(e.xeno.link)) throw new CanvasError('Unknown link type', 'invalid_link'); out.xeno = { link: e.xeno.link }; }
    return out;
  });
  return { nodes, edges };
}

async function rel(db, userId, projectId, relation) {
  return (await check(db, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed;
}
async function standing(db, me, c) {
  if (!c.project_id) { const own = String(c.owner_user_id) === String(me.id); return { view: own, edit: own, del: own }; }
  const view = await rel(db, me.id, c.project_id, 'viewer'); if (!view) return { view: false };
  const edit = await rel(db, me.id, c.project_id, 'editor');
  const admin = edit && await rel(db, me.id, c.project_id, 'admin');
  return { view, edit, del: admin || String(c.owner_user_id) === String(me.id) };
}
async function load(db, me, id, need = 'view') {
  if (!UUID.test(String(id))) throw notFound();
  const c = (await db.query('SELECT c.*, p.name AS project_name FROM canvases c LEFT JOIN chat_projects p ON p.id = c.project_id WHERE c.id = $1 AND c.deleted_at IS NULL', [id])).rows[0];
  const s = c ? await standing(db, me, c) : null;
  if (!s || !s.view) throw notFound();
  if (need === 'edit' && !s.edit) throw new CanvasError('You can view this canvas but not change it', 'not_allowed', 403);
  if (need === 'del' && !s.del) throw new CanvasError('Only whoever made this canvas, or a project admin, can delete it', 'not_allowed', 403);
  return { c, s };
}
const summary = (c, s) => ({
  id: c.id, name: c.name, area: c.area || null, project: c.project_id ? { id: c.project_id, name: c.project_name || 'Project' } : null,
  revision: String(c.revision), items: Array.isArray(c.content?.nodes) ? c.content.nodes.length : 0,
  createdAt: c.created_at, updatedAt: c.updated_at, ...(s ? { can: { edit: !!s.edit, delete: !!s.del } } : {}),
});

/** A library file or a chat, read LIVE as this reader through the same relation check every screen uses. What the
 *  reader may not see, or what is gone, is `missing` — never its name. */
async function resolveFiles(db, me, ids) {
  const out = {};
  for (const id of ids) {
    // a card names the FILE: it shows the newest version, whichever of the file's ids the card was made with
    const rev = await latestFor(db, id);
    const can = (await check(db, { object: `library_asset:${rev}`, relation: 'viewer', subject: `user:${me.id}` })).allowed;
    const f = can ? (await db.query('SELECT id, file_id, original_name, mime_type, file_size FROM user_files WHERE id = $1 AND deleted_at IS NULL', [rev])).rows[0] : null;
    out[id] = f ? { id: String(f.file_id), version: String(f.id), name: f.original_name, type: f.mime_type, bytes: Number(f.file_size), url: `/workspace/library?sel=${f.id}` } : { id, missing: true };
  }
  return out;
}
async function resolveChats(db, me, ids) {
  const out = {};
  for (const id of ids) {
    const c = (await db.query('SELECT id, user_id, title, last_message_at, updated_at FROM chat_conversations WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
    const can = c && (String(c.user_id) === String(me.id) || (await check(db, { object: `conversation:${id}`, relation: 'viewer', subject: `user:${me.id}` })).allowed);
    out[id] = can ? { id: String(c.id), title: c.title, at: c.last_message_at || c.updated_at, url: `/workspace/apps/chat/${c.id}` } : { id, missing: true };
  }
  return out;
}
/** Resolve every task ref LIVE, as this reader. Unseen and deleted tasks are told apart from visible ones. */
async function resolveRefs(db, me, nodes) {
  const keys = nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === 'task').map((n) => n.ref.id);
  const out = {};
  for (const key of keys) {
    try {
      const t = await tasks.getTask(db, me, key);
      out[key] = { key: t.key, title: t.title, status: t.status, kind: t.kind, priority: t.priority, assignee: t.assignee, delegate: t.delegate, project: t.project, links: t.links || [] };
    } catch (e) { if (e instanceof tasks.TaskError && e.status === 404) out[key] = { key, missing: true }; else throw e; }
  }
  return out;
}

export async function listCanvases(db, me, { projectId, area } = {}) {
  const params = [me.id], where = ['c.deleted_at IS NULL'];
  if (projectId) { if (!UUID.test(String(projectId))) throw new CanvasError('Project not found', 'project_not_found', 404); params.push(projectId); where.push(`c.project_id = $${params.length}`); }
  if (area) { if (!AREA.test(String(area))) throw new CanvasError('Unknown area', 'invalid_area'); params.push(area); where.push(`COALESCE(c.area, p.area) = $${params.length}`); }
  where.push(`((c.project_id IS NULL AND c.owner_user_id = $1) OR (c.project_id IS NOT NULL AND c.project_id::text IN
    (SELECT object_id FROM relationship_tuples WHERE object_type = 'project' AND subject_type = 'user' AND subject_id = $1::text)))`);
  const rows = (await db.query(`SELECT c.*, p.name AS project_name FROM canvases c LEFT JOIN chat_projects p ON p.id = c.project_id WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 200`, params)).rows;
  const out = [];
  for (const c of rows) { const s = await standing(db, me, c); if (s.view) out.push(summary(c, s)); }
  return out;
}

export async function createCanvas(db, me, { name, projectId, area, content } = {}) {
  const nm = String(name ?? '').trim(); if (!nm) throw new CanvasError('A canvas needs a name', 'name_required'); if (nm.length > 120) throw new CanvasError('Name is longer than 120 characters', 'name_too_long');
  let pid = null, a = area ? String(area) : null;
  if (a && !AREA.test(a)) throw new CanvasError('Unknown area', 'invalid_area');
  if (projectId) {
    if (!UUID.test(String(projectId)) || !(await rel(db, me.id, projectId, 'viewer'))) throw new CanvasError('Project not found', 'project_not_found', 404);
    if (!(await rel(db, me.id, projectId, 'editor'))) throw new CanvasError('Only a project editor can add a canvas to it', 'not_allowed', 403);
    pid = projectId; a = null; // a project canvas takes the project's area
  }
  const body = cleanContent(content || { nodes: [], edges: [] });
  const c = (await db.query('INSERT INTO canvases (owner_user_id, project_id, area, name, content) VALUES ($1,$2,$3,$4,$5) RETURNING id', [me.id, pid, a, nm, body])).rows[0];
  return getCanvas(db, me, c.id);
}

export async function getCanvas(db, me, id) {
  const { c, s } = await load(db, me, id);
  const content = cleanContent(c.content);
  const of = (kind) => content.nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === kind).map((n) => n.ref.id);
  return { ...summary(c, s), content, records: { tasks: await resolveRefs(db, me, content.nodes), files: await resolveFiles(db, me, of('file')), chats: await resolveChats(db, me, of('chat')) } };
}

/**
 * Save the whole canvas. `revision` must be the one the screen loaded: a save over someone else's change is
 * refused with 409 rather than silently overwriting it. Edges marked as task links become real task links.
 */
export async function saveCanvas(db, me, id, { content, revision, name } = {}) {
  const { c } = await load(db, me, id, 'edit');
  if (revision == null || String(revision) !== String(c.revision)) throw new CanvasError('Someone changed this canvas since you opened it', 'canvas_changed', 409);
  const body = cleanContent(content);
  const nm = name == null ? c.name : String(name).trim();
  if (!nm || nm.length > 120) throw new CanvasError('A canvas needs a name of at most 120 characters', 'invalid_name');
  // a wire marked as a task link is a real link: create the ones that are new, through Tasks' own rules
  const byId = new Map(body.nodes.map((n) => [n.id, n]));
  const before = new Set(cleanContent(c.content).edges.filter((e) => e.xeno?.link).map((e) => `${e.fromNode}>${e.toNode}>${e.xeno.link}`));
  for (const e of body.edges) {
    if (!e.xeno?.link || before.has(`${e.fromNode}>${e.toNode}>${e.xeno.link}`)) continue;
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (a?.type !== 'xeno-ref' || b?.type !== 'xeno-ref' || a.ref.kind !== 'task' || b.ref.kind !== 'task') throw new CanvasError('Only a connection between two tasks can be a task link', 'invalid_link');
    try { await tasks.addLink(db, me, a.ref.id, { kind: e.xeno.link, to: b.ref.id }); }
    catch (err) { if (err instanceof tasks.TaskError) throw new CanvasError(`${a.ref.id} → ${b.ref.id}: ${err.message}`, err.code, err.status); throw err; }
  }
  const r = await db.query('UPDATE canvases SET content = $3, name = $4, revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $2 RETURNING id', [c.id, c.revision, body, nm]);
  if (!r.rowCount) throw new CanvasError('Someone changed this canvas since you opened it', 'canvas_changed', 409);
  return getCanvas(db, me, c.id);
}

export async function deleteCanvas(db, me, id) {
  const { c } = await load(db, me, id, 'del');
  await db.query('UPDATE canvases SET deleted_at = now() WHERE id = $1', [c.id]);
  return { deleted: c.id };
}

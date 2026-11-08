/**
 * Who is on a document, a chat or a picture in a project — the person responsible for it there.
 * Decision: docs/decisions/2026-11-08-who-is-on-a-project-item.md (owner, 2026-11-08: "we shoudl build hte proep think
 * starting now"). Table: migrations/20261124090000-project-item-people.sql.
 *
 * A task keeps its own assignee (xenoTasks.js); this is the same idea for the project's other items, so the canvas, the
 * item's own pages and agents all read one answer instead of a person drawn on one canvas.
 *
 *   ONE SERVICE: the route (/api/projects/:id/items/…), XENO MCP (projects_* tools) and the canvas (records resolved per
 *   reader in services/canvases.js) all call these functions. Nothing else writes the table.
 *
 *   RULES, from tasks: only a project EDITOR sets it; the person must already see the project ("share it with them
 *   first"); an agent may be the person and is shown as an agent; the item must be IN the project. Reading needs project
 *   viewer. Setting replaces the live person (the canvas corner holds one); the old row is ended, never deleted.
 *
 *   A PICTURE keeps its person when its generation finishes: while it runs the person is on the generation, and a file a
 *   generation made also answers with the generation's person (media_generation_outputs), so nothing has to be carried.
 *
 *   GATE: PROJECT_ITEM_PEOPLE=true turns it on. Anything else (unset, a typo) is off: reads say `enabled: false`, writes are
 *   refused, and the canvas keeps today's person drawn on the node. Fails closed.
 */
import { check } from '../utils/authzReBAC.js';
import * as inbox from './inbox.js';

export class ItemPeopleError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'ItemPeopleError'; this.code = code; this.status = status; }
}
export const KINDS = Object.freeze(['file', 'chat', 'generation']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const enabled = () => process.env.PROJECT_ITEM_PEOPLE === 'true';
const lower = (v) => String(v || '').toLowerCase();
const rel = async (db, userId, projectId, relation) => (await check(db, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed;

function gate() { if (!enabled()) throw new ItemPeopleError('People on project items are not turned on here yet', 'not_enabled', 404); }
function ids(projectId, kind, itemId) {
  if (!UUID.test(String(projectId))) throw new ItemPeopleError('Project not found', 'project_not_found', 404);
  if (!KINDS.includes(kind)) throw new ItemPeopleError('An item is a file, a chat or a generation', 'invalid_kind');
  if (!UUID.test(String(itemId))) throw new ItemPeopleError(`A ${kind} is named by its id`, 'invalid_item');
  return { projectId: lower(projectId), kind, itemId: lower(itemId) };
}
async function mustView(db, me, projectId) { if (!(await rel(db, me.id, projectId, 'viewer'))) throw new ItemPeopleError('Project not found', 'project_not_found', 404); }

/** The item as this table names it (a file by its stable file id, whichever version was given), or null when it is not in the project. */
export async function itemInProject(db, projectId, kind, itemId) {
  if (kind === 'chat') return (await db.query('SELECT 1 FROM chat_conversations WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL', [itemId, projectId])).rowCount ? itemId : null;
  if (kind === 'generation') return (await db.query('SELECT 1 FROM media_generations WHERE id = $1 AND project_id = $2', [itemId, projectId])).rowCount ? itemId : null;
  const f = (await db.query('SELECT COALESCE(file_id, id) AS fid FROM user_files WHERE (id = $1 OR file_id = $1) AND deleted_at IS NULL LIMIT 1', [itemId])).rows[0];
  if (!f) return null;
  const fid = String(f.fid);
  // in the project: one of its versions is in the project's folders, or attached to the project (the two ways a file joins one)
  const inIt = (await db.query(`WITH RECURSIVE tree AS (SELECT folder_id AS id, 0 AS depth FROM project_folders WHERE app = 'projects' AND project_id = $1
      UNION ALL SELECT c.id, t.depth + 1 FROM storage_folders c JOIN tree t ON c.parent_id = t.id WHERE t.depth < 64)
    SELECT 1 FROM user_files v WHERE COALESCE(v.file_id, v.id) = $2 AND v.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM storage_item_folders i JOIN tree ON tree.id = i.folder_id WHERE i.source = 'file' AND i.source_id = v.id)
      OR EXISTS (SELECT 1 FROM chat_project_assets a WHERE a.project_id = $1 AND a.asset_id = v.id)
      OR EXISTS (SELECT 1 FROM media_generation_outputs o JOIN media_generations g ON g.id = o.generation_id WHERE o.asset_id = v.id AND g.project_id = $1))
    LIMIT 1`, [projectId, fid])).rowCount;
  return inIt ? fid : null;
}

/** For a file, the generations that made any of its versions: their person is the file's person too. */
async function generationsOf(db, fileIds) {
  if (!fileIds.length) return new Map();
  const rows = (await db.query(`SELECT COALESCE(v.file_id, v.id) AS fid, o.generation_id AS gid FROM media_generation_outputs o JOIN user_files v ON v.id = o.asset_id
    WHERE COALESCE(v.file_id, v.id) = ANY($1::uuid[])`, [fileIds])).rows;
  const out = new Map(); for (const r of rows) { const k = String(r.fid); out.set(k, [...(out.get(k) || []), String(r.gid)]); }
  return out;
}
const personOf = (r) => ({ id: String(r.principal_id), name: r.display_name || r.username || 'Someone', kind: r.agent ? 'agent' : 'human', assignedAt: r.assigned_at });
async function liveRows(db, projectId, keys) {
  if (!keys.length) return [];
  return (await db.query(`SELECT p.item_kind, p.item_id, p.principal_id, p.assigned_at, u.display_name, u.username, (a.user_id IS NOT NULL) AS agent
      FROM project_item_people p JOIN users u ON u.id = p.principal_id LEFT JOIN agent_identities a ON a.user_id = p.principal_id
     WHERE p.project_id = $1 AND p.ended_at IS NULL AND (p.item_kind || ':' || p.item_id::text) = ANY($2::text[]) ORDER BY p.assigned_at`, [projectId, keys])).rows;
}

/**
 * The people on many items of one project, read as `me` (project viewer). refs: [{kind, id}]. Returns
 * { enabled, people: { '<kind>:<id>': [person…] } } — ids as given, lowercased. Off: { enabled: false, people: {} }.
 */
export async function peopleOn(db, me, projectId, refs) {
  if (!enabled()) return { enabled: false, people: {} };
  if (!UUID.test(String(projectId))) return { enabled: true, people: {} };
  const pid = lower(projectId);
  if (!(await rel(db, me.id, pid, 'viewer'))) return { enabled: true, people: {} };
  const asked = [...new Map((refs || []).filter((r) => KINDS.includes(r.kind) && UUID.test(String(r.id))).map((r) => [`${r.kind}:${lower(r.id)}`, { kind: r.kind, id: lower(r.id) }])).values()];
  // a file is asked for by any version: name it by its stable id; a generation's person answers for what it made
  const files = asked.filter((r) => r.kind === 'file');
  const stable = new Map(files.length ? (await db.query('SELECT id, COALESCE(file_id, id) AS fid FROM user_files WHERE id = ANY($1::uuid[]) OR file_id = ANY($1::uuid[])', [files.map((r) => r.id)])).rows.flatMap((r) => [[String(r.id), String(r.fid)], [String(r.fid), String(r.fid)]]) : []);
  const gens = await generationsOf(db, [...new Set(files.map((r) => stable.get(r.id)).filter(Boolean))]);
  const keysFor = (r) => (r.kind !== 'file' ? [`${r.kind}:${r.id}`] : [`file:${stable.get(r.id) || r.id}`, ...(gens.get(stable.get(r.id)) || []).map((g) => `generation:${g}`)]);
  const rows = await liveRows(db, pid, [...new Set(asked.flatMap(keysFor))]);
  const byKey = new Map(); for (const r of rows) { const k = `${r.item_kind}:${r.item_id}`; byKey.set(k, [...(byKey.get(k) || []), r]); }
  const people = {};
  for (const r of asked) {
    const seen = new Set(), list = [];
    // the item's own row first; a generation's only when the file has none of its own
    const own = byKey.get(keysFor(r)[0]) || [], inherited = keysFor(r).slice(1).flatMap((k) => byKey.get(k) || []);
    for (const row of (own.length ? own : inherited)) if (!seen.has(String(row.principal_id))) { seen.add(String(row.principal_id)); list.push(personOf(row)); }
    people[`${r.kind}:${r.id}`] = list;
  }
  return { enabled: true, people };
}

/**
 * Set the person on an item (one live person: whoever was on it is ended), or clear it with principalId null.
 * Returns { item: {kind, id}, people: [person…] }.
 */
export async function setPerson(db, me, { projectId, kind, itemId, principalId } = {}) {
  gate();
  const k = ids(projectId, kind, itemId);
  await mustView(db, me, k.projectId);
  if (!(await rel(db, me.id, k.projectId, 'editor'))) throw new ItemPeopleError('Only a project editor can say who is on it', 'not_allowed', 403);
  const item = await itemInProject(db, k.projectId, k.kind, k.itemId);
  if (!item) throw new ItemPeopleError(`That ${k.kind} is not in this project`, 'item_not_in_project', 404);
  let who = null;
  if (principalId != null && principalId !== '') {
    if (!UUID.test(String(principalId))) throw new ItemPeopleError('That person was not found', 'person_not_found', 404);
    who = (await db.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [principalId])).rows[0];
    if (!who) throw new ItemPeopleError('That person was not found', 'person_not_found', 404);
    if (!(await rel(db, principalId, k.projectId, 'viewer'))) throw new ItemPeopleError('They cannot see this project. Share it with them first.', 'person_without_access', 409);
  }
  // a file's generation may have carried the person until now: the file's own row takes over, the generation's ends
  const keys = [`${k.kind}:${item}`];
  if (k.kind === 'file') for (const g of (await generationsOf(db, [item])).get(item) || []) keys.push(`generation:${g}`);
  const c = await db.connect();
  let changed = false;
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project-item-people:${k.projectId}:${k.kind}:${item}`]);
    const live = (await c.query(`SELECT id, principal_id, item_kind FROM project_item_people WHERE project_id = $1 AND ended_at IS NULL AND (item_kind || ':' || item_id::text) = ANY($2::text[]) FOR UPDATE`, [k.projectId, keys])).rows;
    const stays = who ? live.find((r) => r.item_kind === k.kind && String(r.principal_id) === String(who.id)) : null;
    const end = live.filter((r) => r !== stays).map((r) => r.id);
    if (end.length) { await c.query('UPDATE project_item_people SET ended_at = now(), ended_by = $2 WHERE id = ANY($1::uuid[])', [end, me.id]); changed = true; }
    if (who && !stays) { await c.query('INSERT INTO project_item_people (project_id, item_kind, item_id, principal_id, assigned_by) VALUES ($1,$2,$3,$4,$5)', [k.projectId, k.kind, item, who.id, me.id]); changed = true; }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  if (who && changed) {
    const what = { file: 'a file', chat: 'a chat', generation: 'a picture' }[k.kind];
    await inbox.tell(db, { userId: who.id, source: 'projects', kind: 'item_assigned', ref: `${k.kind}:${item}`, title: `You're on ${what} in a project`, detail: '', actorId: me.id, actorKind: me.kind === 'agent' ? 'agent' : 'human', dedupeKey: `item-person:${k.projectId}:${k.kind}:${item}:${who.id}:${Date.now()}` });
  }
  const now = await peopleOn(db, me, k.projectId, [{ kind: k.kind, id: item }]);
  return { item: { kind: k.kind, id: item }, people: now.people[`${k.kind}:${item}`] || [] };
}

/** The live people on one item, and who was on it before (newest first). */
export async function itemPeople(db, me, { projectId, kind, itemId } = {}) {
  gate();
  const k = ids(projectId, kind, itemId);
  await mustView(db, me, k.projectId);
  const item = await itemInProject(db, k.projectId, k.kind, k.itemId);
  if (!item) throw new ItemPeopleError(`That ${k.kind} is not in this project`, 'item_not_in_project', 404);
  const now = await peopleOn(db, me, k.projectId, [{ kind: k.kind, id: item }]);
  const before = (await db.query(`SELECT p.principal_id, p.assigned_at, p.ended_at, u.display_name, u.username, (a.user_id IS NOT NULL) AS agent FROM project_item_people p JOIN users u ON u.id = p.principal_id
    LEFT JOIN agent_identities a ON a.user_id = p.principal_id WHERE p.project_id = $1 AND p.item_kind = $2 AND p.item_id = $3 AND p.ended_at IS NOT NULL ORDER BY p.ended_at DESC LIMIT 20`, [k.projectId, k.kind, item])).rows;
  return { item: { kind: k.kind, id: item }, people: now.people[`${k.kind}:${item}`] || [], before: before.map((r) => ({ ...personOf(r), endedAt: r.ended_at })) };
}

/** How many items each person is on in a project ({ principalId: { file, chat, generation } }), for Projects › Team assignments.
 *  Counts, not names: a reader of the team list may not be able to open every item. Off: {}. */
export async function countsByPerson(db, me, projectId) {
  if (!enabled() || !UUID.test(String(projectId)) || !(await rel(db, me.id, lower(projectId), 'viewer'))) return {};
  const out = {};
  for (const r of (await db.query('SELECT principal_id, item_kind, count(*)::int AS n FROM project_item_people WHERE project_id = $1 AND ended_at IS NULL GROUP BY 1, 2', [lower(projectId)])).rows) {
    const k = String(r.principal_id); out[k] = { file: 0, chat: 0, generation: 0, ...(out[k] || {}), [r.item_kind]: r.n };
  }
  return out;
}
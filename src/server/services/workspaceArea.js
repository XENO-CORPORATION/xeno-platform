/**
 * Two reads across everything a person has in the XENO workspace, each aware of the AREA an item lives in
 * (database/migrations/20261009200000-resource-area.sql: each area has its own work; Overview shows all).
 *
 *   searchWorkspace   one search over conversations (their titles and what was said in them), chat projects
 *                     and Library items. `area` narrows it to one area, or to the items in none.
 *   listPins          what the person pinned: conversations, chat projects, and the Library items they starred.
 *   summarizeWeek     the person's last seven days, per area: chats started, messages sent, scheduled runs done.
 *   listNeedsYou      what is waiting on the person: today, scheduled chats whose last run failed. It is a
 *                     feed of FACTS the platform holds; nothing is invented to fill it.
 *
 * Authority is the same as the lists these items already appear in: a conversation, project or schedule is
 * returned only if the relationship check says the caller may view it; Library items come from
 * listLibraryItems, which applies its own. A search never tells a caller that something they cannot see exists.
 */
import { check } from '../utils/authzReBAC.js';
import { listLibraryItems } from './libraryAssets.js';
import { EFFECTIVE_CONVERSATION_AREA } from '../utils/resourceArea.js';
import { listTasks } from './xenoTasks.js';

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 200;
const CANDIDATES = 80;   // read at most this many rows per kind before the authority check trims them
const PER_KIND = 12;

/** A person's text made safe for ILIKE: the three characters LIKE treats specially are escaped. */
export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** About 160 characters around the first place `needle` appears in `text`, on one line. */
export function snippetAround(text, needle, width = 160) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const at = flat.toLowerCase().indexOf(String(needle).toLowerCase());
  if (at < 0) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  const start = Math.max(0, at - Math.floor((width - needle.length) / 2));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

const areaClause = (expr, filter, params) => {
  if (!filter.filter) return '';
  if (filter.area === null) return ` AND (${expr}) IS NULL`;
  params.push(filter.area);
  return ` AND (${expr}) = $${params.length}`;
};

const viewable = async (db, kind, id, userId) => (await check(db, { object: `${kind}:${id}`, relation: 'viewer', subject: `user:${userId}` })).allowed;

export async function searchWorkspace(db, userId, { query, areaFilter = { filter: false, area: null }, limit = PER_KIND } = {}) {
  const q = String(query || '').trim().slice(0, SEARCH_MAX);
  if (q.length < SEARCH_MIN) return { query: q, results: [], counts: { chat: 0, project: 0, file: 0 } };
  const per = Math.min(Math.max(parseInt(limit, 10) || PER_KIND, 1), 30);
  const pattern = likePattern(q);

  // conversations: by title, or by what was said in one. The newest message that matches gives the snippet.
  const cParams = [pattern];
  const cSql = `
    SELECT c.id, c.title, c.project_id, c.updated_at, c.last_message_at, ${EFFECTIVE_CONVERSATION_AREA} AS area,
      (c.title ILIKE $1 ESCAPE '\\') AS title_hit,
      (SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id AND m.content ILIKE $1 ESCAPE '\\'
        ORDER BY m.created_at DESC LIMIT 1) AS said
    FROM chat_conversations c
    WHERE c.deleted_at IS NULL AND c.is_archived = FALSE
      AND (c.title ILIKE $1 ESCAPE '\\' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.content ILIKE $1 ESCAPE '\\'))
      ${areaClause(EFFECTIVE_CONVERSATION_AREA, areaFilter, cParams)}
    ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC NULLS LAST LIMIT ${CANDIDATES}`;
  const chats = [];
  for (const row of (await db.query(cSql, cParams)).rows) {
    if (chats.length >= per) break;
    if (!(await viewable(db, 'conversation', row.id, userId))) continue;
    chats.push({ kind: 'chat', id: row.id, title: String(row.title || '').trim() || 'New chat', snippet: row.said ? snippetAround(row.said, q) : '',
      matched: row.title_hit ? 'title' : 'message', area: row.area || null, project_id: row.project_id || null, at: row.last_message_at || row.updated_at });
  }

  const pParams = [pattern];
  const pSql = `
    SELECT p.id, p.name, p.description, p.area, p.updated_at
    FROM chat_projects p
    WHERE p.is_archived = FALSE AND (p.name ILIKE $1 ESCAPE '\\' OR p.description ILIKE $1 ESCAPE '\\')
      ${areaClause('p.area', areaFilter, pParams)}
    ORDER BY p.updated_at DESC LIMIT ${CANDIDATES}`;
  const projects = [];
  for (const row of (await db.query(pSql, pParams)).rows) {
    if (projects.length >= per) break;
    if (!(await viewable(db, 'project', row.id, userId))) continue;
    projects.push({ kind: 'project', id: row.id, title: String(row.name || 'Project'), snippet: row.description ? snippetAround(row.description, q, 120) : '',
      matched: 'name', area: row.area || null, at: row.updated_at });
  }

  const library = await listLibraryItems(db, userId, { query: q, limit: per, view: 'active', ...(areaFilter.filter ? { area: areaFilter.area === null ? 'none' : areaFilter.area } : {}) });
  const files = library.items.map((it) => ({ kind: 'file', id: it.id, title: String(it.name || 'Untitled'), snippet: '', matched: 'name', area: it.area || null,
    at: it.updated_at || it.created_at, source: it.source, source_id: it.source_id, asset_id: it.asset_id || null, mime_type: it.mime_type || '' }));

  let taskHits = [];
  try {
    const byKey = /^t-\d+$/i.test(q) ? q.toUpperCase() : null;
    const found = await listTasks(db, { id: userId, kind: 'human' }, { q: byKey ? undefined : q, limit: per * 3, ...(areaFilter.filter ? { area: areaFilter.area === null ? 'none' : areaFilter.area } : {}) });
    taskHits = (byKey ? found.filter((t) => t.key === byKey) : found).slice(0, per).map((t) => ({ kind: 'task', id: t.key, title: `${t.key} · ${t.title}`, snippet: '', matched: 'title', area: t.area, at: t.updatedAt, status: t.status }));
  } catch { taskHits = []; }
  return { query: q, results: [...chats, ...projects, ...taskHits, ...files], counts: { chat: chats.length, project: projects.length, task: taskHits.length, file: files.length } };
}

/**
 * Everything the person pinned, in one list: pinned conversations and chat projects in the order they were
 * pinned, then starred Library items. `area` narrows it. A pin on something the caller can no longer see is
 * left out (the pin row stays: access may come back).
 */
export async function listPins(db, userId, { areaFilter = { filter: false, area: null } } = {}) {
  const cParams = [userId];
  const cSql = `SELECT c.id, c.title, c.project_id, COALESCE(c.last_message_at, c.updated_at) AS at, ${EFFECTIVE_CONVERSATION_AREA} AS area
    FROM chat_conversation_pins pin JOIN chat_conversations c ON c.id = pin.conversation_id
    WHERE pin.user_id = $1 AND c.deleted_at IS NULL AND c.is_archived = FALSE ${areaClause(EFFECTIVE_CONVERSATION_AREA, areaFilter, cParams)}
    ORDER BY pin.position, pin.pinned_at LIMIT ${CANDIDATES}`;
  const items = [];
  for (const row of (await db.query(cSql, cParams)).rows) {
    if (!(await viewable(db, 'conversation', row.id, userId))) continue;
    items.push({ kind: 'chat', id: row.id, title: String(row.title || '').trim() || 'New chat', area: row.area || null, project_id: row.project_id || null, at: row.at });
  }
  const pParams = [userId];
  const pSql = `SELECT p.id, p.name, p.area, p.updated_at FROM chat_project_pins pin JOIN chat_projects p ON p.id = pin.project_id
    WHERE pin.user_id = $1 AND p.is_archived = FALSE ${areaClause('p.area', areaFilter, pParams)}
    ORDER BY pin.position, pin.pinned_at LIMIT ${CANDIDATES}`;
  for (const row of (await db.query(pSql, pParams)).rows) {
    if (!(await viewable(db, 'project', row.id, userId))) continue;
    items.push({ kind: 'project', id: row.id, title: String(row.name || 'Project'), area: row.area || null, at: row.updated_at });
  }
  const starred = await listLibraryItems(db, userId, { view: 'starred', limit: 50, ...(areaFilter.filter ? { area: areaFilter.area === null ? 'none' : areaFilter.area } : {}) });
  for (const it of starred.items) items.push({ kind: 'file', id: it.id, title: String(it.name || 'Untitled'), area: it.area || null, at: it.updated_at || it.created_at, source: it.source, source_id: it.source_id });
  return { items };
}

export const WEEK_DAYS = 7;
/**
 * The person's own last seven days, per area, as counts per day (index 0 = six days ago … index 6 = the last 24
 * hours). Days are rolling 24-hour windows counted back from now, so the answer does not depend on a time zone.
 * Three facts the platform holds: conversations the person started, messages they sent, and scheduled runs that
 * finished for them. An area with nothing in the week is absent. The key for work in no area is "".
 */
export async function summarizeWeek(db, userId) {
  const areas = {};
  const put = (area, metric, ago, n) => { if (ago < 0 || ago >= WEEK_DAYS) return; const a = (areas[area || ''] = areas[area || ''] || { chats: Array(WEEK_DAYS).fill(0), messages: Array(WEEK_DAYS).fill(0), runs: Array(WEEK_DAYS).fill(0) }); a[metric][WEEK_DAYS - 1 - ago] += n; };
  const ago = (col) => `floor(extract(epoch FROM ((now() AT TIME ZONE 'UTC') - ${col})) / 86400)::int`;
  const agoTz = (col) => `floor(extract(epoch FROM (now() - ${col})) / 86400)::int`;
  const chats = await db.query(`SELECT ${EFFECTIVE_CONVERSATION_AREA} AS area, ${ago('c.created_at')} AS ago, count(*)::int AS n
    FROM chat_conversations c WHERE c.user_id = $1 AND c.deleted_at IS NULL AND c.created_at >= (now() AT TIME ZONE 'UTC') - interval '${WEEK_DAYS} days' GROUP BY 1, 2`, [userId]);
  for (const r of chats.rows) put(r.area, 'chats', r.ago, r.n);
  const msgs = await db.query(`SELECT ${EFFECTIVE_CONVERSATION_AREA} AS area, ${ago('m.created_at')} AS ago, count(*)::int AS n
    FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE m.user_id = $1 AND m.role = 'user' AND m.scheduled_run_id IS NULL AND c.deleted_at IS NULL AND m.created_at >= (now() AT TIME ZONE 'UTC') - interval '${WEEK_DAYS} days' GROUP BY 1, 2`, [userId]);
  for (const r of msgs.rows) put(r.area, 'messages', r.ago, r.n);
  const runs = await db.query(`SELECT CASE WHEN t.project_id IS NOT NULL THEN (SELECT ap.area FROM chat_projects ap WHERE ap.id = t.project_id) ELSE t.area END AS area, ${agoTz('r.completed_at')} AS ago, count(*)::int AS n
    FROM chat_scheduled_runs r JOIN chat_scheduled_tasks t ON t.id = r.task_id
    WHERE t.run_as_user_id = $1 AND r.status = 'succeeded' AND r.completed_at >= now() - interval '${WEEK_DAYS} days' GROUP BY 1, 2`, [userId]);
  for (const r of runs.rows) put(r.area, 'runs', r.ago, r.n);
  return { days: WEEK_DAYS, areas };
}

/** The chat's own first choice (src/components/playground/Chat/ChatWithLLM.tsx DEFAULT_MODEL). Keep the two the same. */
export const PLATFORM_DEFAULT_MODEL = 'gpt-5.6-terra';
/**
 * The model new work in `area` uses when none is named: the area's own (settings areas.<id>.model), else the
 * person's default (settings models.defaultModel), else the platform's. Decided here, on the server, so a client
 * that forgets to say cannot leave a scheduled chat on a model that no longer exists.
 */
export async function defaultModelFor(db, userId, area) {
  let s = {};
  try { s = (await db.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId])).rows[0]?.settings || {}; } catch { s = {}; }
  const own = area && s.areas && typeof s.areas === 'object' ? s.areas[area]?.model : null;
  if (typeof own === 'string' && own.trim()) return own.trim();
  const mine = s.models?.defaultModel;
  return typeof mine === 'string' && mine.trim() ? mine.trim() : PLATFORM_DEFAULT_MODEL;
}

export async function listNeedsYou(db, userId, { areaFilter = { filter: false, area: null } } = {}) {
  const params = [];
  const effective = `CASE WHEN t.project_id IS NOT NULL THEN (SELECT ap.area FROM chat_projects ap WHERE ap.id = t.project_id) ELSE t.area END`;
  const sql = `
    SELECT t.id, t.title, t.last_run_error, t.last_run_at, t.project_id, t.conversation_id, ${effective} AS area
    FROM chat_scheduled_tasks t
    WHERE t.last_run_status = 'failed' ${areaClause(effective, areaFilter, params)}
    ORDER BY t.last_run_at DESC NULLS LAST LIMIT ${CANDIDATES}`;
  const items = [];
  for (const row of (await db.query(sql, params)).rows) {
    if (items.length >= 30) break;
    if (!(await viewable(db, 'schedule', row.id, userId))) continue;
    items.push({ kind: 'schedule_failed', id: row.id, title: String(row.title || 'Scheduled chat'), detail: String(row.last_run_error || '').slice(0, 300),
      area: row.area || null, conversation_id: row.conversation_id || null, at: row.last_run_at });
  }
  // XENO Tasks: work waiting for the caller to accept it (they are its reviewer, and it is in review)
  try {
    const review = await listTasks(db, { id: userId, kind: 'human' }, { status: 'in_review', ...(areaFilter.filter ? { area: areaFilter.area === null ? 'none' : areaFilter.area } : {}) });
    for (const t of review) if (t.reviewer && t.reviewer.id === String(userId)) items.push({ kind: 'task_review', id: t.key, title: `${t.key} · ${t.title}`, detail: t.assignee ? `${t.assignee.name} asks you to review it` : 'Waiting for your review', area: t.area, conversation_id: null, at: t.updatedAt });
  } catch { /* tasks are an addition here: a failure to read them must not hide the rest of what waits */ }
  return { items };
}

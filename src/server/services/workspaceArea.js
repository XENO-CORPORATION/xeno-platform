/**
 * Two reads across everything a person has in the XENO workspace, each aware of the AREA an item lives in
 * (database/migrations/20261009200000-resource-area.sql: each area has its own work; Overview shows all).
 *
 *   searchWorkspace   one search over conversations (their titles and what was said in them), chat projects
 *                     and Library items. `area` narrows it to one area, or to the items in none.
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

  return { query: q, results: [...chats, ...projects, ...files], counts: { chat: chats.length, project: projects.length, file: files.length } };
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
  return { items };
}

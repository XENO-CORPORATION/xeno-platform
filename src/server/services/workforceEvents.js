/**
 * XENO-WORKFORCE-01 §15 — the ONE typed workforce event stream, read per viewer.
 *
 * Writing: nothing here writes. Every event is appended by a trigger on the table that owns the change
 * (20261022090000-orchestrator-and-events.sql) — admissions, leases, revocations, results, handoffs, assignments,
 * funding budgets and contributions, divisions, dependency edges, plans and attempts — inside the same transaction,
 * so a change without its event (or an event without its change) is unrepresentable.
 *
 * Reading: an AUDIT VIEW of one scope — `workspace:<id>`, `division:<id>` or `project:<id>`. The scope itself needs
 * the owning rule (a workspace viewer; a division's workspace viewer; a project viewer), and then EVERY ROW is decided
 * again on its own, with the rule its owning service already uses (as divisionHome.js does):
 *   - an event on a project:           a viewer of that project
 *   - a run event with no project:     its actor or payer, or a workspace admin
 *   - a handoff event with no project: its source or target principal, or a workspace admin
 *   - anything else in a workspace:    a viewer of that workspace
 *   - an event with no scope at all:   its actor only
 * A row the reader may not see is counted in `hidden`, never sent. Paging is by id (newest first), `before` exclusive;
 * `after` gives the rows newer than a cursor (oldest first), which is what a live feed polls.
 */
import { check } from '../utils/authzReBAC.js';

export class EventsError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new EventsError('Not found', 'not_found', 404);
const MAX = 200;

function memoCheck(db, userId) {
  const memo = new Map();
  return async (object, relation) => {
    const k = `${object}#${relation}`;
    if (!memo.has(k)) memo.set(k, (await check(db, { object, relation, subject: `user:${userId}` })).allowed);
    return memo.get(k);
  };
}

/** May `me` see this one event row? */
export async function mayRead(row, me, can) {
  const uid = String(me.id);
  if (row.project_id) return can(`project:${row.project_id}`, 'viewer');
  const mine = String(row.actor_user_id || '') === uid;
  if (row.type.startsWith('run.')) return mine || String(row.data?.payerUserId || '') === uid || (row.workspace_id ? can(`workspace:${row.workspace_id}`, 'admin') : false);
  if (row.type.startsWith('handoff.')) return [row.data?.sourcePrincipalId, row.data?.targetPrincipalId].map(String).includes(uid) || (row.workspace_id ? can(`workspace:${row.workspace_id}`, 'admin') : false);
  if (row.workspace_id) return can(`workspace:${row.workspace_id}`, 'viewer');
  return mine;
}

const shape = (r) => ({ id: String(r.id), type: r.type, subject: { kind: r.subject_kind, id: String(r.subject_id) },
  actorUserId: r.actor_user_id ? String(r.actor_user_id) : null, workspaceId: r.workspace_id ? String(r.workspace_id) : null,
  divisionId: r.division_id ? String(r.division_id) : null, projectId: r.project_id ? String(r.project_id) : null, data: r.data, at: r.at });

/** The audit view of one scope, as `me` may see it. */
export async function listEvents(db, me, { scope, before, after, limit = 50, types } = {}) {
  const m = /^(workspace|division|project):([0-9a-f-]{36})$/i.exec(String(scope || ''));
  if (!m || !UUID.test(m[2])) throw new EventsError('scope is workspace:<id>, division:<id> or project:<id>', 'bad_input');
  const [, kind, id] = m;
  const can = memoCheck(db, me.id);
  let where;
  if (kind === 'workspace') { if (!(await can(`workspace:${id}`, 'viewer'))) throw notFound(); where = 'workspace_id = $1'; }
  else if (kind === 'division') {
    const d = (await db.query('SELECT workspace_id FROM workforce_divisions WHERE id=$1', [id])).rows[0];
    if (!d || !(await can(`workspace:${d.workspace_id}`, 'viewer'))) throw notFound(); where = 'division_id = $1';
  } else { if (!(await can(`project:${id}`, 'viewer'))) throw notFound(); where = 'project_id = $1'; }
  const n = Math.min(MAX, Math.max(1, Number(limit) || 50));
  const params = [id.toLowerCase()];
  if (before !== undefined) { if (!/^\d{1,18}$/.test(String(before))) throw new EventsError('before is an event id', 'bad_input'); params.push(String(before)); where += ` AND id < $${params.length}`; }
  if (after !== undefined) { if (!/^\d{1,18}$/.test(String(after))) throw new EventsError('after is an event id', 'bad_input'); params.push(String(after)); where += ` AND id > $${params.length}`; }
  const tlist = types === undefined ? null : [].concat(types).flatMap((t) => String(t).split(',')).filter(Boolean);
  if (tlist) { if (tlist.some((t) => !/^[a-z]+(\.[a-z_]+)*$/.test(t))) throw new EventsError('types are event type prefixes', 'bad_input'); params.push(tlist); where += ` AND (split_part(type, '.', 1) = ANY($${params.length}::text[]) OR type = ANY($${params.length}::text[]))`; }
  // read a bounded window, then decide each row; over-read so a page of hidden rows still returns something
  const rows = (await db.query(`SELECT * FROM workforce_events WHERE ${where} ORDER BY id ${after !== undefined ? 'ASC' : 'DESC'} LIMIT ${n * 4}`, params)).rows;
  const events = []; let hidden = 0, last = null;
  for (const r of rows) {
    last = r.id;
    if (await mayRead(r, me, can)) { events.push(shape(r)); if (events.length === n) break; } else hidden++;
  }
  return { scope: `${kind}:${id.toLowerCase()}`, events, hidden, cursor: last === null ? null : String(last), more: rows.length === n * 4 || events.length === n };
}

/**
 * For Places' live feed: the events of a workspace newer than `after`, as `me` may see them, excluding any on a
 * division in `closedDivisionIds` (a closed floor's activity never reaches a viewer — the same rule as its snapshot).
 */
export async function liveOf(db, me, { workspaceId, after = '0', closedDivisionIds = [], limit = 50 }) {
  const can = memoCheck(db, me.id);
  const rows = (await db.query(`SELECT * FROM workforce_events WHERE workspace_id=$1 AND id > $2 ORDER BY id DESC LIMIT $3`, [workspaceId, String(after), Math.min(MAX, limit)])).rows.reverse();
  const closed = new Set(closedDivisionIds.map(String));
  const out = [];
  for (const r of rows) if (!(r.division_id && closed.has(String(r.division_id))) && await mayRead(r, me, can)) out.push(shape(r));
  return { events: out, cursor: rows.length ? String(rows[rows.length - 1].id) : String(after) };
}

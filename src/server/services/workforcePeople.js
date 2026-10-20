/**
 * People in a company workspace — THE one service for employee profiles, the org chart, the directory, time off,
 * availability, onboarding, offboarding and "my work" (xeno-company/SPEC.md §7.3 D-EMP, DECIDED 2026-10-20 by the
 * owner: "be completely ready to recreate XENO in XENO … we are also missing a lot of employee features").
 *
 * Employment is an ADMISSION plus a TITLE (XENO-WORKFORCE-01 §8.2d LIFE-01, decision D18):
 *   membership   the workspace's relationship_tuples — humans AND agents — plus agents owned by the workspace
 *   division     workforce_divisions (by id)          team   workforce_resources kind 'team' (by id)
 *   profile      workforce_employee_profiles — an ANNEX: title, manager, dates, place, hours, private contact.
 *                It is never consulted for a permission decision; the org chart is the manager edge on it.
 *
 * Access (mutation-checked in tests/workforce-people.test.mjs):
 *   read public fields   anyone who can view the workspace (an agent reads, it never writes HR data)
 *   read PRIVATE fields  the person themself, a human workspace admin, and any manager above them in the chain
 *   write HR fields      a HUMAN workspace admin (title, division, team, manager, dates)
 *   write own details    the person themself, if human (location, timezone, hours, private contact)
 *   time off             the person (human) for themself, or a human admin; notes are private like the profile
 *   onboarding / off.    a human admin. Offboarding removes access through the ONE member-removal path
 *                        (workspaceMembershipOperations 'member.remove') and moves what the person HEADED or MANAGED
 *                        to their manager; their own resources are listed for an OWN-05 transfer, never moved silently.
 */
import { check, listObjectTuples } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';
import { createTask } from './xenoTasks.js';
import { createAuthorizedProject } from './chatProjectAuthority.js';
import { mutateWorkspaceMembership } from './workspaceMembershipOperations.js';
import * as divisions from './workforceDivisions.js';

export class PeopleError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const fail = (m, c, s) => { throw new PeopleError(m, c, s); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export const ONBOARDING_TASKS = Object.freeze([
  { title: 'Welcome: read how this company works', body: 'Start with the workspace overview and your division’s home.' },
  { title: 'Set your working hours and time zone', body: 'People and Places use them to know when you are around.' },
  { title: 'Meet your manager and your team', body: 'A first conversation about what you will own.' },
  { title: 'Pick up your first task', body: 'Your manager will point you at one; claim it when you start.' },
]);

async function principal(db, id) {
  const p = await resolvePrincipal(db, id);
  if (!p?.usable) fail('Not allowed', 'actor_unavailable', 403);
  return p;
}
async function relationOf(db, workspaceId, userId, relation) {
  const v = await check(db, { object: `workspace:${workspaceId}`, relation, subject: `user:${userId}` });
  return v.allowed;
}
/** Who is calling, in which workspace, and what they may do there. A non-member is told the workspace does not exist. */
async function context(db, me, workspaceId) {
  if (!UUID.test(String(workspaceId || ''))) fail('Workspace not found', 'workspace_not_found', 404);
  const w = (await db.query(`SELECT id, name, workspace_type, status, owner_user_id FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  if (!w || w.status !== 'active') fail('Workspace not found', 'workspace_not_found', 404);
  const p = await principal(db, me.id);
  const kind = p.kind === 'agent' ? 'agent' : p.kind === 'human' ? 'human' : 'service';
  const viewer = await relationOf(db, w.id, me.id, 'viewer')
    || (kind === 'agent' && (await rosterIds(db, w.id)).has(String(me.id)));
  if (!viewer) fail('Workspace not found', 'workspace_not_found', 404);
  const admin = kind === 'human' && await relationOf(db, w.id, me.id, 'admin');
  return { w, me: { id: String(me.id), kind, name: p.displayName || p.handle || 'Someone' }, admin };
}

/** The roster: every workspace member subject (human or agent) plus the agents the workspace owns. */
async function rosterIds(db, workspaceId) {
  const out = new Map();
  for (const t of await listObjectTuples(db, `workspace:${workspaceId}`)) {
    if (!t.subject.startsWith('user:')) continue;
    const id = t.subject.slice(5), old = out.get(id);
    if (!old || (ROLE_RANK[t.relation] ?? 0) > (ROLE_RANK[old] ?? 0)) out.set(id, t.relation);
  }
  const owned = (await db.query(`SELECT a.user_id FROM agent_identities a JOIN workforce_resources r ON r.id::text = to_jsonb(a)->>'workforce_resource_id'
      WHERE r.owner_workspace_id = $1 AND r.status = 'active' AND a.status = 'active'`, [workspaceId]).catch(() => ({ rows: [] }))).rows;
  for (const r of owned) if (!out.has(String(r.user_id))) out.set(String(r.user_id), 'agent');
  return out;
}

async function loadPeople(db, workspaceId) {
  const roster = await rosterIds(db, workspaceId);
  if (!roster.size) return [];
  const ids = [...roster.keys()];
  const rows = (await db.query(`SELECT u.id, u.username, u.display_name, a.owner_user_id AS agent_owner, p.*,
        d.name AS division_name, t.name AS team_name
      FROM users u LEFT JOIN agent_identities a ON a.user_id = u.id
      LEFT JOIN workforce_employee_profiles p ON p.principal_id = u.id AND p.workspace_id = $1
      LEFT JOIN workforce_divisions d ON d.id = p.division_id
      LEFT JOIN workforce_resources t ON t.id = p.team_resource_id
     WHERE u.id = ANY($2::uuid[])`, [workspaceId, ids])).rows;
  const now = new Date();
  const off = (await db.query(`SELECT * FROM workforce_time_off WHERE workspace_id = $1 AND cancelled_at IS NULL AND ends_at > $2 ORDER BY starts_at`, [workspaceId, now])).rows;
  return rows.map((r) => ({ row: r, id: String(r.id), relation: roster.get(String(r.id)), timeOff: off.filter((o) => String(o.principal_id) === String(r.id)) }));
}

/** Managers above `id`, nearest first. A broken chain (a cycle) stops at the first repeat. */
function chainAbove(byId, id) {
  const out = [], seen = new Set([id]);
  let cur = byId.get(id)?.row.manager_principal_id;
  while (cur && !seen.has(String(cur))) { out.push(String(cur)); seen.add(String(cur)); cur = byId.get(String(cur))?.row.manager_principal_id; }
  return out;
}
const mayReadPrivate = (ctx, byId, subjectId) => ctx.me.id === subjectId || ctx.admin || (ctx.me.kind === 'human' && chainAbove(byId, subjectId).includes(ctx.me.id));

/** Availability right now: time off first, then stated working hours in the person's own time zone. */
export function availabilityAt(profile, timeOff = [], at = new Date()) {
  const t = at instanceof Date ? at : new Date(at);
  const away = timeOff.find((o) => !o.cancelled_at && new Date(o.starts_at) <= t && new Date(o.ends_at) > t);
  if (away) return { available: false, reason: 'time_off', until: new Date(away.ends_at).toISOString(), kind: away.kind };
  const h = profile?.working_hours;
  if (!h || !Array.isArray(h.days) || !HHMM.test(h.start || '') || !HHMM.test(h.end || '')) return { available: true, reason: null };
  let parts;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t).map((x) => [x.type, x.value])); }
  catch { return { available: true, reason: null }; }
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  const hm = `${parts.hour}:${parts.minute}`;
  if (!h.days.includes(day) || hm < h.start || hm >= h.end) return { available: false, reason: 'outside_hours' };
  return { available: true, reason: null };
}

function shape(ctx, byId, x, { at } = {}) {
  const r = x.row, isAgent = !!r.agent_owner;
  const pub = {
    id: x.id, kind: isAgent ? 'agent' : 'human', name: r.display_name || r.username, handle: r.username,
    role: x.relation === 'editor' ? 'member' : x.relation,
    title: r.title || '', division: r.division_id ? { id: r.division_id, name: r.division_name } : null,
    team: r.team_resource_id ? { id: r.team_resource_id, name: r.team_name } : null,
    managerId: r.manager_principal_id ? String(r.manager_principal_id) : null,
    startDate: r.start_date || null, endDate: r.end_date || null,
    location: r.location || '', timezone: r.timezone || 'UTC', workingHours: r.working_hours || null,
    availability: availabilityAt(r, x.timeOff, at),
    revision: r.revision ? Number(r.revision) : 0,
  };
  if (!mayReadPrivate(ctx, byId, x.id)) return { ...pub, private: null };
  return { ...pub, private: { phone: r.private_phone || '', emergencyContact: r.emergency_contact || '', notes: r.private_notes || '',
    timeOff: x.timeOff.map((o) => ({ id: o.id, startsAt: o.starts_at, endsAt: o.ends_at, kind: o.kind, note: o.note })) } };
}

async function everyone(db, me, workspaceId) {
  const ctx = await context(db, me, workspaceId);
  const people = await loadPeople(db, ctx.w.id);
  return { ctx, people, byId: new Map(people.map((p) => [p.id, p])) };
}

/** The people directory: search by name, handle, title or location; filter by division, team or kind. */
export async function directory(db, me, { workspaceId, q, divisionId, teamId, kind } = {}) {
  const { ctx, people, byId } = await everyone(db, me, workspaceId);
  const needle = clean(q, 80).toLowerCase();
  const list = people.map((x) => shape(ctx, byId, x)).filter((p) => (!needle || [p.name, p.handle, p.title, p.location].some((s) => String(s || '').toLowerCase().includes(needle)))
    && (!divisionId || p.division?.id === divisionId) && (!teamId || p.team?.id === teamId) && (!kind || p.kind === kind));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { workspaceId: ctx.w.id, people: list, canManage: ctx.admin };
}

export async function getPerson(db, me, { workspaceId, principalId } = {}) {
  const { ctx, byId } = await everyone(db, me, workspaceId);
  const x = byId.get(String(principalId || ''));
  if (!x) fail('Person not found', 'person_not_found', 404);
  const person = shape(ctx, byId, x);
  const reports = [...byId.values()].filter((y) => String(y.row.manager_principal_id || '') === x.id).map((y) => ({ id: y.id, name: y.row.display_name || y.row.username }));
  return { person, managerChain: chainAbove(byId, x.id).map((id) => ({ id, name: byId.get(id)?.row.display_name || byId.get(id)?.row.username || null })), reports,
    canEditHr: ctx.admin, canEditOwn: ctx.me.id === x.id && ctx.me.kind === 'human' };
}

/** The org chart: humans and agents, from the roster and the manager edge — no second org store. */
export async function orgChart(db, me, { workspaceId } = {}) {
  const { ctx, people, byId } = await everyone(db, me, workspaceId);
  const nodes = people.map((x) => { const p = shape(ctx, byId, x); return { id: p.id, kind: p.kind, name: p.name, title: p.title, division: p.division, team: p.team, managerId: byId.has(p.managerId || '') ? p.managerId : null, available: p.availability.available }; });
  const children = new Map();
  for (const n of nodes) { const k = n.managerId || ''; if (!children.has(k)) children.set(k, []); children.get(k).push(n.id); }
  // a cycle has no root; surface its members as roots so nobody disappears from the chart
  const reachable = new Set(); const walk = (id) => { if (reachable.has(id)) return; reachable.add(id); for (const c of children.get(id) || []) walk(c); };
  for (const r of children.get('') || []) walk(r);
  const roots = [...(children.get('') || []), ...nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id)];
  return { workspaceId: ctx.w.id, nodes, roots, reportsOf: Object.fromEntries([...children].filter(([k]) => k)) };
}

const HR_FIELDS = ['title', 'divisionId', 'teamId', 'managerId', 'startDate', 'endDate'];
const OWN_FIELDS = ['location', 'timezone', 'workingHours', 'privatePhone', 'emergencyContact'];
const ADMIN_ONLY_PRIVATE = ['privateNotes'];

/** Update a profile. HR fields: a human admin. Own details: the person (human) or a human admin. Agents never. */
export async function updateProfile(db, me, { workspaceId, principalId, expectedRevision, ...fields } = {}) {
  const { ctx, byId } = await everyone(db, me, workspaceId);
  if (ctx.me.kind !== 'human') fail('A person makes changes to employee records; an agent can read them.', 'human_only', 403);
  const x = byId.get(String(principalId || ''));
  if (!x) fail('Person not found', 'person_not_found', 404);
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const unknown = keys.filter((k) => ![...HR_FIELDS, ...OWN_FIELDS, ...ADMIN_ONLY_PRIVATE].includes(k));
  if (unknown.length) fail(`Unknown field: ${unknown[0]}`, 'bad_input');
  const self = ctx.me.id === x.id;
  if (keys.some((k) => HR_FIELDS.includes(k) || ADMIN_ONLY_PRIVATE.includes(k)) && !ctx.admin) fail('Only a workspace admin changes title, division, team, manager or dates', 'admin_required', 403);
  if (keys.some((k) => OWN_FIELDS.includes(k)) && !self && !ctx.admin) fail('Only the person or an admin changes these details', 'not_allowed', 403);
  const r = x.row;
  if (expectedRevision !== undefined && Number(expectedRevision) !== Number(r.revision || 0)) fail('This profile changed since you read it', 'stale_revision', 409);
  const next = {
    title: r.title || '', division_id: r.division_id || null, team_resource_id: r.team_resource_id || null, manager_principal_id: r.manager_principal_id || null,
    start_date: r.start_date || null, end_date: r.end_date || null, location: r.location || '', timezone: r.timezone || 'UTC', working_hours: r.working_hours || null,
    private_phone: r.private_phone || '', emergency_contact: r.emergency_contact || '', private_notes: r.private_notes || '',
  };
  if ('title' in fields) next.title = clean(fields.title, 120);
  if ('divisionId' in fields) {
    if (fields.divisionId && !(await db.query(`SELECT 1 FROM workforce_divisions WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'active'`, [fields.divisionId, ctx.w.id]).catch(() => ({ rowCount: 0 }))).rowCount) fail('Division not found', 'division_not_found', 404);
    next.division_id = fields.divisionId || null;
  }
  if ('teamId' in fields) {
    if (fields.teamId && !(await db.query(`SELECT 1 FROM workforce_resources WHERE id = $1 AND kind = 'team' AND owner_workspace_id = $2 AND status = 'active'`, [fields.teamId, ctx.w.id]).catch(() => ({ rowCount: 0 }))).rowCount) fail('Team not found', 'team_not_found', 404);
    next.team_resource_id = fields.teamId || null;
  }
  if ('managerId' in fields) {
    const m = fields.managerId ? String(fields.managerId) : null;
    if (m && !byId.has(m)) fail('The manager must be a member of this workspace', 'manager_not_member', 400);
    if (m === x.id) fail('Someone cannot manage themself', 'manager_cycle', 400);
    if (m && chainAbove(byId, m).includes(x.id)) fail('That would make a loop in the reporting line', 'manager_cycle', 400);
    next.manager_principal_id = m;
  }
  for (const [k, col] of [['startDate', 'start_date'], ['endDate', 'end_date']]) if (k in fields) {
    if (fields[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields[k]))) fail(`${k} is a date (YYYY-MM-DD)`, 'bad_input');
    next[col] = fields[k] || null;
  }
  if ('location' in fields) next.location = clean(fields.location, 120);
  if ('timezone' in fields) {
    const tz = clean(fields.timezone, 64) || 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { fail('Unknown time zone', 'bad_timezone'); }
    next.timezone = tz;
  }
  if ('workingHours' in fields) {
    const h = fields.workingHours;
    if (h === null) next.working_hours = null;
    else {
      const days = Array.isArray(h?.days) ? [...new Set(h.days.map(Number))].filter((d) => d >= 1 && d <= 7).sort() : [];
      if (!days.length || !HHMM.test(h?.start || '') || !HHMM.test(h?.end || '') || h.end <= h.start) fail('Working hours are days 1–7 and a start before an end (HH:MM)', 'bad_hours');
      next.working_hours = { days, start: h.start, end: h.end };
    }
  }
  if ('privatePhone' in fields) next.private_phone = clean(fields.privatePhone, 40);
  if ('emergencyContact' in fields) next.emergency_contact = clean(fields.emergencyContact, 200);
  if ('privateNotes' in fields) next.private_notes = String(fields.privateNotes ?? '').slice(0, 4000);
  await db.query(`INSERT INTO workforce_employee_profiles (workspace_id, principal_id, title, division_id, team_resource_id, manager_principal_id, start_date, end_date, location, timezone, working_hours, private_phone, emergency_contact, private_notes, updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (workspace_id, principal_id) DO UPDATE SET title=$3, division_id=$4, team_resource_id=$5, manager_principal_id=$6, start_date=$7, end_date=$8, location=$9, timezone=$10,
      working_hours=$11, private_phone=$12, emergency_contact=$13, private_notes=$14, updated_by_user_id=$15, revision = workforce_employee_profiles.revision + 1, updated_at = now()`,
  [ctx.w.id, x.id, next.title, next.division_id, next.team_resource_id, next.manager_principal_id, next.start_date, next.end_date, next.location, next.timezone,
    next.working_hours ? JSON.stringify(next.working_hours) : null, next.private_phone, next.emergency_contact, next.private_notes, ctx.me.id]);
  await audit(db, ctx, 'people.profile.updated', x.id, { fields: keys });
  return getPerson(db, me, { workspaceId: ctx.w.id, principalId: x.id });
}

async function audit(db, ctx, action, subjectId, metadata) {
  await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1,$2,$3,$4,$5)`,
    [ctx.w.id, ctx.me.id, action, `user:${subjectId}`, JSON.stringify({ schemaVersion: 1, ...metadata })]).catch(() => {});
}

/** Book time off. The person (human) for themself, or a human admin for anyone. */
export async function addTimeOff(db, me, { workspaceId, principalId, startsAt, endsAt, kind = 'vacation', note = '' } = {}) {
  const { ctx, byId } = await everyone(db, me, workspaceId);
  if (ctx.me.kind !== 'human') fail('A person books time off; an agent can read availability.', 'human_only', 403);
  const subject = String(principalId || ctx.me.id);
  if (!byId.has(subject)) fail('Person not found', 'person_not_found', 404);
  if (subject !== ctx.me.id && !ctx.admin) fail('Only the person or an admin books their time off', 'not_allowed', 403);
  const s = new Date(startsAt), e = new Date(endsAt);
  if (Number.isNaN(+s) || Number.isNaN(+e) || e <= s) fail('Time off needs a start before its end', 'bad_input');
  if (!['vacation', 'sick', 'leave', 'holiday', 'other'].includes(kind)) fail('Unknown kind of time off', 'bad_input');
  const row = (await db.query(`INSERT INTO workforce_time_off (workspace_id, principal_id, starts_at, ends_at, kind, note, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ctx.w.id, subject, s, e, kind, clean(note, 500), ctx.me.id])).rows[0];
  await audit(db, ctx, 'people.time_off.added', subject, { timeOffId: row.id, kind });
  return { id: row.id, principalId: subject, startsAt: s.toISOString(), endsAt: e.toISOString(), kind };
}
export async function cancelTimeOff(db, me, { workspaceId, timeOffId } = {}) {
  const { ctx } = await everyone(db, me, workspaceId);
  if (ctx.me.kind !== 'human') fail('A person changes time off', 'human_only', 403);
  const r = (await db.query(`SELECT * FROM workforce_time_off WHERE id = $1 AND workspace_id = $2`, [timeOffId, ctx.w.id]).catch(() => ({ rows: [] }))).rows[0];
  if (!r) fail('Time off not found', 'not_found', 404);
  if (String(r.principal_id) !== ctx.me.id && !ctx.admin) fail('Time off not found', 'not_found', 404);
  await db.query(`UPDATE workforce_time_off SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL`, [r.id]);
  return { id: r.id, cancelled: true };
}

/** Is this principal around? Used by Places (the desk shows "away") and by assignment pickers. Public: no notes. */
export async function availability(db, workspaceId, principalId, at = new Date()) {
  const p = (await db.query(`SELECT working_hours, timezone FROM workforce_employee_profiles WHERE workspace_id = $1 AND principal_id = $2`, [workspaceId, principalId]).catch(() => ({ rows: [] }))).rows[0];
  const off = (await db.query(`SELECT starts_at, ends_at, kind, cancelled_at FROM workforce_time_off WHERE workspace_id = $1 AND principal_id = $2 AND cancelled_at IS NULL AND ends_at > $3`, [workspaceId, principalId, at]).catch(() => ({ rows: [] }))).rows;
  const busy = (await bookedNow(db, [principalId], at))[String(principalId)];
  const a = availabilityAt(p, off, at);
  return a.reason === 'time_off' || !busy ? a : busy;
}
/** Corpo › Scheduling: a confirmed booking happening at `at` makes the person unavailable until it ends (any workspace:
 *  a person cannot be in two meetings). Time off still wins, because it is checked first by the callers below. */
async function bookedNow(db, ids, at) {
  const rows = (await db.query(`SELECT DISTINCT ON (host_user_id) host_user_id, ends_at FROM scheduling_bookings
    WHERE host_user_id = ANY($1::uuid[]) AND status = 'confirmed' AND starts_at <= $2 AND ends_at > $2 ORDER BY host_user_id, ends_at DESC`, [ids, at]).catch(() => ({ rows: [] }))).rows;
  return Object.fromEntries(rows.map((r) => [String(r.host_user_id), { available: false, reason: 'in_meeting', until: new Date(r.ends_at).toISOString() }]));
}
/** Availability for many principals at once (Places snapshot). Unknown → available. */
export async function availabilityMap(db, workspaceId, ids, at = new Date()) {
  const list = [...new Set((ids || []).map(String))].filter((x) => UUID.test(x));
  if (!list.length || !UUID.test(String(workspaceId || ''))) return {};
  const profiles = (await db.query(`SELECT principal_id, working_hours, timezone FROM workforce_employee_profiles WHERE workspace_id = $1 AND principal_id = ANY($2::uuid[])`, [workspaceId, list]).catch(() => ({ rows: [] }))).rows;
  const off = (await db.query(`SELECT principal_id, starts_at, ends_at, kind, cancelled_at FROM workforce_time_off WHERE workspace_id = $1 AND principal_id = ANY($2::uuid[]) AND cancelled_at IS NULL AND ends_at > $3`, [workspaceId, list, at]).catch(() => ({ rows: [] }))).rows;
  const out = {};
  const booked = await bookedNow(db, list, at);
  for (const id of list) {
    const a = availabilityAt(profiles.find((p) => String(p.principal_id) === id), off.filter((o) => String(o.principal_id) === id), at);
    out[id] = a.reason === 'time_off' || !booked[id] ? a : booked[id];
  }
  return out;
}

async function inTransaction(pool, fn) {
  if (typeof pool.connect !== 'function' || typeof pool.release === 'function') return fn(pool);
  const c = await pool.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Onboard a member: one project with the checklist as XENO Tasks (assigned to them; delegated if an agent). Once. */
export function onboard(pool, me, { workspaceId, principalId, tasks } = {}) {
  return inTransaction(pool, async (db) => {
    const { ctx, byId } = await everyone(db, me, workspaceId);
    if (!ctx.admin) fail('A person who administers this workspace starts onboarding', 'admin_required', 403);
    const x = byId.get(String(principalId || ''));
    if (!x) fail('Person not found', 'person_not_found', 404);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`onboard:${ctx.w.id}:${x.id}`]);
    const prior = (await db.query(`SELECT * FROM workforce_lifecycle_events WHERE workspace_id = $1 AND principal_id = $2 AND kind = 'onboarding'`, [ctx.w.id, x.id])).rows[0];
    if (prior) return { replayed: true, onboarding: prior.report };
    const list = (Array.isArray(tasks) && tasks.length ? tasks : ONBOARDING_TASKS).slice(0, 20).map((t) => ({ title: clean(t.title, 300), body: String(t.body || '').slice(0, 2000) })).filter((t) => t.title);
    const name = x.row.display_name || x.row.username;
    const joined = { query: (sql, a) => (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) ? Promise.resolve({ rows: [] }) : db.query(sql, a)) };
    const project = await createAuthorizedProject(joined, { principal: { type: 'user', id: ctx.me.id }, workspaceId: ctx.w.id,
      name: `Onboarding — ${name}`.slice(0, 200), settings: { source: 'people-onboarding', principalId: x.id } });
    const made = [];
    for (const t of list) {
      const task = await createTask(db, ctx.me, { title: t.title, body: t.body, projectId: project.id, assigneeId: x.id });
      made.push({ id: task.id, key: task.key });
    }
    const report = { principalId: x.id, projectId: project.id, tasks: made, startedBy: ctx.me.id };
    await db.query(`INSERT INTO workforce_lifecycle_events (workspace_id, principal_id, kind, report, actor_user_id) VALUES ($1,$2,'onboarding',$3,$4)`, [ctx.w.id, x.id, JSON.stringify(report), ctx.me.id]);
    await audit(db, ctx, 'people.onboarding.started', x.id, { projectId: project.id, tasks: made.length });
    return { replayed: false, onboarding: report };
  });
}

/** What offboarding would do. Writes nothing. */
export async function offboardPlan(db, me, { workspaceId, principalId } = {}) {
  const { ctx, byId } = await everyone(db, me, workspaceId);
  if (!ctx.admin) fail('A person who administers this workspace offboards a member', 'admin_required', 403);
  const x = byId.get(String(principalId || ''));
  if (!x) fail('Person not found', 'person_not_found', 404);
  if (String(ctx.w.owner_user_id) === x.id) fail('The owner is offboarded only after the workspace is transferred', 'owner_transfer_required', 409);
  const successor = x.row.manager_principal_id ? String(x.row.manager_principal_id) : ctx.me.id;
  const headed = (await db.query(`SELECT id, name FROM workforce_divisions WHERE workspace_id = $1 AND head_principal_id = $2 AND lifecycle = 'active'`, [ctx.w.id, x.id]).catch(() => ({ rows: [] }))).rows;
  const reports = [...byId.values()].filter((y) => String(y.row.manager_principal_id || '') === x.id).map((y) => y.id);
  const personal = (await db.query(`SELECT id, kind, name FROM workforce_resources WHERE owner_user_id = $1 AND status = 'active'`, [x.id]).catch(() => ({ rows: [] }))).rows;
  const openTasks = Number((await db.query(`SELECT count(*)::int AS n FROM tasks t JOIN chat_projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND p.workspace_id = $1 AND t.assignee_id = $2 AND t.status NOT IN ('done', 'wont_do')`, [ctx.w.id, x.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0);
  return { principalId: x.id, kind: x.row.agent_owner ? 'agent' : 'human', successorId: successor,
    removesAccess: x.relation !== 'agent', divisionsToSuccessor: headed, reportsToSuccessor: reports,
    ownedElsewhere: personal.map((r) => ({ id: r.id, kind: r.kind, name: r.name, note: 'Owned by the person: proposed for an OWN-05 transfer by its owner, never moved silently.' })),
    openTasks, note: 'Company-owned resources stay with the company (OWN-05). Access is removed through the workspace’s member removal.' };
}

/** Offboard: end the profile, move headships and reports to the successor, then remove access (the one path). */
export async function offboard(pool, me, { workspaceId, principalId, confirm, endDate } = {}) {
  const plan = await offboardPlan(pool, me, { workspaceId, principalId });
  if (confirm !== true) fail('Offboarding needs confirm: true from the admin who read the plan', 'confirmation_required', 409);
  const actor = String(me.id);
  for (const d of plan.divisionsToSuccessor) await divisions.update(pool, { id: actor, kind: 'human' }, d.id, { headId: plan.successorId, reason: 'offboarding' });
  await pool.query(`UPDATE workforce_employee_profiles SET manager_principal_id = $3, revision = revision + 1, updated_at = now(), updated_by_user_id = $4
      WHERE workspace_id = $1 AND manager_principal_id = $2`, [workspaceId, plan.principalId, plan.successorId === plan.principalId ? null : plan.successorId, actor]);
  await pool.query(`INSERT INTO workforce_employee_profiles (workspace_id, principal_id, end_date, updated_by_user_id) VALUES ($1,$2,$3,$4)
      ON CONFLICT (workspace_id, principal_id) DO UPDATE SET end_date = EXCLUDED.end_date, revision = workforce_employee_profiles.revision + 1, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
  [workspaceId, plan.principalId, endDate || new Date().toISOString().slice(0, 10), actor]);
  let removal = null;
  if (plan.removesAccess) removal = await mutateWorkspaceMembership(pool, workspaceId, actor, 'xeno-people', null, 'member.remove', { memberId: plan.principalId }, { legacy: true });
  const report = { ...plan, removed: !!removal, removal: removal ? { ok: true } : null, by: actor };
  await pool.query(`INSERT INTO workforce_lifecycle_events (workspace_id, principal_id, kind, report, actor_user_id) VALUES ($1,$2,'offboarding',$3,$4)`, [workspaceId, plan.principalId, JSON.stringify(report), actor]);
  await pool.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1,$2,'people.offboarded',$3,$4)`,
    [workspaceId, actor, `user:${plan.principalId}`, JSON.stringify({ schemaVersion: 1, successorId: plan.successorId })]).catch(() => {});
  return { offboarding: report };
}

/** "My work": the caller's assignments, runs, approvals waiting on them and open tasks, in this workspace. */
export async function myWork(db, me, { workspaceId } = {}) {
  const { ctx, byId } = await everyone(db, me, workspaceId);
  const self = byId.get(ctx.me.id);
  const q = async (sql, a) => (await db.query(sql, a).catch(() => ({ rows: [] }))).rows;
  const tasks = await q(`SELECT t.id, 'T-' || t.number AS key, t.title, t.status, t.priority, t.project_id FROM tasks t JOIN chat_projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND p.workspace_id = $1 AND (t.assignee_id = $2 OR t.delegate_id = $2) AND t.status NOT IN ('done', 'wont_do') ORDER BY t.updated_at DESC LIMIT 100`, [ctx.w.id, ctx.me.id]);
  const reviews = await q(`SELECT t.id, 'T-' || t.number AS key, t.title, t.status FROM tasks t JOIN chat_projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND p.workspace_id = $1 AND t.reviewer_id = $2 AND t.status = 'in_review' ORDER BY t.updated_at DESC LIMIT 100`, [ctx.w.id, ctx.me.id]);
  const runs = await q(`SELECT r.id, r.state, r.created_at, 'T-' || t.number AS task_key FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id JOIN chat_projects p ON p.id = t.project_id WHERE p.workspace_id = $1 AND (r.owner_user_id = $2 OR r.agent_user_id = $2) ORDER BY r.created_at DESC LIMIT 20`, [ctx.w.id, ctx.me.id]);
  const assignments = await q(`SELECT r.id, r.kind, r.name FROM workforce_resources r JOIN agent_identities a ON r.id::text = to_jsonb(a)->>'workforce_resource_id'
      WHERE a.user_id = $1 AND r.owner_workspace_id = $2`, [ctx.me.id, ctx.w.id]);
  return { workspaceId: ctx.w.id, me: self ? shape(ctx, byId, self) : null, tasks, approvals: reviews, runs, assignments,
    reports: [...byId.values()].filter((y) => String(y.row.manager_principal_id || '') === ctx.me.id).map((y) => shape(ctx, byId, y)) };
}

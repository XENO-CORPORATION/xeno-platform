/**
 * XENO Places, phase 1 — the one service every Places surface calls (REST /api/places, XENO MCP `places`, the
 * places.xenosystem.ai front end). Contract: xeno-places "Places Backend Contract.md"; rules: xeno-places/SPEC.md.
 *
 *   call(op, input) → { ok: true, result, receipt? } | { ok: false, error: { code, reason, message } }
 *
 * What this owns: a building's LAYOUT (coordinates only), HOSTED SESSIONS (time-boxed guest passes) and the receipts
 * that fence retries. What it READS, never writes: workspaces, divisions (floors), teams (pods), memberships (desks),
 * principals (occupants) and runs (monitors). The snapshot is SCOPE-FILTERED HERE: a floor outside the viewer's scope
 * arrives as an opaque id with no name, headcount or activity (VIEW-02). The client never filters.
 *
 * Ownership (WORKFORCE-01 §8.11 D-7): a place is owned by the scope it shows and edited by that scope's admins.
 * Every workspace gets one at creation (DB trigger places_default_building) — a personal agent's building is its
 * owner's personal workspace building, where it sits at a desk.
 */
import crypto from 'node:crypto';

export const CODES = Object.freeze(['bad_input', 'not_found', 'denied', 'needs_approval', 'conflict', 'rate_limited', 'unavailable', 'timeout', 'internal']);
const STATUS = { bad_input: 400, not_found: 404, denied: 403, needs_approval: 409, conflict: 409, rate_limited: 429, unavailable: 503, timeout: 504, internal: 500 };
export class PlaceError extends Error {
  constructor(code, reason, message) {
    super(message); if (!CODES.includes(code)) throw new Error(`PlaceError: ${code} is not in the closed vocabulary`);
    this.code = code; this.reason = reason; this.status = STATUS[code];
  }
}
const fail = (code, reason, message) => { throw new PlaceError(code, reason, message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQ = /^[A-Za-z0-9._:-]{8,128}$/;
export const STYLES = Object.freeze(['glass', 'concrete', 'loft']);
const ALL_PERMS = ['watch', 'talk', 'handoff', 'edit', 'host'];
const MEMBER_PERMS = ['watch', 'talk', 'handoff'];
const RUN_STATUS = { starting: 'starting', queued: 'admitted', running: 'running' };

const uuid = (v, what) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : fail('bad_input', `invalid_${what}`, `${what} must be an id.`));
const ws = (s) => `workspace:${s}`;

async function tx(db, fn) {
  if (typeof db.connect !== 'function' || typeof db.release === 'function') return fn(db);
  const c = await db.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
const hashInput = (input) => { const { requestId, ...rest } = input || {}; return crypto.createHash('sha256').update(stable(rest)).digest('hex'); };

/** The fence: (actor, op, requestId). A retry answers the original receipt with replayed:true. */
async function mutate(db, me, op, input, fn) {
  const requestId = input?.requestId;
  if (typeof requestId !== 'string' || !REQ.test(requestId)) fail('bad_input', 'request_id_required', 'Every change carries a requestId (8–128 characters).');
  const h = hashInput(input);
  return tx(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`places-op:${me.id}:${op}:${requestId}`]);
    const prior = (await c.query('SELECT input_hash, result, receipt FROM place_operations WHERE actor_user_id=$1 AND op=$2 AND request_id=$3', [me.id, op, requestId])).rows[0];
    if (prior) {
      if (prior.input_hash !== h) fail('conflict', 'request_reused', 'That requestId was already used for a different change.');
      return { result: prior.result, receipt: { ...prior.receipt, replayed: true } };
    }
    const { result, revision, summary } = await fn(c);
    const operationId = crypto.randomUUID();
    const receipt = { operationId, op, revision: revision == null ? null : Number(revision), at: new Date().toISOString(), summary: summary || '' };
    await c.query('INSERT INTO place_operations (actor_user_id, op, request_id, input_hash, operation_id, result, receipt) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [me.id, op, requestId, h, operationId, JSON.stringify(result), JSON.stringify(receipt)]);
    return { result, receipt };
  });
}

// ── access ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Stand a building on the next free plot of a city (plots are unique per city; the advisory lock serialises them). */
async function moveTo(c, placeId, cityId, regionId, source) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`places-plot:${cityId}`]);
  const nxt = (await c.query('SELECT COALESCE(max(plot_index) + 1, 0) AS n FROM places WHERE city_id=$1', [cityId])).rows[0].n;
  await c.query('UPDATE places SET city_id=$2, region_id=$3, location_source=$4, plot_index=$5, revision=revision+1 WHERE id=$1', [placeId, cityId, regionId, source, nxt]);
}

async function workspaceRelation(db, me, workspaceId) {
  const rows = (await db.query(`SELECT relation FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_type='user' AND subject_id=$2`,
    [String(workspaceId), String(me.id)])).rows.map((r) => r.relation);
  if (rows.includes('owner')) return 'owner';
  if (rows.includes('admin')) return 'admin';
  if (rows.length) return 'member';
  // a personal agent belongs to its owner's personal scope (D-7): it is a member of that building, never an admin
  if (me.kind === 'agent') {
    const p = (await db.query(`SELECT 1 FROM agent_identities ai JOIN workspaces w ON w.owner_user_id = ai.owner_user_id AND w.workspace_type='personal'
      WHERE ai.user_id=$1 AND w.id=$2`, [me.id, workspaceId])).rows.length;
    if (p) return 'member';
  }
  return null;
}

/** Who the viewer is in this place: owner/admin · member · guest (live pass they joined) · visitor (public) · none. */
async function accessFor(db, me, place) {
  const rel = await workspaceRelation(db, me, place.workspace_id);
  const hosting = (await db.query(`SELECT id FROM place_hosted_sessions WHERE place_id=$1 AND state='live' AND ends_at>now() AND host_principal_id=$2 LIMIT 1`, [place.id, me.id])).rows[0];
  const base = { sessionId: null, hostingSessionId: hosting ? hosting.id : null };
  // an agent never administers a building, whatever tuple it holds (its effective role is capped by its owner's)
  if ((rel === 'owner' || rel === 'admin') && me.kind !== 'agent') return { ...base, role: rel, permissions: ALL_PERMS.slice(), scope: 'all' };
  if (rel) return { ...base, role: 'member', permissions: MEMBER_PERMS.slice(), scope: 'member' };
  const s = (await db.query(`SELECT s.id, s.permissions, s.floors FROM place_hosted_sessions s JOIN place_session_guests g ON g.session_id = s.id
    WHERE s.place_id=$1 AND s.state='live' AND s.ends_at>now() AND g.user_id=$2 ORDER BY s.started_at DESC LIMIT 1`, [place.id, me.id])).rows[0];
  if (s) return { ...base, role: 'guest', permissions: s.permissions, scope: s.floors ? s.floors : 'all', sessionId: s.id };
  if (place.visibility === 'public') return { ...base, role: 'visitor', permissions: ['watch'], scope: 'all' };
  return null;
}

async function loadPlace(db, placeId, { lock = false } = {}) {
  const p = (await db.query(`SELECT p.*, w.name AS workspace_name, w.workspace_type, w.owner_user_id, l.bays, l.layout, l.revision AS layout_revision
    FROM places p JOIN workspaces w ON w.id = p.workspace_id JOIN place_layouts l ON l.place_id = p.id WHERE p.id=$1 ${lock ? 'FOR UPDATE OF p, l' : ''}`, [uuid(placeId, 'placeId')])).rows[0];
  if (!p || p.lifecycle !== 'active') fail('not_found', 'place_not_found', 'No such place.');
  return p;
}

// ── the snapshot: live workforce records, filtered to the viewer's scope ────────────────────────────────────────
async function openDivisionIds(db, me, place, access, divisions) {
  if (access.scope === 'all') return new Set(divisions.map((d) => d.id));
  if (Array.isArray(access.scope)) return new Set(access.scope);
  // member: a division they hold a grant on, or one owning a team they sit in
  const rows = (await db.query(`SELECT d.id FROM workforce_divisions d WHERE d.workspace_id=$1 AND (
      EXISTS (SELECT 1 FROM relationship_tuples t WHERE t.object_type='division' AND t.object_id=d.id::text AND t.subject_type='user' AND t.subject_id=$2)
      OR d.head_principal_id = $3::uuid
      OR EXISTS (SELECT 1 FROM workforce_division_ownership o JOIN workforce_team_memberships m ON m.team_id=o.resource_id AND m.state='active'
                 LEFT JOIN agent_identities ai ON ai.workforce_resource_id = m.member_resource_id
                 WHERE o.division_id=d.id AND o.resource_kind='team' AND (m.member_principal_id=$3::uuid OR ai.user_id=$3::uuid)))`,
  [place.workspace_id, String(me.id), me.id])).rows;
  return new Set(rows.map((r) => r.id));
}

export async function buildSnapshot(db, me, place, access) {
  const divisions = (await db.query(`SELECT id, key, name, parent_division_id, head_principal_id FROM workforce_divisions
    WHERE workspace_id=$1 AND lifecycle='active' ORDER BY created_at, id`, [place.workspace_id])).rows;
  const byId = new Map(divisions.map((d) => [d.id, d]));
  const rootOf = (d) => { let x = d; while (x && x.parent_division_id && byId.has(x.parent_division_id)) x = byId.get(x.parent_division_id); return x; };
  const grants = await openDivisionIds(db, me, place, access, divisions);
  // a floor is a ROOT division; it is open when the viewer may see it or anything under it
  const openRoot = new Set(divisions.filter((d) => grants.has(d.id)).map((d) => rootOf(d).id));
  const isOpen = (d) => openRoot.has(rootOf(d).id);
  const shown = divisions.filter(isOpen);
  const closedDivisionIds = divisions.filter((d) => !d.parent_division_id && !isOpen(d)).map((d) => d.id);

  const teamRows = (await db.query(`SELECT r.id, r.name, o.division_id FROM workforce_resources r LEFT JOIN workforce_division_ownership o ON o.resource_id = r.id
    WHERE r.kind='team' AND r.status='active' AND r.owner_workspace_id=$1 ORDER BY r.created_at, r.id`, [place.workspace_id])).rows
    .filter((t) => !t.division_id || (byId.has(t.division_id) && isOpen(byId.get(t.division_id))));
  const teams = teamRows.map((t) => ({ id: t.id, name: t.name, owningDivisionId: t.division_id || null, assignedDivisionIds: [] }));
  const memRows = teams.length ? (await db.query(`SELECT m.id, m.team_id, m.role, m.member_principal_id, ai.user_id AS agent_user_id, r.name AS resource_name, m.member_resource_id
    FROM workforce_team_memberships m LEFT JOIN agent_identities ai ON ai.workforce_resource_id = m.member_resource_id
    LEFT JOIN workforce_resources r ON r.id = m.member_resource_id
    WHERE m.team_id = ANY($1::uuid[]) AND m.state='active' ORDER BY m.created_at, m.id`, [teams.map((t) => t.id)])).rows : [];
  const memberships = [], unnamed = new Map();
  for (const m of memRows) {
    const principalId = m.member_principal_id || m.agent_user_id || (m.member_resource_id ? `res:${m.member_resource_id}` : null);
    if (!principalId) continue;   // an erased member leaves an empty desk, never a name
    if (principalId.startsWith('res:')) unnamed.set(principalId, m.resource_name || 'Agent');
    memberships.push({ id: m.id, teamId: m.team_id, principalId, role: m.role });
  }
  // a personal workspace's own agents sit at desks in its building (projection only: no team or membership row)
  if (place.workspace_type === 'personal') {
    const seated = new Set(memberships.map((m) => m.principalId));
    const mine = (await db.query(`SELECT user_id FROM agent_identities WHERE owner_user_id=$1 ORDER BY created_at, user_id`, [place.owner_user_id])).rows.map((r) => r.user_id);
    const own = [place.owner_user_id, ...mine].filter((id) => !seated.has(id));
    if (own.length) {
      const teamId = `desks:${place.workspace_id}`;
      teams.push({ id: teamId, name: 'Desks', owningDivisionId: null, assignedDivisionIds: [], projection: true });
      own.forEach((id, i) => memberships.push({ id: `desk:${id}`, teamId, principalId: id, role: i === 0 && id === place.owner_user_id ? 'manager' : 'worker', projection: true }));
    }
  }
  const pids = [...new Set([...memberships.map((m) => m.principalId).filter((x) => !x.startsWith('res:')), ...shown.map((d) => d.head_principal_id).filter(Boolean)])];
  const principals = pids.length ? (await db.query(`SELECT u.id, COALESCE(NULLIF(u.display_name,''), u.username, 'Someone') AS name,
      EXISTS (SELECT 1 FROM agent_identities ai WHERE ai.user_id = u.id) AS is_agent FROM users u WHERE u.id = ANY($1::uuid[])`, [pids])).rows
    .map((u) => ({ id: u.id, displayName: u.name, isAgent: u.is_agent })) : [];
  for (const [id, name] of unnamed) principals.push({ id, displayName: name, isAgent: true });
  if (!principals.some((p) => p.id === me.id)) principals.push({ id: me.id, displayName: me.name || 'You', isAgent: me.kind === 'agent' });

  // monitors: live hosted runs of the agents at these desks. A run's TITLE is its task's, shown only to the run's
  // owner or a building admin — everyone else sees that the desk is busy, not what with.
  const agentIds = principals.filter((p) => p.isAgent && UUID.test(p.id)).map((p) => p.id);
  const runRows = agentIds.length ? (await db.query(`SELECT r.id, r.agent_user_id, r.owner_user_id, r.state, t.title FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id
    WHERE r.agent_user_id = ANY($1::uuid[]) AND r.state IN ('starting','queued','running') ORDER BY r.created_at`, [agentIds])).rows : [];
  const firstDesk = new Map(); for (const m of memberships) if (!firstDesk.has(m.principalId)) firstDesk.set(m.principalId, m.id);
  const admin = access.permissions.includes('edit');
  const runs = runRows.map((r) => ({ id: r.id, principalId: r.agent_user_id, membershipId: firstDesk.get(r.agent_user_id) || null,
    title: admin || r.owner_user_id === me.id ? r.title : '', status: RUN_STATUS[r.state] }));

  return {
    schemaVersion: 1, seq: 0,
    building: { workspaceId: place.workspace_id, name: place.name, workspaceType: place.workspace_type },
    viewer: { principalId: me.id, scope: { divisionIds: access.scope === 'all' ? 'all' : shown.map((d) => d.id) } },
    divisions: shown.map((d, i) => ({ id: d.id, key: d.key, name: d.name, parentDivisionId: d.parent_division_id, headPrincipalId: d.head_principal_id, lifecycle: 'active', sortHint: i + 1 })),
    teams, memberships, principals, runs, handoffs: [], closedDivisionIds,
  };
}

function summary(p, access, snap) {
  const NEEDS = new Set(['blocked', 'waiting_for_user', 'waiting_for_permission']);
  const floors = [{ name: 'Lobby', desks: 0, lit: 0 }];
  if (snap) {
    const teamDiv = Object.fromEntries(snap.teams.map((t) => [t.id, t.owningDivisionId]));
    floors[0].desks = snap.memberships.filter((m) => !teamDiv[m.teamId]).length;
    for (const d of snap.divisions.filter((x) => !x.parentDivisionId)) floors.push({ name: d.name, desks: snap.memberships.filter((m) => teamDiv[m.teamId] === d.id).length, lit: 0 });
    for (const id of snap.closedDivisionIds) floors.push({ name: null, closed: true, id });
  }
  const agents = snap ? new Set(snap.principals.filter((x) => x.isAgent).map((x) => x.id)) : new Set();
  const staffed = snap ? new Set(snap.memberships.map((m) => m.principalId)) : new Set();
  return {
    id: p.id, name: p.name, workspaceId: p.workspace_id, workspaceName: p.workspace_name, workspaceType: p.workspace_type,
    style: p.style, bays: p.bays, plot: { cityId: p.city_id, regionId: p.region_id, index: p.plot_index, source: p.location_source },
    visibility: p.visibility, lifecycle: p.lifecycle, revision: Number(p.layout_revision), placeRevision: Number(p.revision),
    createdAt: p.created_at, openedAt: p.opened_at, access, floors,
    counts: snap ? { floors: snap.divisions.filter((d) => !d.parentDivisionId).length + snap.closedDivisionIds.length, teams: snap.teams.length,
      agents: [...agents].filter((x) => staffed.has(x)).length, humans: snap.principals.filter((x) => !x.isAgent && staffed.has(x.id)).length,
      working: snap.runs.length, needs: snap.runs.filter((r) => NEEDS.has(r.status)).length } : null,
  };
}

// The record shape is the place model's own (xeno-places src/logic/model.ts buildLayout): pods[teamId] = { x0, zc },
// fixtures[floorKey] = extra fixtures, removed[floorKey] = ids of built-in fixtures taken away. floorKey = a division
// id or 'lobby'. All of it is coordinates and furniture; none of it says who belongs where.
const record = (p) => ({ style: p.style, bays: p.bays, slots: p.layout.slots || {}, pods: p.layout.pods || {}, fixtures: p.layout.fixtures || {}, removed: p.layout.removed || {} });

// ── layout validation: coordinates only ─────────────────────────────────────────────────────────────────────────
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4;
const FIXTURE_KEYS = ['id', 'kind', 'label', 'x', 'z', 'w', 'd', 'h', 'rot'];
const badFixture = (f) => !f || typeof f !== 'object' || typeof f.kind !== 'string' || !/^[a-z-]{1,24}$/.test(f.kind)
  || !num(f.x) || !num(f.z) || ['w', 'd', 'h', 'rot'].some((k) => f[k] != null && !num(f[k]))
  || (f.label != null && (typeof f.label !== 'string' || f.label.length > 40)) || (f.id != null && (typeof f.id !== 'string' || f.id.length > 40))
  || Object.keys(f).some((k) => !FIXTURE_KEYS.includes(k));
const floorKeyed = (o, each) => typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length <= 64
  && Object.entries(o).every(([k, list]) => /^(lobby|[0-9a-f-]{36})$/.test(k) && Array.isArray(list) && list.length <= 100 && list.every(each));
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) fail('bad_input', 'layout_required', 'Missing layout.');
  const extra = Object.keys(layout).filter((k) => !['bays', 'style', 'slots', 'pods', 'fixtures', 'removed'].includes(k));
  if (extra.length) fail('bad_input', 'layout_not_coordinates', `A layout holds coordinates only; remove: ${extra.slice(0, 5).join(', ')}.`);
  const bays = layout.bays == null ? 4 : layout.bays;
  if (!Number.isInteger(bays) || bays < 4 || bays > 8) fail('bad_input', 'bays_out_of_range', 'Bays are 4 to 8.');
  if (layout.style != null && !STYLES.includes(layout.style)) fail('bad_input', 'style_unknown', 'Unknown style.');
  const slots = layout.slots || {}, pods = layout.pods || {}, fixtures = layout.fixtures || {}, removed = layout.removed || {};
  if (typeof slots !== 'object' || Array.isArray(slots) || Object.keys(slots).length > 2000 || Object.values(slots).some((v) => !Number.isInteger(v) || v < 0 || v > 64)) fail('bad_input', 'slots_invalid', 'Desk slots are whole numbers per membership.');
  if (typeof pods !== 'object' || Array.isArray(pods) || Object.keys(pods).length > 500 || Object.values(pods).some((v) => !v || typeof v !== 'object' || !num(v.x0) || !num(v.zc) || Object.keys(v).some((k) => !['x0', 'zc'].includes(k)))) fail('bad_input', 'pods_invalid', 'A pod position is { x0, zc } in metres.');
  if (!floorKeyed(fixtures, (f) => !badFixture(f))) fail('bad_input', 'fixtures_invalid', 'Fixtures are per floor: { kind, x, z, w?, d?, h?, rot?, label?, id? }.');
  if (!floorKeyed(removed, (id) => typeof id === 'string' && id.length <= 40)) fail('bad_input', 'removed_invalid', 'Removed fixtures are ids per floor.');
  return { bays, style: layout.style || null, layout: { slots, pods, fixtures, removed } };
}

const code = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(8); return [...b].map((x, i) => a[x % a.length] + (i === 3 ? '-' : '')).join(''); };

// ── operations ──────────────────────────────────────────────────────────────────────────────────────────────────
const READS = {
  'catalog.get': async () => ({ STYLES: STYLES.map((id) => ({ id })), TEMPLATES: [{ id: 'empty', name: 'Empty lobby', divisions: [] }], CR: 1_000_000 }),
  'account.get': async (db, me) => ({ id: me.id, principalId: me.id, name: me.name, kind: me.kind }),
  'places.list': async (db, me) => {
    const rows = (await db.query(`SELECT DISTINCT p.id FROM places p WHERE p.lifecycle='active' AND (
        p.workspace_id::text IN (SELECT object_id FROM relationship_tuples WHERE object_type='workspace' AND subject_type='user' AND subject_id=$1)
        OR p.id IN (SELECT s.place_id FROM place_hosted_sessions s JOIN place_session_guests g ON g.session_id=s.id WHERE g.user_id=$2 AND s.state='live' AND s.ends_at>now())
        OR ($3 AND p.workspace_id IN (SELECT w.id FROM workspaces w JOIN agent_identities ai ON ai.owner_user_id = w.owner_user_id WHERE ai.user_id=$2 AND w.workspace_type='personal')))`,
    [String(me.id), me.id, me.kind === 'agent'])).rows;
    const items = [];
    for (const { id } of rows) {
      const p = await loadPlace(db, id); const a = await accessFor(db, me, p); if (!a) continue;
      items.push(summary(p, a, await buildSnapshot(db, me, p, a)));
    }
    items.sort((x, y) => (new Date(y.openedAt || y.createdAt)) - (new Date(x.openedAt || x.createdAt)));
    return { items };
  },
  'places.get': async (db, me, i) => {
    const p = await loadPlace(db, i.placeId); const a = await accessFor(db, me, p);
    if (!a) fail('denied', 'no_access', 'You are not a member of this workspace and have no guest pass.');
    const snap = await buildSnapshot(db, me, p, a);
    return { place: summary(p, a, snap), spec: { snap, record: record(p) }, access: a, campus: [] };
  },
  'workspaces.list': async (db, me) => {
    const rows = (await db.query(`SELECT w.id, w.name, w.workspace_type, t.relation, p.id AS place_id FROM workspaces w
      JOIN relationship_tuples t ON t.object_type='workspace' AND t.object_id=w.id::text AND t.subject_type='user' AND t.subject_id=$1
      LEFT JOIN places p ON p.workspace_id = w.id AND p.lifecycle='active' WHERE w.status='active' ORDER BY w.created_at`, [String(me.id)])).rows;
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.id) || ['owner', 'admin'].includes(r.relation)) seen.set(r.id, { id: r.id, name: r.name, type: r.workspace_type, role: ['owner', 'admin'].includes(r.relation) ? r.relation : 'member', placeId: r.place_id });
    return { items: [...seen.values()] };
  },
  'sessions.list': async (db, me) => ({ items: (await db.query(`SELECT s.id, s.place_id, p.name AS place_name, s.audience, s.permissions, s.floors, s.title, s.started_at, s.ends_at,
      (s.host_principal_id = $1) AS host_is_me, CASE WHEN s.host_principal_id = $1 THEN s.code END AS code
      FROM place_hosted_sessions s JOIN places p ON p.id = s.place_id WHERE s.state='live' AND s.ends_at>now()
      AND (s.host_principal_id=$1 OR s.audience='public' OR $1 = ANY(s.invitees) OR EXISTS (SELECT 1 FROM place_session_guests g WHERE g.session_id=s.id AND g.user_id=$1))`, [me.id])).rows
    .map((s) => ({ id: s.id, placeId: s.place_id, placeName: s.place_name, audience: s.audience, permissions: s.permissions, floors: s.floors || 'all', title: s.title, startedAt: s.started_at, endsAt: s.ends_at, hostIsMe: s.host_is_me, code: s.code })) }),
};

const WRITES = {
  'places.layout.save': async (c, me, i) => {
    const p = await loadPlace(c, i.placeId, { lock: true }); const a = await accessFor(c, me, p);
    if (!a || !a.permissions.includes('edit')) fail('denied', 'no_edit', 'Only the workspace’s owners and admins edit the layout.');
    if (i.expectedRevision == null || String(i.expectedRevision) !== String(p.layout_revision)) fail('conflict', 'stale_revision', 'Someone else changed this building. Reload to see their edit.');
    const v = validateLayout(i.layout);
    const row = (await c.query(`UPDATE place_layouts SET bays=$2, layout=$3, revision=revision+1, updated_by_user_id=$4, updated_at=now() WHERE place_id=$1 RETURNING revision`,
      [p.id, v.bays, JSON.stringify(v.layout), me.id])).rows[0];
    if (v.style && v.style !== p.style) await c.query('UPDATE places SET style=$2, revision=revision+1 WHERE id=$1', [p.id, v.style]);
    return { result: { placeId: p.id, placeRevision: Number(row.revision) }, revision: row.revision, summary: `Saved layout · ${p.name}` };
  },
  'places.create': async (c, me, i) => {
    const w = uuid(i.workspaceId, 'workspaceId');
    const rel = await workspaceRelation(c, me, w);
    if (me.kind === 'agent' || !['owner', 'admin'].includes(rel)) fail('denied', 'not_admin', 'Only owners and admins create the building for a workspace.');
    if ((await c.query(`SELECT 1 FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows.length) fail('conflict', 'place_exists', 'This workspace already has a building. One building per workspace.');
    const id = (await c.query('SELECT places_provision($1) AS id', [w])).rows[0].id;
    if (!id) fail('not_found', 'workspace_not_found', 'No such workspace.');
    return { result: { placeId: id, workspaceId: w, divisionsCreated: 0 }, revision: 1, summary: 'Building recreated' };
  },
  // Move a building to another XENO city (e.g. it was placed on the default city before a location was known).
  // Owner/admin only, receipt + requestId fence like every write. A relocated building is never moved again by the backfill.
  'places.relocate': async (c, me, i) => {
    const p = await loadPlace(c, i.placeId, { lock: true });
    if (me.kind === 'agent' || !['owner', 'admin'].includes(await workspaceRelation(c, me, p.workspace_id))) fail('denied', 'not_admin', 'Only the workspace’s owners and admins move its building.');
    const cityId = String(i.cityId || '');
    const region = (await c.query('SELECT places_region_of_city($1) AS r', [cityId])).rows[0].r;
    if (!region) fail('bad_input', 'city_unknown', 'That is not a XENO city.');
    if (cityId === p.city_id) return { result: { placeId: p.id, cityId, moved: false }, revision: Number(p.revision), summary: `${p.name} already stands in ${cityId}` };
    await moveTo(c, p.id, cityId, region, 'relocated');
    return { result: { placeId: p.id, cityId, regionId: region, from: p.city_id, moved: true }, revision: Number(p.revision) + 1, summary: `Moved ${p.name} to ${cityId}` };
  },
  'places.archive': async (c, me, i) => {
    const p = await loadPlace(c, i.placeId, { lock: true });
    if (me.kind === 'agent' || (await workspaceRelation(c, me, p.workspace_id)) !== 'owner') fail('denied', 'not_owner', 'Only the workspace owner archives its building.');
    await c.query(`UPDATE places SET lifecycle='archived', archived_at=now(), revision=revision+1 WHERE id=$1`, [p.id]);
    await c.query(`UPDATE place_hosted_sessions SET state='ended', ended_at=now() WHERE place_id=$1 AND state='live'`, [p.id]);
    return { result: { placeId: p.id }, revision: Number(p.revision) + 1, summary: `Archived ${p.name}` };
  },
  'sessions.host': async (c, me, i) => {
    const p = await loadPlace(c, i.placeId, { lock: true }); const a = await accessFor(c, me, p);
    if (!a || !a.permissions.includes('host')) fail('denied', 'no_host', 'Only owners and admins host a session.');
    const perms = Array.isArray(i.permissions) && i.permissions.length ? [...new Set(i.permissions)] : ['watch'];
    if (perms.some((x) => !MEMBER_PERMS.includes(x))) fail('bad_input', 'permission_not_grantable', 'A session grants only watch, talk and handoff.');
    if (!perms.includes('watch')) perms.unshift('watch');
    if (!['invite', 'code', 'public'].includes(i.audience || 'code')) fail('bad_input', 'audience_unknown', 'Audience is invite, code or public.');
    if ((i.audience || 'code') === 'public' && p.visibility !== 'public') fail('denied', 'public_not_allowed', 'Only a public place can host a public session.');
    let floors = null;
    if (i.floors && i.floors !== 'all') {
      if (!Array.isArray(i.floors) || !i.floors.length) fail('bad_input', 'floors_invalid', 'Floors are "all" or division ids.');
      const ids = i.floors.map((f) => uuid(f, 'floor'));
      const ok = (await c.query(`SELECT count(*)::int n FROM workforce_divisions WHERE workspace_id=$1 AND id = ANY($2::uuid[]) AND lifecycle='active'`, [p.workspace_id, ids])).rows[0].n;
      if (ok !== new Set(ids).size) fail('bad_input', 'floor_not_in_place', 'A floor is not a division of this building.');
      floors = [...new Set(ids)];
    }
    const minutes = Math.max(5, Math.min(24 * 60, Number(i.durationMin) || 60));
    const invitees = (Array.isArray(i.invitees) ? i.invitees : []).slice(0, 50).map((x) => uuid(x, 'invitee'));
    const s = (await c.query(`INSERT INTO place_hosted_sessions (place_id, host_principal_id, code, audience, invitees, permissions, floors, title, ends_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' minutes')::interval) RETURNING id, code, ends_at`,
    [p.id, me.id, code(), i.audience || 'code', invitees, perms, floors, String(i.title || '').slice(0, 120), String(minutes)])).rows[0];
    return { result: { session: { id: s.id, placeId: p.id, permissions: perms, floors: floors || 'all', endsAt: s.ends_at }, code: s.code }, revision: 1, summary: `Hosting ${p.name}` };
  },
  'sessions.join': async (c, me, i) => {
    const raw = String(i.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const s = (await c.query(`SELECT * FROM place_hosted_sessions WHERE ${i.sessionId ? 'id=$1' : 'code=$1'} FOR UPDATE`, [i.sessionId ? uuid(i.sessionId, 'sessionId') : raw])).rows[0];
    if (!s || s.state !== 'live') fail('not_found', 'code_unknown', 'That code does not match a live session.');
    if (new Date(s.ends_at) <= new Date()) fail('not_found', 'session_ended', 'That session has ended.');
    if (s.audience === 'invite' && !s.invitees.includes(me.id)) fail('denied', 'not_invited', 'This session is by invitation.');
    if (s.audience === 'code' && !i.code) fail('denied', 'code_required', 'Join with the session code.');
    await c.query('INSERT INTO place_session_guests (session_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, me.id]);
    return { result: { placeId: s.place_id, sessionId: s.id, permissions: s.permissions }, revision: 1, summary: 'Joined' };
  },
  'sessions.end': async (c, me, i) => {
    const s = (await c.query('SELECT * FROM place_hosted_sessions WHERE id=$1 FOR UPDATE', [uuid(i.sessionId, 'sessionId')])).rows[0];
    if (!s) fail('not_found', 'session_not_found', 'No such session.');
    if (s.host_principal_id !== me.id) fail('denied', 'not_host', 'Only the host ends a session.');
    await c.query(`UPDATE place_hosted_sessions SET state='ended', ended_at=COALESCE(ended_at, now()) WHERE id=$1`, [s.id]);
    return { result: { sessionId: s.id }, revision: 2, summary: 'Session ended' };
  },
};
export const OPS = Object.freeze([...Object.keys(READS), ...Object.keys(WRITES), 'places.opened']);

/** THE entry point. Never throws: every outcome is the contract envelope. */
export async function call(db, me, op, input = {}) {
  try {
    if (!me || !UUID.test(String(me.id))) fail('denied', 'not_signed_in', 'Sign in to use Places.');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('bad_input', 'input_not_object', 'Input must be an object.');
    if (READS[op]) return { ok: true, result: await READS[op](db, me, input) };
    if (op === 'places.opened') {
      const p = await loadPlace(db, input.placeId); if (!(await accessFor(db, me, p))) fail('denied', 'no_access', 'No access.');
      await db.query('UPDATE places SET opened_at=now() WHERE id=$1', [p.id]); return { ok: true, result: {} };
    }
    if (WRITES[op]) { const { result, receipt } = await mutate(db, me, op, input, (c) => WRITES[op](c, me, input)); return { ok: true, result, receipt }; }
    fail('not_found', 'op_unknown', `Unknown operation ${String(op).slice(0, 60)}.`);
  } catch (e) {
    if (e instanceof PlaceError) return { ok: false, error: { code: e.code, reason: e.reason, message: e.message } };
    console.error('[places]', op, e);
    return { ok: false, error: { code: 'internal', reason: 'unexpected', message: 'Places failed on this call. Nothing else is affected.' } };
  }
}
export const httpStatus = (reply) => (reply.ok ? 200 : STATUS[reply.error.code] || 500);

/**
 * The backfill (dry run by default): every active workspace without an active building, and where it would stand —
 * plus every building still on the DEFAULT city whose owner now has a better source (their own setting, a time zone or
 * a sign-in country), which is moved there. A building someone relocated by hand is never touched. Idempotent.
 */
export async function backfillPlan(db) {
  const rows = (await db.query(`SELECT w.id, (places_home_city(w.owner_user_id)).* FROM workspaces w
    WHERE w.status='active' AND NOT EXISTS (SELECT 1 FROM places p WHERE p.workspace_id=w.id AND p.lifecycle='active')`)).rows;
  const moves = (await db.query(`SELECT p.id, h.city_id, h.region_id, h.source FROM places p JOIN workspaces w ON w.id=p.workspace_id
    CROSS JOIN LATERAL places_home_city(w.owner_user_id) h
    WHERE p.lifecycle='active' AND p.location_source='default' AND h.source <> 'default'`)).rows;
  const by = (list, k) => list.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] || 0) + 1 }), {});
  return { missing: rows.length, byCity: by(rows, 'city_id'), bySource: by(rows, 'source'), workspaceIds: rows.map((r) => r.id),
    toRelocate: moves.length, relocateByCity: by(moves, 'city_id'), relocateBySource: by(moves, 'source'), relocations: moves };
}
export async function backfill(db) {
  const plan = await backfillPlan(db);
  let created = 0, relocated = 0;
  for (const id of plan.workspaceIds) await tx(db, async (c) => { const before = (await c.query(`SELECT 1 FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [id])).rows.length; await c.query('SELECT places_provision($1)', [id]); if (!before) created++; });
  for (const m of plan.relocations) await tx(db, async (c) => {
    const still = (await c.query(`SELECT 1 FROM places WHERE id=$1 AND lifecycle='active' AND location_source='default' FOR UPDATE`, [m.id])).rows.length;
    if (still) { await moveTo(c, m.id, m.city_id, m.region_id, m.source); relocated++; }
  });
  return { ...plan, created, relocated };
}

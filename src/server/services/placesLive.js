/**
 * XENO Places — the LIVE half: what the building shows changing in real time.
 *
 *   frame(db, me, placeId)        → the scoped snapshot + occupant status + presence + needs-you, one object
 *   diffFrames(prev, next)        → the events the SSE stream sends ([] when nothing changed)
 *   beat(db, me, placeId, where)  → ephemeral presence (who is in the building and on which floor), TTL 45 s
 *   needsYou(db, me)              → server-side projection across every place the viewer can open
 *
 * There is NO second store. Every frame is rebuilt from the records Places already reads (workforce divisions/teams/
 * memberships, agent_cloud_runs, tasks) through buildSnapshot, which is scope-filtered — so a closed floor never
 * reaches a viewer's stream because it never reaches their snapshot. Presence is the one thing Places owns here,
 * and it is ephemeral by design: in memory, per process, expiring; restarting the server empties the building.
 */
import * as places from './places.js';

export const PRESENCE_TTL_MS = 45_000;
const presence = new Map();   // placeId → Map(principalId → { floorKey, at })

const floorKeyOk = (k) => k === 'lobby' || /^[0-9a-f-]{36}$/i.test(String(k));

async function open(db, me, placeId) {
  const r = await places.call(db, me, 'places.get', { placeId });
  if (!r.ok) return r;
  return { ok: true, snap: r.result.spec.snap, access: r.result.access };
}

function livePresence(placeId, now = Date.now()) {
  const m = presence.get(placeId); if (!m) return [];
  const out = [];
  for (const [pid, v] of m) { if (now - v.at > PRESENCE_TTL_MS) m.delete(pid); else out.push({ principalId: pid, floorKey: v.floorKey }); }
  return out;
}

/** Record that the viewer is in this place, on a floor THEY can see. Never writes the database. */
export async function beat(db, me, placeId, { floorKey = 'lobby' } = {}) {
  if (!floorKeyOk(floorKey)) return { ok: false, error: { code: 'bad_input', reason: 'floor_key_invalid', message: 'floorKey is "lobby" or a division id.' } };
  const o = await open(db, me, placeId); if (!o.ok) return o;
  if (floorKey !== 'lobby' && !o.snap.divisions.some((d) => d.id === floorKey)) {
    return { ok: false, error: { code: 'denied', reason: 'floor_closed', message: 'That floor is not open to you.' } };
  }
  if (!presence.has(placeId)) presence.set(placeId, new Map());
  presence.get(placeId).set(me.id, { floorKey, at: Date.now() });
  return { ok: true, result: { ttlMs: PRESENCE_TTL_MS } };
}
export function leave(placeId, principalId) { presence.get(placeId)?.delete(principalId); }
export function _resetPresence() { presence.clear(); }

/**
 * Occupant status, derived: needs-you (a task of theirs awaits the viewer's review, or is blocked) > blocked > working
 * (a live run, or a task in progress) > idle. The task label is shown under the same rule as a run title: to the
 * task's own people or a building admin; everyone else sees the status, not the work.
 */
async function occupants(db, me, snap, admin) {
  const ids = snap.principals.map((p) => p.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = ids.length ? (await db.query(`SELECT id, number, title, status, assignee_id, reviewer_id, owner_user_id FROM tasks
    WHERE assignee_id = ANY($1::uuid[]) AND status IN ('in_progress','blocked','in_review') ORDER BY updated_at DESC`, [ids])).rows : [];
  const running = new Set(snap.runs.map((r) => r.principalId));
  const out = {};
  for (const p of snap.principals) {
    const mine = rows.filter((t) => t.assignee_id === p.id);
    const t = mine.find((x) => x.status === 'in_review' && x.reviewer_id === me.id) || mine.find((x) => x.status === 'blocked') || mine[0] || null;
    let status = 'idle';
    if (t && t.status === 'in_review' && t.reviewer_id === me.id) status = 'needs-you';
    else if (t && t.status === 'blocked') status = 'blocked';
    else if (running.has(p.id) || (t && t.status === 'in_progress')) status = 'working';
    const see = t && (admin || [t.assignee_id, t.reviewer_id, t.owner_user_id].includes(me.id));
    out[p.id] = { status, task: t ? { id: t.id, key: `T-${t.number}`, label: see ? t.title : '', status: t.status } : null };
  }
  return out;
}

export async function frame(db, me, placeId) {
  const o = await open(db, me, placeId); if (!o.ok) return o;
  const { snap, access } = o;
  const admin = access.permissions.includes('edit');
  const shown = new Set(['lobby', ...snap.divisions.map((d) => d.id)]);
  const known = new Set(snap.principals.map((p) => p.id));
  return {
    ok: true,
    result: {
      divisions: snap.divisions.map((d) => ({ id: d.id, name: d.name })),
      closedDivisionIds: snap.closedDivisionIds,
      runs: snap.runs,
      handoffs: snap.handoffs || [],
      occupants: await occupants(db, me, snap, admin),
      // presence on a floor the viewer cannot see is dropped, and so is a stranger's (only people in this snapshot)
      presence: livePresence(placeId).filter((x) => shown.has(x.floorKey) && (known.has(x.principalId) || x.principalId === me.id)),
    },
  };
}

const key = (x) => JSON.stringify(x);
/** The events between two frames. Each is { type, ... } and carries only what is in the NEXT (scoped) frame. */
export function diffFrames(prev, next) {
  const ev = [];
  if (!prev) return [{ type: 'snapshot', frame: next }];
  const byId = (list) => new Map(list.map((r) => [r.id, r]));
  const pr = byId(prev.runs), nr = byId(next.runs);
  for (const [id, r] of nr) if (!pr.has(id) || key(pr.get(id)) !== key(r)) ev.push({ type: 'run', run: r });
  for (const id of pr.keys()) if (!nr.has(id)) ev.push({ type: 'run.ended', runId: id });
  for (const [pid, o] of Object.entries(next.occupants)) if (key(prev.occupants[pid]) !== key(o)) ev.push({ type: 'occupant', principalId: pid, ...o });
  if (key(prev.presence) !== key(next.presence)) ev.push({ type: 'presence', presence: next.presence });
  if (key(prev.handoffs || []) !== key(next.handoffs || [])) ev.push({ type: 'handoffs', handoffs: next.handoffs || [] });
  if (key(prev.divisions) !== key(next.divisions) || key(prev.closedDivisionIds) !== key(next.closedDivisionIds)) ev.push({ type: 'structure', frame: next });
  return ev;
}

/**
 * Needs-you, across every place: tasks awaiting the viewer's review, and blocked tasks of the viewer or of agents
 * they own. Actions are the EXISTING Tasks commands (the receipts are theirs) — Places adds no write path.
 */
export async function needsYou(db, me) {
  const rows = (await db.query(`SELECT t.id, t.number, t.title, t.status, t.assignee_id, t.reviewer_id,
      COALESCE(NULLIF(u.display_name,''), u.username) AS assignee_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE (t.status='in_review' AND t.reviewer_id=$1)
       OR (t.status='blocked' AND (t.assignee_id=$1 OR t.assignee_id IN (SELECT user_id FROM agent_identities WHERE owner_user_id=$1)))
    ORDER BY t.updated_at DESC LIMIT 100`, [me.id])).rows;
  return {
    ok: true,
    result: {
      items: rows.map((t) => ({
        taskId: t.id, key: `T-${t.number}`, title: t.title, status: t.status, why: t.status === 'in_review' ? 'review' : 'blocked',
        assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null,
        actions: t.status === 'in_review' ? ['approve', 'request_changes', 'talk'] : ['talk', 'hand_off'],
        commands: { approve: { tool: 'move_task', to: 'done' }, request_changes: { tool: 'move_task', to: 'in_progress' }, hand_off: { tool: 'update_task', field: 'assignee' }, talk: { tool: 'comment' } },
      })),
    },
  };
}

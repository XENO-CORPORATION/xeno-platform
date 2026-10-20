/**
 * The workforce half of a mode pack (owner, 2026-10-20: a pack — and the workspace architect's proposal — creates the
 * whole workspace, not only a mode and tasks). Every record is made by its EXISTING service, inside modeApply's one
 * transaction, and listed on the receipt so revert can undo it:
 *
 *   divisions   workforceDivisions.create           (parent by key)                  revert: archive unless a person changed it
 *   agents      platformAgents.create               (a company owns it, the applier is the accountable human)
 *                                                                                      revert: retire unless a person changed it
 *   projects    chatProjectAuthority.createAuthorizedProject (+ workforceDivisions.setProjectDivision)
 *                                                                                      revert: archive when no live task is left
 *   teams       workspaceTeams.saveWorkspaceTeam    (members = pack agents by key)   revert: archive unless a person changed it
 *   objectives  projectWorktree.createObjective     (division by key)                revert: delete unless changed or linked
 *   goals       projectWorktree.createGoal (+ linkGoalToObjective)                   kept with their project
 *   places      places 'places.layout.save'         (style / bays only)              revert: the previous layout, if untouched
 *
 * Every field is OPTIONAL, so a pack without them (salon, club, photographer, every published listing) is exactly
 * what it was. Nothing here can grant a role or add a member: the only principals created are new agents, owned as
 * platformAgents decides, and applying stays a human admin's confirmed act (modeApply.humanOnly + confirm).
 */
import crypto from 'node:crypto';
import * as divisions from './workforceDivisions.js';
import * as agents from './platformAgents.js';
import { saveWorkspaceTeam } from './workspaceTeams.js';
import { createObjective, createGoal, linkGoalToObjective } from './projectWorktree.js';
import { createAuthorizedProject } from './chatProjectAuthority.js';
import * as places from './places.js';

const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LIMIT = 30;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const keyOf = (v, i, prefix) => { const k = String(v ?? '').toLowerCase().trim(); return KEY.test(k) ? k : `${prefix}-${i + 1}`; };

/** The workforce part of a pack, normalised. Unknown fields are dropped; references are by key within the pack. */
export function normalise(pack, fail) {
  const list = (k) => (Array.isArray(pack?.[k]) ? pack[k].slice(0, LIMIT) : []);
  const out = {
    divisions: list('divisions').map((d, i) => ({ key: keyOf(d.key || d.name, i, 'division'), name: str(d.name, 200), parent: d.parent ? String(d.parent) : null })).filter((d) => d.name),
    agents: list('agents').map((a, i) => ({ key: keyOf(a.key || a.name, i, 'agent'), name: str(a.name, 60), description: str(a.description || a.role, 500), instructions: str(a.instructions, 8000), division: a.division ? String(a.division) : null })).filter((a) => a.name),
    projects: list('projects').map((p, i) => ({ key: keyOf(p.key || p.name, i, 'project'), name: str(p.name, 200), description: str(p.description || p.goal, 2000), division: p.division ? String(p.division) : null })).filter((p) => p.name),
    teams: list('teams').map((t, i) => ({ key: keyOf(t.key || t.name, i, 'team'), name: str(t.name, 120), description: str(t.description || t.purpose, 2000), agents: Array.isArray(t.agents) ? t.agents.map(String).slice(0, 50) : [] })).filter((t) => t.name),
    objectives: list('objectives').map((o, i) => ({ key: keyOf(o.key || o.title, i, 'objective'), title: str(o.title, 200), successEvidence: str(o.successEvidence || o.measure, 2000) || 'Agreed by the workspace admin', division: o.division ? String(o.division) : null, windowDays: Math.min(Math.max(Number(o.windowDays) || 90, 1), 730) })).filter((o) => o.title),
    goals: list('goals').map((g) => ({ title: str(g.title, 200), successEvidence: str(g.successEvidence || g.measure, 2000) || 'Done when the team agrees', project: g.project ? String(g.project) : null, objective: g.objective ? String(g.objective) : null })).filter((g) => g.title && g.project),
    places: pack?.places && typeof pack.places === 'object' && !Array.isArray(pack.places)
      ? { ...(pack.places.style ? { style: String(pack.places.style) } : {}), ...(Number.isInteger(pack.places.bays) ? { bays: pack.places.bays } : {}) } : null,
  };
  if (out.places && !Object.keys(out.places).length) out.places = null;
  const keys = (k) => new Set(out[k].map((x) => x.key));
  const dk = keys('divisions'), ak = keys('agents'), pk = keys('projects'), ok = keys('objectives');
  for (const [k, v] of Object.entries({ divisions: dk, agents: ak, projects: pk, teams: keys('teams'), objectives: ok })) if (v.size !== out[k].length) fail(`Two ${k} in this setup share a key`, 'duplicate_key');
  const ref = (set, v, what) => { if (v && !set.has(v)) fail(`A ${what} named "${v}" is not in this setup`, 'unknown_reference'); };
  out.divisions.forEach((d) => { ref(dk, d.parent, 'division'); if (d.parent === d.key) fail('A division cannot sit inside itself', 'unknown_reference'); });
  out.agents.forEach((a) => ref(dk, a.division, 'division'));
  out.projects.forEach((p) => ref(dk, p.division, 'division'));
  out.teams.forEach((t) => t.agents.forEach((a) => ref(ak, a, 'agent')));
  out.objectives.forEach((o) => ref(dk, o.division, 'division'));
  out.goals.forEach((g) => { ref(pk, g.project, 'project'); ref(ok, g.objective, 'objective'); });
  // parents before children (a key referring to a later one is fine; ordering is ours)
  const ordered = [], placed = new Set();
  for (let pass = 0; pass <= out.divisions.length && ordered.length < out.divisions.length; pass++) {
    for (const d of out.divisions) if (!placed.has(d.key) && (!d.parent || placed.has(d.parent))) { ordered.push(d); placed.add(d.key); }
  }
  if (ordered.length !== out.divisions.length) fail('Those divisions sit inside each other in a circle', 'unknown_reference');
  out.divisions = ordered;
  return out;
}

export const hasAny = (w) => !!(w.divisions.length || w.agents.length || w.projects.length || w.teams.length || w.objectives.length || w.goals.length || w.places);

/** What plan shows. */
export function planRecords(w) {
  return [
    ...w.divisions.map((d) => ({ type: 'division', key: d.key, name: d.name, parent: d.parent })),
    ...w.agents.map((a) => ({ type: 'agent', key: a.key, name: a.name, division: a.division })),
    ...w.projects.map((p) => ({ type: 'project', key: p.key, name: p.name, division: p.division })),
    ...w.teams.map((t) => ({ type: 'team', key: t.key, name: t.name, agents: t.agents })),
    ...w.objectives.map((o) => ({ type: 'objective', key: o.key, title: o.title, division: o.division })),
    ...w.goals.map((g) => ({ type: 'goal', title: g.title, project: g.project, objective: g.objective })),
    ...(w.places ? [{ type: 'places', ...w.places }] : []),
  ];
}

const svcFail = (e) => { const err = new Error(e.message || 'This setup could not be applied'); err.code = e.code || e.reason || 'apply_failed'; err.status = e.status && e.status < 500 ? e.status : 409; err.modeError = true; throw err; };
const day = (d) => d.toISOString().slice(0, 10);

/**
 * Create the workforce records. `db` is modeApply's transaction (BEGIN/COMMIT made no-ops so each service joins it).
 * Returns { created, projectsByKey } — the receipt entries and the pack-project ids for tasks with `project`.
 */
export async function apply(db, { me, workspaceId, w, created }) {
  const ids = { division: {}, agent: {}, agentUser: {}, project: {}, objective: {} };
  try {
    for (const d of w.divisions) {
      const r = await divisions.create(db, me, { workspaceId, name: d.name, parentId: d.parent ? ids.division[d.parent] : null });
      ids.division[d.key] = r.id;
      created.push({ wf: true, type: 'division', key: d.key, id: r.id, revision: r.revision });
    }
    for (const a of w.agents) {
      const r = await agents.create(db, me, { name: a.name, description: a.description, instructions: a.instructions, workspaceId, divisionId: a.division ? ids.division[a.division] : undefined });
      const rev = (await db.query('SELECT revision FROM workforce_resources WHERE id = $1', [r.definitionId])).rows[0];
      ids.agent[a.key] = r.id; ids.agentUser[a.key] = r.userId;
      created.push({ wf: true, type: 'agent', key: a.key, id: r.id, userId: r.userId, definitionId: r.definitionId, revision: Number(rev.revision), name: r.name });
    }
    for (const p of w.projects) {
      const pr = await createAuthorizedProject(db, { principal: { type: 'user', id: String(me.id) }, workspaceId, name: p.name, description: p.description || null, settings: { source: 'mode-setup' } });
      if (p.division) await divisions.setProjectDivision(db, me, pr.id, ids.division[p.division]);
      ids.project[p.key] = pr.id;
      created.push({ wf: true, type: 'project', key: p.key, id: pr.id });
    }
    for (const t of w.teams) {
      await saveWorkspaceTeam(db, { workspaceId, userId: me.id, input: { name: t.name, description: t.description, project_ids: [], agent_ids: t.agents.map((k) => ids.agentUser[k]) } });
      const r = (await db.query(`SELECT id, revision FROM workforce_resources WHERE kind = 'team' AND owner_workspace_id = $1 AND status = 'active' AND lower(name) = lower($2)`, [workspaceId, t.name])).rows[0];
      created.push({ wf: true, type: 'team', key: t.key, id: r.id, revision: Number(r.revision) });
    }
    const today = new Date();
    for (const o of w.objectives) {
      const r = await createObjective(db, { actorUserId: me.id, workspaceId, divisionId: o.division ? ids.division[o.division] : null, title: o.title, successEvidence: o.successEvidence,
        ownerUserId: me.id, windowStart: day(today), windowEnd: day(new Date(today.getTime() + o.windowDays * 86400000)) });
      ids.objective[o.key] = r.objectiveId;
      created.push({ wf: true, type: 'objective', key: o.key, id: r.objectiveId, title: o.title, successEvidence: o.successEvidence });
    }
    for (const g of w.goals) {
      const r = await createGoal(db, { actorUserId: me.id, projectId: ids.project[g.project], title: g.title, successEvidence: g.successEvidence });
      const goalId = r.goalId || r.id;
      if (g.objective) await linkGoalToObjective(db, { actorUserId: me.id, goalId, objectiveId: ids.objective[g.objective] });
      created.push({ wf: true, type: 'goal', id: goalId, projectId: ids.project[g.project], objectiveId: g.objective ? ids.objective[g.objective] : null });
    }
    if (w.places) {
      const place = (await db.query(`SELECT p.id, p.style, l.layout, l.bays, l.revision FROM places p JOIN place_layouts l ON l.place_id = p.id WHERE p.workspace_id = $1 AND p.lifecycle = 'active' ORDER BY p.created_at LIMIT 1`, [workspaceId])).rows[0];
      if (place) {
        const prior = { bays: place.bays, style: place.style, ...(place.layout || {}) };
        const reply = await places.call(db, me, 'places.layout.save', { placeId: place.id, expectedRevision: Number(place.revision), requestId: `mode-${crypto.randomUUID()}`,
          layout: { ...(place.layout || {}), bays: w.places.bays ?? place.bays, ...(w.places.style ? { style: w.places.style } : place.style ? { style: place.style } : {}) } });
        if (!reply.ok) svcFail(reply.error);
        created.push({ wf: true, type: 'places', id: place.id, prior, revision: reply.result.placeRevision });
      } else created.push({ wf: true, type: 'places', id: null, skipped: 'this workspace has no building yet' });
    }
  } catch (e) { if (e.modeError) throw e; svcFail(e); }
  return { projectsByKey: ids.project };
}

/** Undo one workforce record. Returns 'archived', a reason it was kept, or null (already gone). */
export async function revertOne(db, me, rec) {
  if (rec.type === 'division') {
    const d = (await db.query('SELECT lifecycle, revision FROM workforce_divisions WHERE id = $1', [rec.id])).rows[0];
    if (!d || d.lifecycle !== 'active') return null;
    if (Number(d.revision) !== Number(rec.revision)) return 'changed by a person';
    const busy = (await db.query(`SELECT (SELECT count(*) FROM workforce_divisions WHERE parent_division_id = $1 AND lifecycle = 'active')
      + (SELECT count(*) FROM workforce_project_divisions pd JOIN chat_projects p ON p.id = pd.project_id WHERE pd.division_id = $1 AND NOT p.is_archived) AS n`, [rec.id])).rows[0];
    if (Number(busy.n)) return 'holds work a person kept';
    await divisions.archive(db, me, rec.id);
    return 'archived';
  }
  if (rec.type === 'agent') {
    const a = (await db.query(`SELECT ai.status, r.revision FROM agent_identities ai LEFT JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.user_id = $1`, [rec.userId])).rows[0];
    if (!a || a.status === 'retired') return null;
    if (Number(a.revision) !== Number(rec.revision)) return 'changed by a person';
    const worked = Number((await db.query(`SELECT count(*) n FROM task_events WHERE actor_id = $1`, [rec.userId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
    if (worked) return 'has done work';
    await agents.remove(db, me, rec.id);
    return 'archived';
  }
  if (rec.type === 'team') {
    const t = (await db.query(`SELECT status, revision FROM workforce_resources WHERE id = $1`, [rec.id])).rows[0];
    if (!t || t.status !== 'active') return null;
    if (Number(t.revision) !== Number(rec.revision)) return 'changed by a person';
    await saveWorkspaceTeam(db, { workspaceId: rec.workspaceId, userId: me.id, teamId: rec.id, archive: true, input: { version: Number(t.revision) } });
    return 'archived';
  }
  if (rec.type === 'objective') {
    const o = (await db.query(`SELECT title, success_evidence, status FROM project_objectives WHERE id = $1`, [rec.id])).rows[0];
    if (!o) return null;
    if (o.status !== 'open' || o.title !== rec.title || o.success_evidence !== rec.successEvidence) return 'changed by a person';
    const linked = Number((await db.query(`SELECT count(*) n FROM project_goals g JOIN chat_projects p ON p.id = g.project_id WHERE g.objective_id = $1 AND NOT p.is_archived`, [rec.id])).rows[0].n);
    if (linked) return 'holds work a person kept';
    await db.query(`UPDATE project_goals SET objective_id = NULL WHERE objective_id = $1`, [rec.id]);
    await db.query(`DELETE FROM project_objectives WHERE id = $1`, [rec.id]);
    return 'archived';
  }
  if (rec.type === 'places') {
    if (!rec.id) return null;
    const l = (await db.query(`SELECT revision FROM place_layouts WHERE place_id = $1`, [rec.id])).rows[0];
    if (!l) return null;
    if (Number(l.revision) !== Number(rec.revision)) return 'changed by a person';
    const { bays, style, ...layout } = rec.prior;
    const reply = await places.call(db, me, 'places.layout.save', { placeId: rec.id, expectedRevision: Number(l.revision), requestId: `mode-revert-${crypto.randomUUID()}`, layout: { ...layout, bays, ...(style ? { style } : {}) } });
    if (!reply.ok) return 'could not be restored';
    return 'archived';
  }
  return undefined;   // goals and anything else: kept with their project
}

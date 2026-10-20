/**
 * Onboarding and offboarding a company member (xeno-company SPEC §7.3 D-EMP). These are WORKSPACE operations: they
 * compose XENO Tasks (the checklist), a project, divisions and the one member-removal path, so they live here and not in
 * services/workforcePeople.js — the workforce surface stays an in-process library with no reach into billing or mail
 * (XENO-WORKFORCE-01 NFR-09, scripts/workforce-deployment-boundary.test.mjs). Same rules: a human admin only.
 */
import { createTask } from './xenoTasks.js';
import { createAuthorizedProject } from './chatProjectAuthority.js';
import { mutateWorkspaceMembership } from './workspaceMembershipOperations.js';
import * as divisions from './workforceDivisions.js';
import { everyone, audit, fail, clean } from './workforcePeople.js';

export const ONBOARDING_TASKS = Object.freeze([
  { title: 'Welcome: read how this company works', body: 'Start with the workspace overview and your division’s home.' },
  { title: 'Set your working hours and time zone', body: 'People and Places use them to know when you are around.' },
  { title: 'Meet your manager and your team', body: 'A first conversation about what you will own.' },
  { title: 'Pick up your first task', body: 'Your manager will point you at one; claim it when you start.' },
]);

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


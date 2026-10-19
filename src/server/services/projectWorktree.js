// RUN-06: projects support goal -> milestone -> task records extending the
// existing project subsystem (ASN-08's rule: extend projects, never create a
// second project product). Every write requires a project the actor holds.
// Milestones declare required evidence kinds and whether review is needed;
// tasks complete on attached evidence covering those kinds plus, where
// required, acceptance by the designated reviewer -- never on the worker's
// declaration alone, never self-accepted. Milestones and goals complete only
// when everything beneath them is complete: rollup is derived, not declared.
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const text = (value, what) => {
  if (typeof value !== 'string' || !value.trim()) bad('bad_input', `invalid_${what}`);
  return value.trim();
};

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

async function liveProject(client, projectId) {
  const project = (await client.query('SELECT id FROM chat_projects WHERE id=$1 AND is_archived=FALSE', [projectId])).rows[0];
  if (!project) bad('not_found', 'project_not_found');
  return project.id;
}

async function goalProject(client, goalId) {
  const goal = (await client.query('SELECT id, project_id FROM project_goals WHERE id=$1', [goalId])).rows[0];
  if (!goal) bad('not_found', 'goal_not_found');
  return goal;
}

async function milestoneTree(client, milestoneId) {
  const milestone = (await client.query(
    `SELECT m.*, g.project_id FROM project_milestones m
     JOIN project_goals g ON g.id=m.goal_id WHERE m.id=$1`, [milestoneId],
  )).rows[0];
  if (!milestone) bad('not_found', 'milestone_not_found');
  return milestone;
}

export async function createGoal(poolOrClient, { actorUserId, projectId, title, successEvidence }) {
  const actor = uuid(actorUserId, 'actor');
  const pid = uuid(projectId, 'project');
  return withTx(poolOrClient, async (client) => {
    await liveProject(client, pid);
    if (!(await holdsProject(client, actor, pid))) bad('denied', 'goal_not_authorized');
    const row = (await client.query(
      'INSERT INTO project_goals(project_id,title,success_evidence,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING id, status',
      [pid, text(title, 'title'), text(successEvidence, 'success_evidence'), actor],
    )).rows[0];
    return { goalId: row.id, status: row.status };
  });
}

export async function createMilestone(poolOrClient, { actorUserId, goalId, title, requiredEvidenceKinds, reviewerRequired, reviewerUserId }) {
  const actor = uuid(actorUserId, 'actor');
  const gid = uuid(goalId, 'goal');
  const kinds = requiredEvidenceKinds == null ? [] : requiredEvidenceKinds;
  if (!Array.isArray(kinds) || kinds.some((k) => typeof k !== 'string' || !k.trim())) bad('bad_input', 'invalid_evidence_kinds');
  const review = reviewerRequired === true;
  const reviewer = review ? uuid(reviewerUserId, 'reviewer') : null;
  return withTx(poolOrClient, async (client) => {
    const goal = await goalProject(client, gid);
    await liveProject(client, goal.project_id);
    if (!(await holdsProject(client, actor, goal.project_id))) bad('denied', 'milestone_not_authorized');
    if (reviewer !== null && !(await holdsProject(client, reviewer, goal.project_id))) {
      bad('denied', 'reviewer_not_authorized');
    }
    const row = (await client.query(
      `INSERT INTO project_milestones(goal_id,title,required_evidence_kinds,reviewer_required,reviewer_user_id,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id, status`,
      [gid, text(title, 'title'), kinds.map((k) => k.trim()), review, reviewer, actor],
    )).rows[0];
    return { milestoneId: row.id, status: row.status };
  });
}

export async function createTask(poolOrClient, { actorUserId, milestoneId, title, assigneeUserId }) {
  const actor = uuid(actorUserId, 'actor');
  const mid = uuid(milestoneId, 'milestone');
  const assignee = assigneeUserId == null ? null : uuid(assigneeUserId, 'assignee');
  return withTx(poolOrClient, async (client) => {
    const milestone = await milestoneTree(client, mid);
    if (!(await holdsProject(client, actor, milestone.project_id))) bad('denied', 'task_not_authorized');
    if (assignee !== null && !(await holdsProject(client, assignee, milestone.project_id))) {
      bad('denied', 'assignee_not_authorized');
    }
    const row = (await client.query(
      'INSERT INTO project_tasks(milestone_id,title,assignee_user_id) VALUES($1,$2,$3) RETURNING id, status',
      [mid, text(title, 'title'), assignee],
    )).rows[0];
    return { taskId: row.id, status: row.status };
  });
}

export async function attachTaskEvidence(poolOrClient, { actorUserId, taskId, kind, ref }) {
  const actor = uuid(actorUserId, 'actor');
  const tid = uuid(taskId, 'task');
  return withTx(poolOrClient, async (client) => {
    const task = (await client.query(
      `SELECT t.id, t.status, g.project_id FROM project_tasks t
       JOIN project_milestones m ON m.id=t.milestone_id
       JOIN project_goals g ON g.id=m.goal_id WHERE t.id=$1`, [tid],
    )).rows[0];
    if (!task) bad('not_found', 'task_not_found');
    if (task.status === 'completed') bad('conflict', 'task_already_completed');
    if (!(await holdsProject(client, actor, task.project_id))) bad('denied', 'evidence_not_authorized');
    const row = (await client.query(
      'INSERT INTO project_task_evidence(task_id,kind,ref,attached_by_user_id) VALUES($1,$2,$3,$4) RETURNING id',
      [tid, text(kind, 'kind'), text(ref, 'ref'), actor],
    )).rows[0];
    return { evidenceId: row.id, taskId: tid };
  });
}

/**
 * Complete a task. Every required evidence kind must be attached; where the
 * milestone requires review the task parks in-review instead of completing --
 * the worker's declaration alone never completes a reviewed task.
 */
export async function completeTask(poolOrClient, { actorUserId, taskId }) {
  const actor = uuid(actorUserId, 'actor');
  const tid = uuid(taskId, 'task');
  return withTx(poolOrClient, async (client) => {
    const task = (await client.query(
      `SELECT t.id, t.status, t.assignee_user_id, m.required_evidence_kinds, m.reviewer_required,
         m.reviewer_user_id, g.project_id
       FROM project_tasks t
       JOIN project_milestones m ON m.id=t.milestone_id
       JOIN project_goals g ON g.id=m.goal_id WHERE t.id=$1 FOR UPDATE`, [tid],
    )).rows[0];
    if (!task) bad('not_found', 'task_not_found');
    if (task.status === 'completed') bad('conflict', 'task_already_completed');
    if (!(await holdsProject(client, actor, task.project_id))) bad('denied', 'task_not_authorized');
    if (task.assignee_user_id !== null && task.assignee_user_id !== actor) bad('denied', 'completer_not_assignee');
    const have = new Set((await client.query(
      'SELECT DISTINCT kind FROM project_task_evidence WHERE task_id=$1', [tid])).rows.map((r) => r.kind));
    const missing = (task.required_evidence_kinds || []).filter((k) => !have.has(k));
    if (missing.length > 0) {
      throw Object.assign(new Error('evidence_incomplete'), { code: 'conflict', details: { missing } });
    }
    if (task.reviewer_required) {
      await client.query("UPDATE project_tasks SET status='in-review', completed_by_user_id=$2 WHERE id=$1", [tid, actor]);
      return { taskId: tid, status: 'in-review' };
    }
    await client.query("UPDATE project_tasks SET status='completed', completed_by_user_id=$2 WHERE id=$1", [tid, actor]);
    return { taskId: tid, status: 'completed' };
  });
}

/** Designated reviewer accepts an in-review task. Self-acceptance is refused. */
export async function acceptTask(poolOrClient, { actorUserId, taskId }) {
  const actor = uuid(actorUserId, 'actor');
  const tid = uuid(taskId, 'task');
  return withTx(poolOrClient, async (client) => {
    const task = (await client.query(
      `SELECT t.id, t.status, t.completed_by_user_id, m.reviewer_required, m.reviewer_user_id
       FROM project_tasks t JOIN project_milestones m ON m.id=t.milestone_id WHERE t.id=$1 FOR UPDATE`, [tid],
    )).rows[0];
    if (!task) bad('not_found', 'task_not_found');
    if (task.status !== 'in-review') bad('conflict', 'task_not_in_review');
    if (!task.reviewer_required || task.reviewer_user_id !== actor) bad('denied', 'accept_not_authorized');
    if (task.completed_by_user_id === actor) bad('denied', 'self_accept_refused');
    await client.query("UPDATE project_tasks SET status='completed', accepted_by_user_id=$2 WHERE id=$1", [tid, actor]);
    return { taskId: tid, status: 'completed' };
  });
}

/** Milestones complete only when every task beneath them is complete. */
export async function completeMilestone(poolOrClient, { actorUserId, milestoneId }) {
  const actor = uuid(actorUserId, 'actor');
  const mid = uuid(milestoneId, 'milestone');
  return withTx(poolOrClient, async (client) => {
    const milestone = await milestoneTree(client, mid);
    if (!(await holdsProject(client, actor, milestone.project_id))) bad('denied', 'milestone_not_authorized');
    if (milestone.status === 'completed') bad('conflict', 'milestone_already_completed');
    const open = (await client.query(
      "SELECT count(*)::int AS n FROM project_tasks WHERE milestone_id=$1 AND status<>'completed'", [mid])).rows[0].n;
    if (open > 0) {
      throw Object.assign(new Error('tasks_incomplete'), { code: 'conflict', details: { open } });
    }
    await client.query("UPDATE project_milestones SET status='completed' WHERE id=$1", [mid]);
    return { milestoneId: mid, status: 'completed' };
  });
}

/** Goals complete only when every milestone beneath them is complete. */
export async function completeGoal(poolOrClient, { actorUserId, goalId }) {
  const actor = uuid(actorUserId, 'actor');
  const gid = uuid(goalId, 'goal');
  return withTx(poolOrClient, async (client) => {
    const goal = await goalProject(client, gid);
    if (!(await holdsProject(client, actor, goal.project_id))) bad('denied', 'goal_not_authorized');
    const open = (await client.query(
      "SELECT count(*)::int AS n FROM project_milestones WHERE goal_id=$1 AND status<>'completed'", [gid])).rows[0].n;
    if (open > 0) {
      throw Object.assign(new Error('milestones_incomplete'), { code: 'conflict', details: { open } });
    }
    await client.query("UPDATE project_goals SET status='completed' WHERE id=$1", [gid]);
    return { goalId: gid, status: 'completed' };
  });
}

// ── LIFE-08: objectives, the top of the same tree ─────────────────────────────────────────────
// An objective is the workspace- or division-level parent goals roll up to: owner, window, success
// evidence. Creating one is an act FOR its scope (a workspace editor; for a division, acting INSIDE that
// division under DIV-08's own rule). Linking a goal needs the goal's project AND the objective's scope.
// It completes only when every goal under it has -- derived, as milestones and goals are -- and the
// database refuses the same shapes on its own (20261019120000-project-objectives.sql).
async function objectiveActor(client, actor) {
  const { resolvePrincipal } = await import('./agentIdentity.js');
  const p = await resolvePrincipal(client, actor);
  if (!p?.usable || p.kind !== 'human') bad('denied', 'objective_not_authorized');
  return { principal: p, subject: `user:${p.id}` };
}
async function actsForObjectiveScope(client, who, workspaceId, divisionId) {
  if (divisionId) {
    const { actsInDivision } = await import('./workforceRunAdmission.js');
    return actsInDivision(client, who, workspaceId, divisionId);
  }
  const v = await check(client, { object: `workspace:${workspaceId}`, relation: 'editor', subject: who.subject });
  return v.allowed;
}
const isoDate = (value, what) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) bad('bad_input', `invalid_${what}`);
  return value;
};

export async function createObjective(poolOrClient, { actorUserId, workspaceId, divisionId = null, title, successEvidence, ownerUserId, windowStart, windowEnd }) {
  const actor = uuid(actorUserId, 'actor'), ws = uuid(workspaceId, 'workspace');
  const division = divisionId == null ? null : uuid(divisionId, 'division');
  const owner = uuid(ownerUserId ?? actorUserId, 'owner');
  const t = text(title, 'title'), ev = text(successEvidence, 'success_evidence');
  const start = isoDate(windowStart, 'window_start'), end = isoDate(windowEnd, 'window_end');
  if (end < start) bad('bad_input', 'invalid_window');
  return withTx(poolOrClient, async (client) => {
    const who = await objectiveActor(client, actor);
    const w = (await client.query('SELECT status FROM workspaces WHERE id=$1', [ws])).rows[0];
    if (!w || w.status !== 'active') bad('not_found', 'workspace_not_found');
    if (division) {
      const d = (await client.query('SELECT workspace_id, lifecycle FROM workforce_divisions WHERE id=$1', [division])).rows[0];
      if (!d || d.workspace_id !== ws) bad('not_found', 'division_not_found');
      if (d.lifecycle !== 'active') bad('denied', 'division_not_live');
    }
    if (!(await actsForObjectiveScope(client, who, ws, division))) bad('denied', 'objective_not_authorized');
    // The owner answers for it, so the owner must belong to the workspace.
    if (!(await check(client, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${owner}` })).allowed) bad('denied', 'owner_not_in_workspace');
    const row = (await client.query(`INSERT INTO project_objectives(workspace_id,division_id,title,success_evidence,owner_user_id,window_start,window_end,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ws, division, t, ev, owner, start, end, actor])).rows[0];
    return { objectiveId: row.id, workspaceId: ws, divisionId: division, ownerUserId: owner, windowStart: start, windowEnd: end, status: 'open' };
  });
}

export async function linkGoalToObjective(poolOrClient, { actorUserId, goalId, objectiveId }) {
  const actor = uuid(actorUserId, 'actor'), gid = uuid(goalId, 'goal'), oid = uuid(objectiveId, 'objective');
  return withTx(poolOrClient, async (client) => {
    const who = await objectiveActor(client, actor);
    const goal = await goalProject(client, gid);
    if (!(await holdsProject(client, actor, goal.project_id))) bad('denied', 'goal_not_authorized');
    const o = (await client.query('SELECT workspace_id, division_id, status FROM project_objectives WHERE id=$1 FOR SHARE', [oid])).rows[0];
    if (!o) bad('not_found', 'objective_not_found');
    if (o.status !== 'open') bad('conflict', 'objective_completed');
    const p = (await client.query('SELECT workspace_id FROM chat_projects WHERE id=$1', [goal.project_id])).rows[0];
    if (!p || p.workspace_id !== o.workspace_id) bad('denied', 'objective_outside_project_workspace');
    if (!(await actsForObjectiveScope(client, who, o.workspace_id, o.division_id))) bad('denied', 'objective_not_authorized');
    await client.query('UPDATE project_goals SET objective_id=$2 WHERE id=$1', [gid, oid]);
    return { goalId: gid, objectiveId: oid };
  });
}

export async function completeObjective(poolOrClient, { actorUserId, objectiveId }) {
  const actor = uuid(actorUserId, 'actor'), oid = uuid(objectiveId, 'objective');
  return withTx(poolOrClient, async (client) => {
    const who = await objectiveActor(client, actor);
    const o = (await client.query('SELECT * FROM project_objectives WHERE id=$1 FOR UPDATE', [oid])).rows[0];
    if (!o) bad('not_found', 'objective_not_found');
    if (o.owner_user_id !== actor && !(await actsForObjectiveScope(client, who, o.workspace_id, o.division_id))) bad('denied', 'objective_not_authorized');
    if (o.status === 'completed') return { objectiveId: oid, status: 'completed', replayed: true };
    const { rows } = await client.query("SELECT count(*) FILTER (WHERE status<>'completed')::int AS open, count(*)::int AS n FROM project_goals WHERE objective_id=$1", [oid]);
    if (rows[0].n === 0) bad('conflict', 'objective_has_no_goals');
    if (rows[0].open > 0) throw Object.assign(new Error('goals_incomplete'), { code: 'conflict', details: { open: rows[0].open } });
    await client.query("UPDATE project_objectives SET status='completed', completed_at=now() WHERE id=$1", [oid]);
    return { objectiveId: oid, status: 'completed' };
  });
}

export async function readObjective(poolOrClient, { actorUserId, objectiveId }) {
  const actor = uuid(actorUserId, 'actor'), oid = uuid(objectiveId, 'objective');
  return withTx(poolOrClient, async (client) => {
    const o = (await client.query('SELECT * FROM project_objectives WHERE id=$1', [oid])).rows[0];
    // Existence is not disclosed outside the workspace.
    if (!o || !(await check(client, { object: `workspace:${o.workspace_id}`, relation: 'viewer', subject: `user:${actor}` })).allowed) bad('not_found', 'objective_not_found');
    const goals = (await client.query('SELECT id, project_id, title, status FROM project_goals WHERE objective_id=$1 ORDER BY created_at', [oid])).rows;
    return { objectiveId: o.id, workspaceId: o.workspace_id, divisionId: o.division_id, title: o.title, successEvidence: o.success_evidence,
      ownerUserId: o.owner_user_id, status: o.status,
      goals: goals.map((g) => ({ goalId: g.id, projectId: g.project_id, title: g.title, status: g.status })),
      progress: { goals: goals.length, completed: goals.filter((g) => g.status === 'completed').length } };
  });
}

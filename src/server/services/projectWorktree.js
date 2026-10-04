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

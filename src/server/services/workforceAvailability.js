/**
 * Time off reaches assignment (xeno-company SPEC §7.3 D-EMP). Assigning a task, delegating it, or starting a run
 * for someone who is on time off in that workspace is REFUSED with `assignee_away` unless the assigner passes an
 * explicit override. Only a PERSON may override (`override_human_only`): an agent never decides that someone on
 * leave works anyway. Outside working hours is not a refusal (it is shown, not enforced).
 *
 * Kept free of other service imports so xenoTasks.js and agentCloudRuns.js can call it without a cycle.
 */
export class AwayError extends Error { constructor(message, code, status, detail) { super(message); this.code = code; this.status = status; this.detail = detail; } }

/** The open time off covering `at` for this principal in this workspace, or null. */
export async function timeOffAt(db, workspaceId, principalId, at = new Date()) {
  if (!workspaceId || !principalId) return null;
  return (await db.query(`SELECT starts_at, ends_at, kind FROM workforce_time_off WHERE workspace_id = $1 AND principal_id = $2 AND cancelled_at IS NULL
      AND starts_at <= $3 AND ends_at > $3 ORDER BY ends_at DESC LIMIT 1`, [workspaceId, principalId, at]).catch(() => ({ rows: [] }))).rows[0] || null;
}

/** The workspace a project belongs to (time off is per workspace). */
export async function workspaceOfProject(db, projectId) {
  if (!projectId) return null;
  return (await db.query('SELECT workspace_id FROM chat_projects WHERE id = $1', [projectId]).catch(() => ({ rows: [] }))).rows[0]?.workspace_id || null;
}

/**
 * Refuse an assignment to someone away, unless a human assigner overrides it.
 * @param {{ actorKind: 'human'|'agent'|string, override?: boolean }} who
 */
export async function assertAvailableOrOverridden(db, { workspaceId, principalId, actorKind, override = false, name = 'They' }) {
  const away = await timeOffAt(db, workspaceId, principalId);
  if (!away) return { away: false };
  if (override === true && actorKind === 'human') return { away: true, overridden: true, until: new Date(away.ends_at).toISOString() };
  if (override === true) throw new AwayError('Only a person can assign work to someone who is on time off.', 'override_human_only', 403);
  const until = new Date(away.ends_at).toISOString();
  throw new AwayError(`${name} is on time off until ${until.slice(0, 10)}. Assign it anyway only if you mean to (overrideAway: true).`, 'assignee_away', 409, { until, kind: away.kind });
}

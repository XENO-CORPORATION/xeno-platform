/**
 * A division's HOME (XENO-WORKFORCE-01 DIV-01..DIV-10, VIEW-05): everything that works inside one division, in one
 * read, decided on the SERVER row by row. Nothing here is filtered by a screen: a part the reader may not see
 * arrives CLOSED (`{ closed: true }`, or counted in `hidden`), never as a row a client is trusted to drop.
 *
 * Who sees what — each rule is the one the owning service already uses, read here, never restated looser:
 *   - the division itself, its head, sub-divisions, members, agents, objectives, budget and decisions:
 *     any viewer of its workspace (workforceDivisions.readable, readObjective, the agent-budget route);
 *   - a project, and the funding pools that hang off it: a viewer of that project (project ReBAC);
 *   - a run: its actor, its payer, a viewer of its project, or a workspace admin;
 *   - a handoff: its source or target principal (or the person who answers for that agent), or a workspace admin;
 *   - the spend ledger rows: a workspace admin (they carry what each agent spent); everyone else sees the meter.
 *
 * Writes never happen here. Objectives are written through projectWorktree (LIFE-08), heads and projects through
 * workforceDivisions, budgets through divisionAgentBudget — this file only reads.
 */
import { check } from '../utils/authzReBAC.js';
import * as divisions from './workforceDivisions.js';
import * as agentBudget from './divisionAgentBudget.js';

const RUN_LIMIT = 50, HANDOFF_LIMIT = 50, DECISION_LIMIT = 30;
const credits = (micro) => Number(micro || 0) / 1e6;

async function viewsProject(db, userId, projectId, memo) {
  const k = String(projectId);
  if (!memo.has(k)) memo.set(k, (await check(db, { object: `project:${k}`, relation: 'viewer', subject: `user:${userId}` })).allowed);
  return memo.get(k);
}

/** Build the home of one division as `me` sees it. Throws DivisionError 404 when the division is not visible. */
export async function readDivisionHome(db, me, id) {
  const base = await divisions.get(db, me, id);          // workspace-viewer gate + head/parent/children/agents
  const admin = await divisions.mayManage(db, me, base.workspaceId);
  const memo = new Map();
  const did = base.id;

  // ── projects: owned by the division; each one closed unless the reader views that project
  const projRows = (await db.query(`SELECT p.id, p.name FROM workforce_project_divisions pd JOIN chat_projects p ON p.id = pd.project_id
    WHERE pd.division_id = $1 AND NOT p.is_archived ORDER BY p.name, p.id`, [did])).rows;
  const projects = { rows: [], hidden: 0 };
  for (const p of projRows) {
    if (await viewsProject(db, me.id, p.id, memo)) projects.rows.push({ id: String(p.id), name: p.name, url: `/workspace/projects/${p.id}` });
    else projects.hidden++;
  }
  const projectIds = projRows.map((p) => String(p.id));

  // ── members: through the division's teams, and directly on the division (editor/viewer tuples)
  const teamRows = (await db.query(`SELECT r.id, r.name FROM workforce_division_ownership o JOIN workforce_resources r ON r.id = o.resource_id
    WHERE o.division_id = $1 AND o.resource_kind = 'team' AND r.status = 'active' ORDER BY r.name, r.id`, [did])).rows;
  const teams = [];
  for (const t of teamRows) {
    const ms = (await db.query(`SELECT m.id, m.role, m.member_principal_id, m.member_resource_id,
        COALESCE(u.display_name, u.username, ar.name) AS name, (m.member_resource_id IS NOT NULL OR ai.user_id IS NOT NULL) AS is_agent
      FROM workforce_team_memberships m LEFT JOIN users u ON u.id = m.member_principal_id
      LEFT JOIN agent_identities ai ON ai.user_id = m.member_principal_id
      LEFT JOIN workforce_resources ar ON ar.id = m.member_resource_id
      WHERE m.team_id = $1 AND m.state = 'active' ORDER BY m.role, name`, [t.id])).rows;
    teams.push({ id: String(t.id), name: t.name, members: ms.map((m) => ({ id: String(m.member_principal_id || m.member_resource_id), name: m.name || 'Someone', kind: m.is_agent ? 'agent' : 'human', role: m.role })) });
  }
  const direct = (await db.query(`SELECT r.subject_id, r.relation, COALESCE(u.display_name, u.username) AS name, (ai.user_id IS NOT NULL) AS is_agent
    FROM relationship_tuples r JOIN users u ON u.id::text = r.subject_id LEFT JOIN agent_identities ai ON ai.user_id = u.id
    WHERE r.object_type = 'division' AND r.object_id = $1 AND r.subject_type = 'user' ORDER BY name`, [did])).rows
    .map((m) => ({ id: String(m.subject_id), name: m.name || 'Someone', kind: m.is_agent ? 'agent' : 'human', relation: m.relation, isHead: base.head && String(base.head.id) === String(m.subject_id) }));

  // ── objectives: the division-level top of the work tree, with goal progress
  const objectives = (await db.query(`SELECT o.*, COALESCE(u.display_name, u.username) AS owner_name,
      (SELECT count(*)::int FROM project_goals g WHERE g.objective_id = o.id) AS goals,
      (SELECT count(*)::int FROM project_goals g WHERE g.objective_id = o.id AND g.status = 'completed') AS done
    FROM project_objectives o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.division_id = $1
    ORDER BY (o.status = 'completed'), o.window_end, o.created_at`, [did])).rows.map((o) => ({
    id: String(o.id), title: o.title, successEvidence: o.success_evidence, status: o.status,
    owner: { id: String(o.owner_user_id), name: o.owner_name || 'Someone' },
    windowStart: o.window_start, windowEnd: o.window_end, goals: o.goals, goalsDone: o.done,
    progress: o.goals ? o.done / o.goals : (o.status === 'completed' ? 1 : 0), completedAt: o.completed_at }));

  // ── active runs: admitted, not revoked, whose agent works in this division or whose project is in it
  const runRows = (await db.query(`SELECT a.id, a.actor_user_id, a.payer_user_id, a.project_id, a.target_kind, a.admitted_at, a.budget_ceiling_micro,
      a.effective_capabilities, r.name AS agent_name, p.name AS project_name,
      (SELECT max(l.expires_at) FROM workforce_run_leases l WHERE l.admission_id = a.id) AS lease_until,
      (SELECT count(*)::int FROM workforce_run_leases l WHERE l.admission_id = a.id) AS leases
    FROM workforce_run_admissions a JOIN workforce_resources r ON r.id = a.agent_resource_id
    LEFT JOIN chat_projects p ON p.id = a.project_id
    WHERE NOT EXISTS (SELECT 1 FROM workforce_run_revocations v WHERE v.admission_id = a.id)
      AND (a.agent_resource_id IN (SELECT resource_id FROM workforce_division_ownership WHERE division_id = $1 AND resource_kind = 'agent')
        OR a.project_id = ANY($2::uuid[]))
    ORDER BY a.admitted_at DESC LIMIT ${RUN_LIMIT}`, [did, projectIds])).rows;
  const runs = { rows: [], hidden: 0 };
  const now = Date.now();
  for (const a of runRows) {
    const mine = String(a.actor_user_id) === String(me.id) || String(a.payer_user_id) === String(me.id);
    const ok = mine || admin || (a.project_id && await viewsProject(db, me.id, a.project_id, memo));
    if (!ok) { runs.hidden++; continue; }
    const live = a.lease_until && new Date(a.lease_until).getTime() > now;
    runs.rows.push({ id: String(a.id), agent: a.agent_name, target: a.target_kind,
      project: a.project_id ? { id: String(a.project_id), name: a.project_name } : null,
      admittedAt: a.admitted_at, budgetCredits: credits(a.budget_ceiling_micro), capabilities: a.effective_capabilities || [],
      authority: { state: live ? 'live' : (a.leases ? 'idle' : 'admitted'), leaseUntil: a.lease_until, leases: a.leases },
      canStop: mine || admin });
  }

  // ── spend vs budget (DIV-07): the meter for everyone in the workspace, the ledger rows for its admins
  const b = await agentBudget.budgetOf(db, did);
  const spend = { budget: b ? b.view : null, ledger: admin ? await agentBudget.divisionSpend(db, did) : { closed: true } };

  // ── funding pools of the division's projects (FUND-06), per project visibility
  const fundRows = projectIds.length ? (await db.query(`SELECT c.id AS campaign_id, c.project_id, c.status, c.beneficiary, fp.id AS pool_id, m.title AS milestone, ca.balance
    FROM workforce_funding_campaigns c JOIN workforce_funding_pools fp ON fp.campaign_id = c.id
    LEFT JOIN workforce_funding_milestones m ON m.id = fp.milestone_id LEFT JOIN credit_accounts ca ON ca.id = fp.account_id
    WHERE c.project_id = ANY($1::uuid[]) ORDER BY c.created_at, fp.created_at`, [projectIds])).rows : [];
  const funding = { rows: [], hidden: 0 };
  for (const f of fundRows) {
    if (!(await viewsProject(db, me.id, f.project_id, memo))) { funding.hidden++; continue; }
    funding.rows.push({ poolId: String(f.pool_id), campaignId: String(f.campaign_id), projectId: String(f.project_id), status: f.status,
      beneficiary: f.beneficiary, milestone: f.milestone || null, balanceCredits: credits(f.balance) });
  }

  // ── handoffs crossing the division, and the decisions taken in it
  const hoRows = (await db.query(`SELECT h.id, h.state, h.work_ref_type, h.work_ref_id, h.source_principal_id, h.target_principal_id,
      h.source_division_id, h.target_division_id, h.expires_at, h.accepted_at, h.resolved_at,
      COALESCE(su.display_name, su.username) AS source_name, COALESCE(tu.display_name, tu.username) AS target_name,
      sa.owner_user_id AS source_owner, ta.owner_user_id AS target_owner
    FROM workforce_handoffs h LEFT JOIN users su ON su.id = h.source_principal_id LEFT JOIN users tu ON tu.id = h.target_principal_id
    LEFT JOIN agent_identities sa ON sa.user_id = h.source_principal_id LEFT JOIN agent_identities ta ON ta.user_id = h.target_principal_id
    WHERE h.source_division_id = $1 OR h.target_division_id = $1 ORDER BY h.id DESC LIMIT ${HANDOFF_LIMIT}`, [did])).rows;
  const handoffs = { rows: [], hidden: 0 };
  for (const h of hoRows) {
    const involved = [h.source_principal_id, h.target_principal_id, h.source_owner, h.target_owner].some((x) => x && String(x) === String(me.id));
    if (!admin && !involved) { handoffs.hidden++; continue; }
    handoffs.rows.push({ id: String(h.id), state: h.state, work: { type: h.work_ref_type, id: String(h.work_ref_id) },
      from: { id: String(h.source_principal_id), name: h.source_name || 'Someone' }, to: { id: String(h.target_principal_id), name: h.target_name || 'Someone' },
      direction: String(h.target_division_id) === did ? (String(h.source_division_id) === did ? 'within' : 'in') : 'out',
      expiresAt: h.expires_at, acceptedAt: h.accepted_at, resolvedAt: h.resolved_at });
  }
  const decisions = (await db.query(`SELECT o.operation_id, o.kind, o.subject_type, o.authority, o.rationale, o.committed_at,
      COALESCE(u.display_name, u.username) AS decider
    FROM workforce_operations o LEFT JOIN users u ON u.id = o.deciding_principal_id
    WHERE o.division_id = $1 AND o.kind NOT LIKE 'handoff.%' ORDER BY o.committed_at DESC LIMIT ${DECISION_LIMIT}`, [did])).rows
    .map((o) => ({ id: String(o.operation_id), kind: o.kind, subject: o.subject_type, authority: o.authority, rationale: o.rationale, at: o.committed_at, by: o.decider || 'Someone' }));

  return {
    id: did, workspaceId: base.workspaceId, name: base.name, key: base.key, lifecycle: base.lifecycle, revision: base.revision,
    head: base.head, parent: base.parent ? { id: base.parent.id, name: base.parent.name } : null,
    children: base.children.map((c) => ({ id: c.id, name: c.name, head: c.head })),
    canManage: admin, createdAt: base.createdAt, archivedAt: base.archivedAt,
    agents: base.agentsList, teams, directMembers: direct, objectives, runs, spend, funding, projects, handoffs, decisions,
  };
}

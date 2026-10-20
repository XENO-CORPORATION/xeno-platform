/**
 * D-1 (workforce spec §8.11.1, DECIDED 2026-10-20): the WORKSPACE is the unit of ownership, billing and seats, and a
 * personal account IS a one-person workspace with the same feature set. A person is always the principal.
 *
 * Legacy rows say "personal" with `workspace_id IS NULL` plus an owner user. This resolver is the ONE place that
 * maps that shape onto its owner's personal workspace, so every ownership decision (storage pools first) reads one
 * answer. EXPAND step only: no row's workspace_id is rewritten here; the contract step (backfilling workspace_id
 * and making it NOT NULL) is a recorded follow-up.
 *
 * An agent's record belongs to its owner's scope (an agent has no workspace of its own), so an agent owner resolves
 * through agent_identities to the accountable human. A service principal has no personal scope and is refused
 * (ensurePersonalWorkspace answers 409 not_a_person).
 */
import { ensurePersonalWorkspace } from './personalWorkspace.js';

function scopeError(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/**
 * D-1 CONTRACT (migration 20261020140000): every user_files row names a workspace, and a PERSONAL file is the one
 * with an owner_user_id (allowed only inside its owner's personal workspace). Code that asks "is this a shared
 * workspace's file?" reads this, never `row.workspace_id` alone, which is now set for personal files too.
 */
export function sharedWorkspaceOf(row) {
  if (!row) return null;
  return row.owner_user_id ? null : (row.workspace_id || null);
}

export async function ownerScopeOf(db, { workspaceId = null, ownerUserId = null } = {}) {
  if (workspaceId) {
    const w = (await db.query('SELECT id, owner_user_id, workspace_type FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
    if (!w) throw scopeError(404, 'workspace_not_found', 'workspace not found');
    return { workspaceId: w.id, personal: w.workspace_type === 'personal', accountableUserId: w.owner_user_id };
  }
  if (!ownerUserId) throw scopeError(400, 'owner_scope_unknown', 'a record without a workspace must name its owner');
  const agent = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [ownerUserId])).rows[0];
  const person = agent ? agent.owner_user_id : ownerUserId;
  const w = await ensurePersonalWorkspace(db, person);
  return { workspaceId: w.id, personal: true, accountableUserId: person };
}

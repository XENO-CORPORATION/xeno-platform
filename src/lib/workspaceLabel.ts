import type { Workspace } from '../services/accountService';

/**
 * XENO-WORKFORCE-01 SES-01: "Backing personal account scope is not presented as a forced
 * user-created workspace."
 *
 * Every account is provisioned a `workspace_type: 'personal'` row, auto-named "<name>'s Workspace"
 * by the server. That row BACKS the person's own scope (services/personalScope.js on the server);
 * the person never created it and it is not a place they put things. So it is presented as what it
 * is -- "Personal" -- and never under the manufactured name. A team workspace keeps its own name.
 *
 * One function, so every surface that names the active scope says the same thing.
 */
export const PERSONAL_SCOPE_LABEL = 'Personal';

export function scopeLabel(workspace: Pick<Workspace, 'workspace_type' | 'name'> | null | undefined): string | null {
  if (!workspace) return null;
  return workspace.workspace_type === 'personal' ? PERSONAL_SCOPE_LABEL : workspace.name;
}

/** The secondary line under a scope in the switcher. */
export function scopeDetail(workspace: Pick<Workspace, 'workspace_type' | 'member_count'>): string {
  return workspace.workspace_type === 'team' ? `${workspace.member_count ?? 0} members` : 'Your own account';
}

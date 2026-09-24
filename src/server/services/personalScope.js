/**
 * XENO-WORKFORCE-01 SES-01 and the spec's §12 persistence rule: "resolve personal workspace wrappers
 * through ONE adapter."
 *
 * A `workspace_type = 'personal'` row BACKS a person's own account scope. It is not a container
 * that happens to have one member, and a resource created "in" it belongs to that PERSON: it is
 * personally owned (`owner_user_id`, an `owner` tuple), never parented to the wrapper (`workspace_id`,
 * a `parent@workspace` tuple).
 *
 * Why the difference matters: a parent tuple makes the resource readable by every member of the
 * wrapper, and a personal workspace CAN take members -- invites carry no workspace_type check, and a
 * Studio plan includes 25 seats. The web client selects the personal workspace as its active context
 * by default, so before this adapter every web New Chat was parented to it, and a Studio owner who
 * invited a colleague from the Team page handed them every chat they had ever started. Measured
 * through the real chat router, 2026-09-23; recorded in scripts/chat-workspace-scope.database.test.mjs.
 *
 * Every creation path that turns an active-workspace context into a resource scope calls
 * `resolveResourceScope`, so the rule is stated once. A caller that is not the wrapper's owner gets
 * no scope from it at all -- the personal wrapper of SOMEONE ELSE is never a place a resource can be
 * put, whatever relation that caller holds on it.
 */

/**
 * The owner of `workspaceId` if it is a personal wrapper, else null. Null for an unknown id too,
 * so an absent row and a team workspace read the same to a caller deciding scope.
 */
export async function personalWrapperOwner(db, workspaceId) {
  if (!workspaceId) return null;
  const row = (await db.query(
    "SELECT owner_user_id FROM workspaces WHERE id = $1 AND workspace_type = 'personal'",
    [workspaceId],
  )).rows[0];
  return row ? String(row.owner_user_id) : null;
}

/**
 * The scope a resource created by `userId` under active context `workspaceId` belongs to:
 *   { kind: 'personal', ownerUserId }      no context, or the caller's OWN personal wrapper
 *   { kind: 'workspace', workspaceId }     a team workspace (membership is the caller's to check)
 *   { kind: 'refused' }                    another person's personal wrapper
 */
export async function resolveResourceScope(db, { userId, workspaceId }) {
  if (!workspaceId) return { kind: 'personal', ownerUserId: userId };
  const wrapperOwner = await personalWrapperOwner(db, workspaceId);
  if (wrapperOwner === null) return { kind: 'workspace', workspaceId };
  if (wrapperOwner === String(userId)) return { kind: 'personal', ownerUserId: userId };
  return { kind: 'refused' };
}

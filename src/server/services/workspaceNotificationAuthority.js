import { check } from '../utils/authzReBAC.js';

export async function requireNotificationWorkspace(db, workspaceId, ownerId, relation = 'editor') {
  const { rows } = await db.query("SELECT id FROM workspaces WHERE id=$1 AND status='active'", [workspaceId]);
  if (!rows.length || !(await check(db, { object: `workspace:${workspaceId}`, relation, subject: `user:${ownerId}` })).allowed) {
    const error = new Error('Notification workspace authority unavailable'); error.status = 403; throw error;
  }
}

/** Recheck grants and exact configured rule immediately before external dispatch. */
export async function notificationDeliveryAllowed(db, delivery) {
  if (!delivery.notification_workspace_id) return true;
  try {
    await requireNotificationWorkspace(db, delivery.notification_workspace_id, delivery.notification_owner_id);
    const { rows } = await db.query(`SELECT 1 FROM agent_notification_scopes s, jsonb_array_elements(s.rules) r
      WHERE s.workspace_id=$1 AND s.owner_user_id=$2 AND s.scope_key=$3
      AND r->>'id'=$4 AND r->>'destinationId'=$5 AND r->>'event'=$6 AND r->>'enabled'='true'`,
    [delivery.notification_workspace_id, delivery.notification_owner_id, delivery.notification_scope_key, delivery.notification_rule_id, delivery.webhook_id, delivery.event]);
    return rows.length === 1;
  } catch (error) { if (error.status === 403) return false; throw error; }
}

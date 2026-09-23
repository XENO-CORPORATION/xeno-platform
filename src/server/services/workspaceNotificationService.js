import crypto from 'node:crypto';
import { assertSafeEndpointUrl } from '../utils/safeEndpoint.js';
import { requireNotificationWorkspace } from './workspaceNotificationAuthority.js';
import { agentWebhookReceiver } from './agentWebhookFormat.js';

export const AGENT_NOTIFICATION_EVENTS = ['agent.finished', 'agent.failed', 'agent.cancelled'];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function notificationScope(raw) {
  if (!raw || typeof raw !== 'object') fail('Invalid notification scope');
  for (const key of ['workspaceId', 'teamId', 'agentId']) if ((key === 'workspaceId' || raw[key] !== undefined) && (typeof raw[key] !== 'string' || !/^[a-z0-9_:-]{1,240}$/i.test(raw[key]))) fail('Invalid notification scope');
  if (raw.agentId && !raw.teamId) fail('Agent requires owning team');
  if (typeof raw.workspaceCreatedAt !== 'string' || !Number.isFinite(Date.parse(raw.workspaceCreatedAt))) fail('Workspace generation is required');
  return { workspaceId: raw.workspaceId, workspaceCreatedAt: new Date(raw.workspaceCreatedAt).toISOString(), ...(raw.teamId ? { teamId: raw.teamId } : {}), ...(raw.agentId ? { agentId: raw.agentId } : {}) };
}
async function transaction(db, callback) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const value = await callback(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function destinations(db, workspaceId, ownerId, channelVersion = 1) {
  const { rows } = await db.query('SELECT id,url,is_active,updated_at FROM webhooks WHERE notification_workspace_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY created_at,id', [workspaceId, ownerId]);
  return rows.map(row => {
    let ready = row.is_active; let label = 'Unavailable webhook'; let channel = 'webhook';
    try { label = assertSafeEndpointUrl(row.url).hostname; const receiver = agentWebhookReceiver(row.url); if (channelVersion === 2 && receiver) channel = receiver.receiver; } catch { ready = false; }
    return { id: row.id, label, channel, ready, enabled: row.is_active, updated_at: new Date(row.updated_at).toISOString() };
  });
}
export async function readNotificationSettings(db, workspaceId, ownerId, inputScope, { channelVersion = 1 } = {}) {
  await requireNotificationWorkspace(db, workspaceId, ownerId, 'viewer');
  const scope = notificationScope(inputScope);
  const { rows } = await db.query('SELECT rules,revision FROM agent_notification_scopes WHERE workspace_id=$1 AND owner_user_id=$2 AND scope_key=$3', [workspaceId, ownerId, hash(scope)]);
  const history = await db.query(`SELECT id,webhook_id AS destination_id,event,state,attempt,max_attempts,status_code,error_code,created_at,delivered_at,next_retry_at,cancelled_at
    FROM webhook_deliveries WHERE notification_workspace_id=$1 AND notification_owner_id=$2 AND notification_scope_key=$3 ORDER BY created_at DESC LIMIT 50`, [workspaceId, ownerId, hash(scope)]);
  const targets = await destinations(db, workspaceId, ownerId, channelVersion);
  const targetChannels = new Map(targets.map(target => [target.id, target.channel]));
  const rules = (rows[0]?.rules || []).map(rule => ({ ...rule, channel: channelVersion === 2 ? targetChannels.get(rule.destinationId) ?? rule.channel : 'webhook' }));
  return { success: true, ...(channelVersion === 2 ? { channelVersion: 2 } : {}), revision: rows[0]?.revision || '0', rules, destinations: targets, deliveries: history.rows,
    channels: [{ id: 'webhook', available: true }, { id: 'email', available: false }, { id: 'slack', available: channelVersion === 2 }, { id: 'discord', available: channelVersion === 2 }], digestFrequencies: ['realtime'] };
}
export async function saveNotificationSettings(db, workspaceId, ownerId, input, { channelVersion = 1 } = {}) {
  const scope = notificationScope(input.scope);
  if (!Array.isArray(input.rules) || input.rules.length > 20 || typeof input.expectedRevision !== 'string') fail('Invalid notification rules');
  await transaction(db, async client => {
    await requireNotificationWorkspace(client, workspaceId, ownerId, 'admin');
    const inserted = await client.query(`INSERT INTO agent_notification_scopes(workspace_id,owner_user_id,scope_key,scope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING scope_key`, [workspaceId, ownerId, hash(scope), scope]);
    const current = (await client.query('SELECT revision,rules FROM agent_notification_scopes WHERE workspace_id=$1 AND owner_user_id=$2 AND scope_key=$3 FOR UPDATE', [workspaceId, ownerId, hash(scope)])).rows[0];
    // Empty settings still have a generation; revision 0 is valid only for the
    // transaction that actually created this scope, never an existing empty row.
    if (input.expectedRevision !== current.revision && !(input.expectedRevision === '0' && inserted.rowCount === 1)) fail('Notification settings changed', 409);
    const available = new Map((await destinations(client, workspaceId, ownerId, channelVersion)).map(value => [value.id, value]));
    const rules = input.rules.map(rule => {
      if (!rule || !AGENT_NOTIFICATION_EVENTS.includes(rule.event) || !uuid(rule.destinationId) || typeof rule.enabled !== 'boolean' || !available.get(rule.destinationId)?.ready
        || rule.channel !== available.get(rule.destinationId).channel) fail('Approved matching channel destination and supported event are required');
      return { id: hash([rule.event, rule.destinationId]), event: rule.event, channel: rule.channel, destinationId: rule.destinationId, enabled: rule.enabled };
    });
    if (new Set(rules.map(rule => rule.id)).size !== rules.length) fail('Duplicate notification rule');
    await client.query('UPDATE agent_notification_scopes SET rules=$1,revision=gen_random_uuid(),updated_at=clock_timestamp() WHERE workspace_id=$2 AND owner_user_id=$3 AND scope_key=$4', [JSON.stringify(rules), workspaceId, ownerId, hash(scope)]);
  });
  return readNotificationSettings(db, workspaceId, ownerId, scope, { channelVersion });
}
export async function admitAgentNotification(db, workspaceId, ownerId, input) {
  const scope = notificationScope(input.scope);
  if (!AGENT_NOTIFICATION_EVENTS.includes(input.event) || !/^[a-f0-9]{64}$/.test(input.eventId || '') || !Number.isFinite(Date.parse(input.occurredAt))) fail('Invalid notification event');
  for (const key of ['conversationId', 'requestId']) if (typeof input[key] !== 'string' || !/^[a-z0-9_:-]{1,240}$/i.test(input[key])) fail('Invalid run identity');
  const envelope = { eventId: input.eventId, event: input.event, occurredAt: new Date(input.occurredAt).toISOString(), scope, conversationId: input.conversationId, requestId: input.requestId };
  return transaction(db, async client => {
    await requireNotificationWorkspace(client, workspaceId, ownerId);
    // Serialize admission per tenant/subject. Retries retain their durable ID
    // even when the new-event quota is exhausted; dedupe identities never expire.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('agent_notification:' || $1::text || ':' || $2::text,0))", [workspaceId, ownerId]);
    const prior = (await client.query('SELECT envelope=$1::jsonb AS same FROM agent_notification_events WHERE workspace_id=$2 AND owner_user_id=$3 AND event_id=$4', [envelope, workspaceId, ownerId, input.eventId])).rows[0];
    if (prior) {
      if (!prior.same) fail('Notification identity conflicts', 409);
      return { success: true, admitted: true, duplicate: true };
    }
    const daily = (await client.query("SELECT COUNT(*)::int count FROM agent_notification_events WHERE workspace_id=$1 AND owner_user_id=$2 AND admitted_at>=clock_timestamp()-interval '24 hours'", [workspaceId, ownerId])).rows[0];
    if (daily.count >= 10000) fail('Notification admission quota exceeded', 429);
    const saved = await client.query(`INSERT INTO agent_notification_events(workspace_id,owner_user_id,event_id,envelope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id`, [workspaceId, ownerId, input.eventId, envelope]);
    if (!saved.rowCount) {
      const prior = (await client.query('SELECT envelope=$1::jsonb AS same FROM agent_notification_events WHERE workspace_id=$2 AND owner_user_id=$3 AND event_id=$4', [envelope, workspaceId, ownerId, input.eventId])).rows[0];
      if (!prior?.same) fail('Notification identity conflicts', 409);
      return { success: true, admitted: true, duplicate: true };
    }
    const chain = [{ workspaceId: scope.workspaceId, workspaceCreatedAt: scope.workspaceCreatedAt }, ...(scope.teamId ? [{ workspaceId: scope.workspaceId, workspaceCreatedAt: scope.workspaceCreatedAt, teamId: scope.teamId }] : []), ...(scope.agentId ? [scope] : [])];
    const rules = await client.query(`SELECT s.scope_key,r FROM agent_notification_scopes s,jsonb_array_elements(s.rules) r
      WHERE s.workspace_id=$1 AND s.owner_user_id=$2 AND s.scope_key=ANY($3::text[]) AND r->>'event'=$4
      ORDER BY (s.scope ? 'agentId') DESC,(s.scope ? 'teamId') DESC,s.scope_key`, [workspaceId, ownerId, chain.map(hash), input.event]);
    const emitted = new Set();
    for (const { scope_key, r } of rules.rows) {
      if (emitted.has(r.destinationId)) continue; emitted.add(r.destinationId);
      if (!r.enabled) continue;
      await client.query(`INSERT INTO webhook_deliveries(webhook_id,event,event_id,payload,destination_url,destination_updated_at,attempt,
        notification_workspace_id,notification_owner_id,notification_scope_key,notification_rule_id)
        SELECT id,$1::text,$2,$3,url,updated_at,0,$4,$5,$6,$7 FROM webhooks WHERE id=$8 AND user_id=$5 AND notification_workspace_id=$4 AND is_active AND deleted_at IS NULL
        ON CONFLICT(webhook_id,event_id) DO NOTHING`, [input.event, `${workspaceId}:${input.eventId}`, envelope, workspaceId, ownerId, scope_key, r.id, r.destinationId]);
    }
    return { success: true, admitted: true, duplicate: false };
  });
}

import crypto from 'node:crypto';
import { assertSafeEndpointUrl } from '../utils/safeEndpoint.js';
import { requireNotificationWorkspace } from './workspaceNotificationAuthority.js';
import { controlWebhookDelivery } from './webhookDelivery.js';
import { agentWebhookReceiver } from './agentWebhookFormat.js';
import {
  authorityTransaction,
  lockWorkspaceAuthority,
  operationError,
  operationHash,
  operationIdentity,
  workspaceOperationIncarnation,
} from './workspaceOperationReceipts.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACTIONS = new Set(['create', 'update', 'delete', 'delivery-control']);
const KNOWN_REJECTIONS = new Set(['notification_destination_not_found', 'notification_destination_generation_conflict', 'notification_delivery_transition_unavailable']);
const where = 'workspace_id=$1 AND actor_user_id=$2 AND client_id=$3 AND operation_id=$4 AND family=$5';
const fail = (status, code) => { throw operationError(status, code); };
const timestamp = value => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, 'invalid_notification_destination_operation');
  return new Date(value).toISOString();
};

function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) fail(400, 'invalid_notification_destination_operation');
  try { const url = assertSafeEndpointUrl(value).toString(); agentWebhookReceiver(url); return url; }
  catch { fail(400, 'invalid_notification_destination_operation'); }
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'invalid_notification_destination_operation');
}

export function notificationDestinationIntent(value) {
  exactObject(value, ['action', 'url', 'destination_id', 'expected_updated_at', 'enabled', 'delivery_id', 'operation']);
  if (!ACTIONS.has(value.action)) fail(400, 'invalid_notification_destination_operation');
  if (value.action === 'create') {
    exactObject(value, ['action', 'url']);
    return { action: value.action, url: validateUrl(value.url) };
  }
  if (!UUID.test(value.destination_id || '')) fail(400, 'invalid_notification_destination_operation');
  if (value.action === 'update') {
    exactObject(value, ['action', 'destination_id', 'expected_updated_at', 'url', 'enabled']);
    if (value.url === undefined && value.enabled === undefined) fail(400, 'invalid_notification_destination_operation');
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail(400, 'invalid_notification_destination_operation');
    return { action: value.action, destination_id: value.destination_id.toLowerCase(), expected_updated_at: timestamp(value.expected_updated_at),
      ...(value.url === undefined ? {} : { url: validateUrl(value.url) }), ...(value.enabled === undefined ? {} : { enabled: value.enabled }) };
  }
  if (value.action === 'delete') {
    exactObject(value, ['action', 'destination_id', 'expected_updated_at']);
    return { action: value.action, destination_id: value.destination_id.toLowerCase(), expected_updated_at: timestamp(value.expected_updated_at) };
  }
  exactObject(value, ['action', 'destination_id', 'delivery_id', 'operation']);
  if (!UUID.test(value.delivery_id || '') || !['retry', 'cancel'].includes(value.operation)) fail(400, 'invalid_notification_destination_operation');
  return { action: value.action, destination_id: value.destination_id.toLowerCase(), delivery_id: value.delivery_id.toLowerCase(), operation: value.operation };
}

function destinationProjection(row) {
  return { id: row.id, label: assertSafeEndpointUrl(row.url).hostname, channel: 'webhook', ready: row.is_active && !row.deleted_at,
    enabled: row.is_active && !row.deleted_at, updated_at: new Date(row.updated_at).toISOString() };
}

function publicOperation(receipt) {
  const allowed = ['operation_id', 'workspace_id', 'actor_user_id', 'client_id', 'action', 'state', 'prepared_at', 'committed_at', 'destination', 'delivery', 'rejection'];
  if (!receipt || typeof receipt !== 'object' || Object.keys(receipt).some(key => ![...allowed, 'request'].includes(key))) fail(500, 'invalid_notification_destination_receipt');
  return Object.fromEntries(allowed.filter(key => receipt[key] !== undefined).map(key => [key, receipt[key]]));
}

function preparedReceipt(identity, request) {
  return { operation_id: identity[3], workspace_id: identity[0], actor_user_id: identity[1], client_id: identity[2],
    action: request.action, state: 'prepared', prepared_at: new Date().toISOString(), request };
}

async function loadOperation(db, identity, incarnation, lock = false) {
  const row = (await db.query(`SELECT request_hash,receipt,incarnation_hash FROM workspace_key_operations WHERE ${where}${lock ? ' FOR UPDATE' : ''}`, identity)).rows[0];
  if (row && row.incarnation_hash !== incarnation) fail(409, 'workspace_operation_incarnation_conflict');
  return row;
}

export async function prepareNotificationDestinationOperation(pool, workspaceId, actor, clientId, operationId, rawIntent) {
  const identity = operationIdentity('notification', workspaceId, actor, clientId, operationId);
  const request = notificationDestinationIntent(rawIntent);
  const requestHash = operationHash(request);
  return authorityTransaction(pool, async db => {
    await lockWorkspaceAuthority(db, workspaceId);
    const incarnation = await workspaceOperationIncarnation(db, workspaceId, actor);
    const prior = await loadOperation(db, identity, incarnation, true);
    if (prior) {
      if (prior.request_hash !== requestHash) fail(409, 'workspace_operation_conflict');
      return { state: prior.receipt.state, operation: publicOperation(prior.receipt), replayed: true };
    }
    await requireNotificationWorkspace(db, workspaceId, actor, 'admin');
    const count = Number((await db.query("SELECT count(*) FROM workspace_key_operations WHERE workspace_id=$1 AND family='notification'", [workspaceId])).rows[0].count);
    if (count >= 10000) fail(429, 'workspace_operation_capacity');
    const receipt = preparedReceipt(identity, request);
    await db.query('INSERT INTO workspace_key_operations(workspace_id,actor_user_id,client_id,operation_id,family,request_hash,receipt,incarnation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [...identity, requestHash, JSON.stringify(receipt), incarnation]);
    return { state: 'prepared', operation: publicOperation(receipt), replayed: false };
  });
}

export async function readNotificationDestinationOperation(db, workspaceId, actor, clientId, operationId) {
  const identity = operationIdentity('notification', workspaceId, actor, clientId, operationId);
  const incarnation = await workspaceOperationIncarnation(db, workspaceId, actor);
  const row = await loadOperation(db, identity, incarnation);
  return row ? { state: row.receipt.state, operation: publicOperation(row.receipt) } : { state: 'not-observed', operation: null };
}

async function destinationForMutation(db, workspaceId, actor, request) {
  await requireNotificationWorkspace(db, workspaceId, actor, 'admin');
  const row = (await db.query('SELECT * FROM webhooks WHERE id=$1 AND user_id=$2 AND notification_workspace_id=$3 AND deleted_at IS NULL FOR UPDATE', [request.destination_id, actor, workspaceId])).rows[0];
  if (!row) fail(404, 'notification_destination_not_found');
  if (request.expected_updated_at && new Date(row.updated_at).toISOString() !== request.expected_updated_at) fail(409, 'notification_destination_generation_conflict');
  return row;
}

async function cancelPendingDeliveries(db, destinationId, code) {
  await db.query(`UPDATE webhook_deliveries SET state='cancelled',cancelled_at=clock_timestamp(),error_code=$2,
    fence=fence+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL
    WHERE webhook_id=$1 AND state IN ('queued','leased')`, [destinationId, code]);
}

async function applyIntent(db, workspaceId, actor, request) {
  if (request.action === 'create') {
    await requireNotificationWorkspace(db, workspaceId, actor, 'admin');
    const secret = crypto.randomBytes(32).toString('hex');
    const row = (await db.query(`INSERT INTO webhooks(user_id,notification_workspace_id,url,secret,events) VALUES($1,$2,$3,$4,ARRAY[]::text[])
      RETURNING *`, [actor, workspaceId, request.url, secret])).rows[0];
    // Receiver URL credentials authenticate Slack/Discord; no unused signing
    // secret is advertised for those receivers. Generic webhook custody is unchanged.
    return { destination: destinationProjection(row), ...(agentWebhookReceiver(row.url) ? {} : { secret }) };
  }
  if (request.action === 'delivery-control') {
    await requireNotificationWorkspace(db, workspaceId, actor, 'admin');
    const delivery = await controlWebhookDelivery(db, actor, request.destination_id, request.delivery_id, request.operation, { workspaceId });
    if (!delivery) fail(409, 'notification_delivery_transition_unavailable');
    return { delivery };
  }
  const prior = await destinationForMutation(db, workspaceId, actor, request);
  if (request.action === 'delete') {
    const row = (await db.query('UPDATE webhooks SET is_active=false,deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [prior.id])).rows[0];
    await cancelPendingDeliveries(db, prior.id, 'destination_deleted');
    return { destination: destinationProjection(row) };
  }
  const row = (await db.query(`UPDATE webhooks SET url=COALESCE($2,url),is_active=COALESCE($3,is_active),updated_at=clock_timestamp()
    WHERE id=$1 RETURNING *`, [prior.id, request.url ?? null, request.enabled ?? null])).rows[0];
  await cancelPendingDeliveries(db, prior.id, 'destination_changed');
  return { destination: destinationProjection(row) };
}

export async function executeNotificationDestinationOperation(pool, workspaceId, actor, clientId, operationId) {
  const identity = operationIdentity('notification', workspaceId, actor, clientId, operationId);
  return authorityTransaction(pool, async db => {
    await lockWorkspaceAuthority(db, workspaceId);
    const incarnation = await workspaceOperationIncarnation(db, workspaceId, actor);
    const prior = await loadOperation(db, identity, incarnation, true);
    if (!prior) fail(404, 'notification_destination_operation_not_found');
    if (prior.receipt.state !== 'prepared') return { state: prior.receipt.state, operation: publicOperation(prior.receipt), replayed: true };
    await db.query('SAVEPOINT notification_destination_mutation');
    let result;
    try { result = await applyIntent(db, workspaceId, actor, prior.receipt.request); }
    catch (error) {
      if (!KNOWN_REJECTIONS.has(error.code)) throw error;
      await db.query('ROLLBACK TO SAVEPOINT notification_destination_mutation');
      const rejected = { ...prior.receipt, state: 'rejected', rejection: error.code, committed_at: new Date().toISOString() };
      await db.query(`UPDATE workspace_key_operations SET receipt=$1 WHERE workspace_id=$2 AND actor_user_id=$3 AND client_id=$4 AND operation_id=$5 AND family=$6`, [JSON.stringify(rejected), ...identity]);
      return { state: 'rejected', operation: publicOperation(rejected), replayed: false };
    }
    const committed = { ...prior.receipt, state: 'committed', committed_at: new Date().toISOString(),
      ...(result.destination ? { destination: result.destination } : {}), ...(result.delivery ? { delivery: result.delivery } : {}) };
    await db.query(`UPDATE workspace_key_operations SET receipt=$1 WHERE workspace_id=$2 AND actor_user_id=$3 AND client_id=$4 AND operation_id=$5 AND family=$6`, [JSON.stringify(committed), ...identity]);
    return { state: 'committed', operation: publicOperation(committed), replayed: false, ...(result.secret ? { secret: result.secret } : {}) };
  });
}

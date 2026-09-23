/** The single outgoing-webhook queue. PostgreSQL owns work; process timers only wake claimers. */
import crypto from 'node:crypto';
import { safeRequest } from '../utils/safeEndpoint.js';
import { notificationDeliveryAllowed } from './workspaceNotificationAuthority.js';
import { webhookRetryDelay } from './webhookRetryPolicy.js';
import { agentWebhookRequest, agentWebhookAcknowledged } from './agentWebhookFormat.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LEASE_MS = 30_000;
const SAFE_ERRORS = new Set(['endpoint_not_https', 'endpoint_has_credentials', 'endpoint_forbidden_address', 'endpoint_redirect_refused', 'endpoint_response_too_large', 'endpoint_timeout', 'endpoint_aborted', 'endpoint_response_aborted', 'notification_receiver_invalid']);
const errorCode = error => SAFE_ERRORS.has(error?.code) ? error.code : 'delivery_transport_failed';

export async function enqueueWebhookEvent(db, event, payload, userId, { eventId = crypto.randomUUID() } = {}) {
  // All private event producers MUST supply a principal. Only release announcements may broadcast.
  if (!userId && event !== 'new_version') throw new TypeError('A notification owner is required');
  if (userId && !UUID.test(userId)) throw new TypeError('Invalid notification owner');
  if (typeof event !== 'string' || !/^[a-z][a-z0-9_.:-]{0,99}$/i.test(event) || typeof eventId !== 'string' || !eventId.length || eventId.length > 200) throw new TypeError('Invalid notification identity');
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 128 * 1024) throw new TypeError('Notification payload exceeds limit');
  // A single INSERT..SELECT atomically fans out and deduplicates per destination.
  const result = await db.query(`
    INSERT INTO webhook_deliveries(webhook_id,event,payload,event_id,destination_url,destination_updated_at,attempt)
    SELECT id,$1::text,$2::jsonb,$3::text,url,updated_at,0 FROM webhooks
    WHERE is_active=true AND notification_workspace_id IS NULL AND deleted_at IS NULL AND $1::text=ANY(events) AND ($4::uuid IS NULL OR user_id=$4::uuid)
    ON CONFLICT(webhook_id,event_id) DO UPDATE SET event=EXCLUDED.event,payload=EXCLUDED.payload
    RETURNING id`, [event, serialized, eventId, userId || null]);
  // Existing matching identities acknowledge durable admission; immutable-content
  // trigger rejects conflicting replay atomically, including the fanout transaction.
  return result.rowCount;
}

export class WebhookDeliveryWorker {
  constructor(db, { transport = safeRequest, owner = crypto.randomUUID(), leaseMs = DEFAULT_LEASE_MS } = {}) {
    if (!Number.isInteger(leaseMs) || leaseMs <= REQUEST_TIMEOUT_MS + 1000 || leaseMs > 300_000) throw new TypeError('Invalid delivery lease');
    this.db = db; this.transport = transport; this.owner = owner; this.leaseMs = leaseMs;
    this.active = new Set(); this.closed = false;
  }

  async claim() {
    // Disabled/reconfigured destinations cannot silently receive an old event under a new URL.
    await this.db.query(`UPDATE webhook_deliveries d SET state='cancelled',cancelled_at=clock_timestamp(),fence=fence+1,error_code='destination_changed'
      FROM webhooks w WHERE d.webhook_id=w.id AND d.state IN ('queued','leased')
      AND (NOT w.is_active OR w.deleted_at IS NOT NULL OR w.url IS DISTINCT FROM d.destination_url OR w.updated_at IS DISTINCT FROM d.destination_updated_at)`);
    await this.db.query(`UPDATE webhook_deliveries SET state='failed',failed_at=clock_timestamp(),error_code='attempts_exhausted'
      WHERE attempt>=max_attempts AND (state='queued' OR (state='leased' AND lease_expires_at<=clock_timestamp()))`);
    const token = crypto.randomUUID();
    const { rows } = await this.db.query(`WITH candidate AS (
      SELECT id FROM webhook_deliveries WHERE attempt<max_attempts AND
      ((state='queued' AND COALESCE(next_retry_at,created_at)<=clock_timestamp()) OR (state='leased' AND lease_expires_at<=clock_timestamp()))
      ORDER BY COALESCE(next_retry_at,created_at),id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE webhook_deliveries d SET state='leased',lease_token=$1,lease_owner=$2,
      lease_expires_at=clock_timestamp()+($3::int * interval '1 millisecond'),fence=d.fence+1,attempt=d.attempt+1
      FROM candidate c WHERE d.id=c.id RETURNING d.*`, [token, this.owner, this.leaseMs]);
    return rows[0] || null;
  }

  async settle(delivery, { state, status = null, code = null, delayMs = 0 }) {
    const result = await this.db.query(`UPDATE webhook_deliveries SET state=$1,status_code=$2,error_code=$3,response_body=NULL,
      delivered_at=CASE WHEN $1='delivered' THEN clock_timestamp() ELSE delivered_at END,
      failed_at=CASE WHEN $1='failed' THEN clock_timestamp() ELSE NULL END,
      next_retry_at=CASE WHEN $1='queued' THEN clock_timestamp()+($4::int * interval '1 millisecond') ELSE NULL END,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL
      WHERE id=$5 AND state='leased' AND lease_token=$6 AND lease_owner=$7 AND fence=$8 AND lease_expires_at>clock_timestamp()`,
    [state, status, code, delayMs, delivery.id, delivery.lease_token, this.owner, delivery.fence]);
    return result.rowCount === 1;
  }

  async tick() {
    if (this.closed) return false;
    const delivery = await this.claim();
    if (!delivery) return false;
    const controller = new AbortController(); this.active.add(controller);
    try {
      if (!await notificationDeliveryAllowed(this.db, delivery)) {
        await this.db.query(`UPDATE webhook_deliveries SET state='cancelled',cancelled_at=clock_timestamp(),error_code='scope_authority_revoked',fence=fence+1
          WHERE id=$1 AND state='leased' AND lease_token=$2 AND fence=$3`, [delivery.id, delivery.lease_token, delivery.fence]);
        return true;
      }
      // Re-read authority after claiming, before touching the network. Secret stays inside this worker.
      const { rows } = await this.db.query(`SELECT w.url,w.secret FROM webhooks w JOIN webhook_deliveries d ON d.webhook_id=w.id
        WHERE d.id=$1 AND d.state='leased' AND d.lease_token=$2 AND d.lease_owner=$3 AND d.fence=$4
        AND d.lease_expires_at>clock_timestamp()+($5::int * interval '1 millisecond')
        AND w.is_active AND w.deleted_at IS NULL AND w.url=d.destination_url AND w.updated_at=d.destination_updated_at`,
      [delivery.id, delivery.lease_token, this.owner, delivery.fence, REQUEST_TIMEOUT_MS]);
      if (!rows.length || this.closed) return true;
      const destination = rows[0];
      const formatted = agentWebhookRequest(destination.url, delivery);
      const body = formatted?.body ?? JSON.stringify({ event: delivery.event, payload: delivery.payload, timestamp: new Date(delivery.created_at).toISOString(), deliveryId: delivery.id });
      const signature = !formatted && destination.secret ? crypto.createHmac('sha256', destination.secret).update(body).digest('hex') : null;
      const response = await this.transport(formatted?.url ?? destination.url, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'User-Agent': 'XENO-Webhooks/1.0',
        'X-Webhook-Event': delivery.event, 'X-Webhook-Delivery': delivery.id,
        ...(signature ? { 'X-Webhook-Signature': `sha256=${signature}` } : {}),
      }, body, maxBytes: 4096, timeoutMs: REQUEST_TIMEOUT_MS, signal: controller.signal });
      const delivered = formatted ? agentWebhookAcknowledged(formatted.receiver, response) : response.status >= 200 && response.status < 300;
      const retry = !delivered && (response.status === 408 || response.status === 429 || response.status >= 500) && delivery.attempt < delivery.max_attempts;
      const delayMs = retry ? webhookRetryDelay(delivery.attempt, response.retryAfter) : 0;
      await this.settle(delivery, { state: delivered ? 'delivered' : retry && delayMs !== null ? 'queued' : 'failed', status: response.status,
        code: delivered ? null : delayMs === null ? 'delivery_retry_after_out_of_range' : formatted && response.status >= 200 && response.status < 300 ? 'delivery_ack_unconfirmed' : 'delivery_http_error', delayMs: delayMs ?? 0 });
    } catch (error) {
      const code = errorCode(error);
      const retry = ['delivery_transport_failed', 'endpoint_timeout', 'endpoint_aborted', 'endpoint_response_aborted'].includes(code) && delivery.attempt < delivery.max_attempts;
      await this.settle(delivery, { state: retry ? 'queued' : 'failed', code, delayMs: webhookRetryDelay(delivery.attempt) });
    } finally { this.active.delete(controller); }
    return true;
  }

  close() { this.closed = true; for (const controller of this.active) controller.abort(); }
}


/** Cancel means no further attempts; an already accepted HTTP request cannot be recalled. */
export async function controlWebhookDelivery(db, userId, webhookId, deliveryId, operation, { workspaceId = null } = {}) {
  if (![userId, webhookId, deliveryId].every(value => UUID.test(value)) || !['cancel', 'retry'].includes(operation)) throw new TypeError('Invalid delivery control');
  if (workspaceId !== null && !UUID.test(workspaceId)) throw new TypeError('Invalid delivery workspace');
  const workspacePredicate = workspaceId === null ? 'AND w.notification_workspace_id IS NULL' : 'AND d.notification_workspace_id=$5::uuid AND w.notification_workspace_id=$5::uuid';
  const parameters = [operation === 'cancel' ? 'cancelled' : 'queued', deliveryId, webhookId, userId, ...(workspaceId === null ? [] : [workspaceId])];
  const { rows } = await db.query(`UPDATE webhook_deliveries d SET
    state=$1,fence=d.fence+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    cancelled_at=CASE WHEN $1='cancelled' THEN clock_timestamp() ELSE NULL END,
    failed_at=NULL,next_retry_at=CASE WHEN $1='queued' THEN clock_timestamp() ELSE NULL END,
    max_attempts=CASE WHEN $1='queued' THEN GREATEST(d.max_attempts,d.attempt+5) ELSE d.max_attempts END,
    error_code=CASE WHEN $1='cancelled' THEN 'cancelled_by_owner' ELSE NULL END
    FROM webhooks w WHERE d.id=$2 AND d.webhook_id=$3 AND w.id=d.webhook_id AND w.user_id=$4
    ${workspacePredicate}
    AND (($1='cancelled' AND d.state IN ('queued','leased')) OR
      ($1='queued' AND d.state IN ('failed','cancelled') AND w.is_active AND w.deleted_at IS NULL AND w.url=d.destination_url AND w.updated_at=d.destination_updated_at))
    RETURNING d.id,d.state,d.attempt,d.max_attempts`, parameters);
  return rows[0] || null;
}

export function startWebhookDeliveryWorker(db, { intervalMs = 1000, onError = () => console.error('[Webhooks] Durable worker database operation failed'), ...options } = {}) {
  const worker = new WebhookDeliveryWorker(db, options);
  let pending = null;
  const wake = () => {
    if (pending || worker.closed) return;
    pending = worker.tick().catch(onError).finally(() => { pending = null; });
  };
  const timer = setInterval(wake, intervalMs); timer.unref(); wake();
  return { async close() { clearInterval(timer); worker.close(); await pending; } };
}

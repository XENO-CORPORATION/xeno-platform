/**
 * Webhook System Routes
 *
 * Allows users to register webhooks for platform events:
 * - new_version      — New app version released
 * - build_complete   — Build pipeline finished
 * - credits_low      — Credits below threshold
 * - user_signup      — New user registered (admin only)
 *
 * This module owns REGISTRATION and ADMISSION only. Signing, retry, backoff and the
 * request itself belong to the durable worker in services/webhookDelivery.js -- see
 * `dispatchWebhookEvent` below for why the in-process sender was removed.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { assertPublicHttpUrl } from '../utils/urlGuard.js';
import { enqueueWebhookEvent, controlWebhookDelivery } from '../services/webhookDelivery.js';

const router = Router();

// Valid event types
const VALID_EVENTS = [
  'new_version',
  'build_complete',
  'credits_low',
  'user_signup',
  'generation_complete',
];

// --------------------------------------------------------------------------
// CRUD: Register / list / update / delete webhooks
// --------------------------------------------------------------------------

// List user's webhooks
router.get('/', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT id, url, events, is_active, created_at, updated_at FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, webhooks: rows });
  } catch (error) {
    console.error('[Webhooks] List error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list webhooks' });
  }
});

// Register a new webhook
router.post('/', async (req, res) => {
  try {
    const { url, events } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Validate URL: http/https + public host only (SSRF guard — deliveries are
    // server-side POSTs, so internal/private targets must be rejected)
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: 'URL must use HTTP or HTTPS' });
      }
      await assertPublicHttpUrl(url);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: e.code === 'ERR_URL_FORBIDDEN' ? 'Webhook URL must point to a public host' : 'Invalid URL format',
      });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one event type is required' });
    }

    const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid event types: ${invalidEvents.join(', ')}`,
        validEvents: VALID_EVENTS,
      });
    }

    // Generate signing secret
    const secret = crypto.randomBytes(32).toString('hex');

    const { rows } = await req.db.query(
      `INSERT INTO webhooks (user_id, url, secret, events)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, events, is_active, created_at`,
      [req.user.id, url, secret, events]
    );

    res.status(201).json({
      success: true,
      webhook: rows[0],
      secret, // Only returned once at creation
      message: 'Save this secret — it will not be shown again.',
    });
  } catch (error) {
    console.error('[Webhooks] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create webhook' });
  }
});

// Update a webhook
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { url, events, is_active } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (url !== undefined) {
      // Same validation as create: http/https + public host only (the update path
      // previously only checked parseability — an SSRF bypass).
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ success: false, error: 'URL must use HTTP or HTTPS' });
        }
        await assertPublicHttpUrl(url);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: e.code === 'ERR_URL_FORBIDDEN' ? 'Webhook URL must point to a public host' : 'Invalid URL',
        });
      }
      updates.push(`url = $${idx++}`);
      values.push(url);
    }
    if (events !== undefined) {
      if (!Array.isArray(events) || events.some(e => !VALID_EVENTS.includes(e))) {
        return res.status(400).json({ success: false, error: 'Invalid events' });
      }
      updates.push(`events = $${idx++}`);
      values.push(events);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(Boolean(is_active));
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, req.user.id);

    const { rows } = await req.db.query(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, url, events, is_active, updated_at`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    res.json({ success: true, webhook: rows[0] });
  } catch (error) {
    console.error('[Webhooks] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update webhook' });
  }
});

// Delete a webhook
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      'DELETE FROM webhooks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    console.error('[Webhooks] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete webhook' });
  }
});

// Get delivery history for a webhook
router.get('/:id/deliveries', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { rows } = await req.db.query(
      `SELECT wd.id, wd.event, wd.status_code, wd.attempt, wd.max_attempts,
              wd.delivered_at, wd.failed_at, wd.created_at, wd.state, wd.event_id,
              wd.next_retry_at, wd.cancelled_at, wd.error_code
       FROM webhook_deliveries wd
       JOIN webhooks w ON wd.webhook_id = w.id
       WHERE w.id = $1 AND w.user_id = $2 AND w.notification_workspace_id IS NULL AND w.deleted_at IS NULL
       ORDER BY wd.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.user.id, limit, offset]
    );

    res.json({ success: true, deliveries: rows });
  } catch (error) {
    console.error('[Webhooks] Deliveries error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch deliveries' });
  }
});

// --------------------------------------------------------------------------
// Webhook delivery engine (used internally)
// --------------------------------------------------------------------------

/**
 * Dispatch an event to all matching webhooks
 * @param {object} db - Database pool
 * @param {string} event - Event type (e.g. 'new_version')
 * @param {object} payload - Event payload
 * @param {string} [userId] - Optional: target specific user's webhooks
 */
/**
 * Dispatch an event to all matching webhooks.
 *
 * ADMISSION ONLY. This records the intent durably and returns; the delivery itself is made
 * by the leased worker in services/webhookDelivery.js. Nothing is sent from this call.
 *
 * WHY THIS REPLACED AN IN-PROCESS SENDER
 * --------------------------------------
 * The previous implementation POSTed from here, fire-and-forget, and scheduled its retries
 * with `setTimeout` -- backing off to 32 minutes. Those timers lived in process memory, so a
 * restart, a deploy or a crash dropped every pending retry PERMANENTLY. `next_retry_at` was
 * written on each failure and read by nothing: there was no sweeper, so a dropped retry was
 * never resumed and the row simply stayed behind forever.
 *
 * It also had no lease, so two replicas would both send; it stored up to 1 KB of the
 * endpoint's response body in the database; and it read the response unbounded.
 *
 * The worker fixes each of those: PostgreSQL owns the work, a claim takes a fenced lease,
 * authority is re-read after claiming and before the network, `response_body` is never
 * retained, and the transport caps the response.
 *
 * ⚠️ These two designs CANNOT run at once -- both would send, and every event would be
 * delivered twice. Old application instances must be stopped before this migration runs;
 * they do not honour leases and would claim nothing while still sending everything.
 *
 * @param {object} db - Database pool
 * @param {string} event - Event type (e.g. 'new_version')
 * @param {object} payload - Event payload
 * @param {string} [userId] - Optional: target a specific user's webhooks
 * @param {object} [options] - `{ eventId }` to make admission idempotent for a producer
 *   that may retry. `db` may be a pooled CLIENT, so the delivery row can commit inside the
 *   producer's own transaction -- admission is now a plain INSERT with no continuation.
 * @returns {Promise<number>} destinations the event was admitted for
 */
export async function dispatchWebhookEvent(db, event, payload, userId = null, options = {}) {
  // Deliberately NOT `return await`. `enqueueWebhookEvent` is async, so a refusal arrives as
  // a REJECTION and passes straight through this try -- which is what a transactional
  // producer needs. The forum sweep admits inside its own transaction; swallowing a refusal
  // would return 0, the sweep would read that as "no destinations matched", advance its
  // cursor, and the digest would be dropped in silence. Propagating rolls the sweep back so
  // the window is retried intact. The catch below covers a synchronous throw only.
  try {
    return enqueueWebhookEvent(db, event, payload, userId, options);
  } catch (error) {
    console.error('[Webhooks] Dispatch error:', error.message);
    return 0;
  }
}

/**
 * Delivery controls, on the same authenticated owner boundary as history.
 *
 * `cancel` stops FUTURE attempts. It cannot unsend one already accepted by the receiver,
 * and the response says so rather than implying a recall happened -- the worker may be
 * mid-request under a lease at the moment this lands, and the fence makes its settle a
 * no-op, not a retraction.
 */
router.post('/:id/deliveries/:deliveryId/:operation', async (req, res) => {
  try {
    const delivery = await controlWebhookDelivery(req.db, req.user.id, req.params.id, req.params.deliveryId, req.params.operation);
    if (!delivery) return res.status(409).json({ success: false, error: 'Delivery is unavailable or cannot transition' });
    res.json({ success: true, delivery, ...(req.params.operation === 'cancel' ? { notice: 'Future attempts cancelled; an already accepted request cannot be recalled.' } : {}) });
  } catch (error) {
    res.status(error instanceof TypeError ? 400 : 500).json({ success: false, error: 'Delivery control failed' });
  }
});

export default router;

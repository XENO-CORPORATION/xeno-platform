/**
 * Webhook System Routes
 *
 * Allows users to register webhooks for platform events:
 * - new_version      — New app version released
 * - build_complete   — Build pipeline finished
 * - credits_low      — Credits below threshold
 * - user_signup      — New user registered (admin only)
 *
 * Webhook delivery includes HMAC signature verification
 * and exponential backoff retry (up to 5 attempts).
 */

import { Router } from 'express';
import crypto from 'crypto';
import { assertSafeEndpointUrl } from '../utils/safeEndpoint.js';
import { controlWebhookDelivery, enqueueWebhookEvent } from '../services/webhookDelivery.js';

const router = Router();

// Valid event types
const VALID_EVENTS = [
  'new_version',
  'build_complete',
  'credits_low',
  'user_signup',
  'generation_complete',
  'forum.digest',
];

// --------------------------------------------------------------------------
// CRUD: Register / list / update / delete webhooks
// --------------------------------------------------------------------------

// List user's webhooks
router.get('/', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT id, url, events, is_active, created_at, updated_at FROM webhooks WHERE user_id = $1 AND notification_workspace_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC',
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

    // Early structural guard; delivery revalidates every address at socket connect.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        return res.status(400).json({ success: false, error: 'URL must use HTTPS' });
      }
      assertSafeEndpointUrl(url);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL must be a credential-free public HTTPS endpoint',
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
      // Same structural policy as create, with connect-time enforcement in the worker.
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') {
          return res.status(400).json({ success: false, error: 'URL must use HTTPS' });
        }
        assertSafeEndpointUrl(url);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: 'Webhook URL must be a credential-free public HTTPS endpoint',
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
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} AND notification_workspace_id IS NULL AND deleted_at IS NULL
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
      `UPDATE webhooks SET is_active=false,deleted_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE id=$1 AND user_id=$2 AND notification_workspace_id IS NULL AND deleted_at IS NULL`,
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
 * @param {string} [userId] - Required owner, except public new_version announcements
 */
export async function dispatchWebhookEvent(db, event, payload, userId = null, options = {}) {
  return enqueueWebhookEvent(db, event, payload, userId, options);
}

/**
 * Delivery controls use the same authenticated owner boundary as history.
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

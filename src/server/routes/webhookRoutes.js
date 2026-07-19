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
import fetch from 'node-fetch';
import { assertPublicHttpUrl } from '../utils/urlGuard.js';

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
              wd.delivered_at, wd.failed_at, wd.created_at
       FROM webhook_deliveries wd
       JOIN webhooks w ON wd.webhook_id = w.id
       WHERE w.id = $1 AND w.user_id = $2
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
export async function dispatchWebhookEvent(db, event, payload, userId = null) {
  try {
    let query = 'SELECT id, url, secret FROM webhooks WHERE is_active = true AND $1 = ANY(events)';
    const params = [event];

    if (userId) {
      query += ' AND user_id = $2';
      params.push(userId);
    }

    const { rows: webhooks } = await db.query(query, params);

    for (const webhook of webhooks) {
      // Create delivery record
      const { rows } = await db.query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload)
         VALUES ($1, $2, $3) RETURNING id`,
        [webhook.id, event, JSON.stringify(payload)]
      );

      // Fire and forget — actual delivery
      deliverWebhook(db, rows[0].id, webhook, event, payload).catch(err => {
        console.error(`[Webhooks] Delivery error for ${rows[0].id}:`, err.message);
      });
    }

    return webhooks.length;
  } catch (error) {
    console.error('[Webhooks] Dispatch error:', error.message);
    return 0;
  }
}

/**
 * Deliver a single webhook with retry logic
 */
async function deliverWebhook(db, deliveryId, webhook, event, payload, attempt = 1) {
  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
    deliveryId,
  });

  // Create HMAC signature
  const signature = webhook.secret
    ? crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
    : null;

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'XENO-Webhooks/1.0',
        'X-Webhook-Event': event,
        'X-Webhook-Delivery': deliveryId,
        ...(signature && { 'X-Webhook-Signature': `sha256=${signature}` }),
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      await db.query(
        `UPDATE webhook_deliveries
         SET status_code = $1, response_body = $2, delivered_at = NOW(), attempt = $3
         WHERE id = $4`,
        [response.status, responseBody.substring(0, 1000), attempt, deliveryId]
      );
    } else {
      throw new Error(`HTTP ${response.status}: ${responseBody.substring(0, 200)}`);
    }
  } catch (error) {
    const MAX_ATTEMPTS = 5;

    if (attempt < MAX_ATTEMPTS) {
      // Exponential backoff: 30s, 2min, 8min, 32min
      const delayMs = Math.pow(4, attempt) * 7500;
      const nextRetry = new Date(Date.now() + delayMs);

      await db.query(
        `UPDATE webhook_deliveries
         SET status_code = $1, response_body = $2, attempt = $3, next_retry_at = $4
         WHERE id = $5`,
        [0, error.message.substring(0, 1000), attempt, nextRetry.toISOString(), deliveryId]
      );

      // Schedule retry
      setTimeout(() => {
        deliverWebhook(db, deliveryId, webhook, event, payload, attempt + 1)
          .catch(err => console.error(`[Webhooks] Retry ${attempt + 1} failed:`, err.message));
      }, delayMs);
    } else {
      // Max attempts reached — mark as failed
      await db.query(
        `UPDATE webhook_deliveries
         SET status_code = 0, response_body = $1, attempt = $2, failed_at = NOW()
         WHERE id = $3`,
        [error.message.substring(0, 1000), attempt, deliveryId]
      );
    }
  }
}

export default router;

/**
 * POST /api/email/webhooks/resend — delivery events from the mail provider.
 *
 * Dogfooding 2026-09-17 (F3): `email_logs` said "sent" for a mail Resend had
 * bounced, because nothing ever told us. This closes the loop: Resend posts
 * `email.delivered` / `email.bounced` / `email.complained` / `email.failed`, and
 * the row the message id belongs to moves to that state — the activation page
 * can then say "we could not deliver to that address" instead of "check your
 * inbox" forever.
 *
 * Security: Resend signs with Svix (`svix-id`, `svix-timestamp`, `svix-signature`;
 * HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` with the base64 secret after
 * `whsec_`). Verified constant-time on the RAW body — mount BEFORE express.json,
 * like the Stripe webhook. Fail-closed: no secret configured → 503, bad or stale
 * signature → 401. Replays are harmless (the update is idempotent) and a message
 * id we never sent is a 200 with nothing done — the Resend account is shared
 * with other products, whose events also arrive here.
 */
import express from 'express';
import crypto from 'node:crypto';

const TOLERANCE_S = 5 * 60;
const STATUS_BY_EVENT = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** Svix signature check. Exported for the test; pure. */
export function verifySvix({ secret, id, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature || rawBody == null) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  // The header carries one or more `v1,<base64>` entries (key rotation).
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    let given;
    try { given = Buffer.from(sig, 'base64'); } catch { continue; }
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Apply one event to email_logs. Returns what changed; pure of HTTP. */
export async function applyEmailEvent(db, event, { now = new Date() } = {}) {
  const status = STATUS_BY_EVENT[event?.type];
  if (!status) return { applied: false, reason: 'ignored-event' };
  const providerId = event?.data?.email_id;
  if (typeof providerId !== 'string' || !providerId) return { applied: false, reason: 'no-email-id' };
  const at = event?.created_at ? new Date(event.created_at) : now;
  const detail = status === 'bounced'
    ? [event?.data?.bounce?.type, event?.data?.bounce?.subType, event?.data?.bounce?.message].filter(Boolean).join(': ').slice(0, 500) || 'bounced'
    : status === 'failed' ? String(event?.data?.failed?.reason || 'failed').slice(0, 500)
    : status === 'complained' ? 'recipient marked the message as spam'
    : null;
  // A terminal bad state is never overwritten by a later "delivered" (Resend can
  // deliver-then-bounce on some receivers; the bounce is the fact that matters).
  const { rowCount } = await db.query(
    `UPDATE email_logs
        SET status = $2, error = COALESCE($3, error), event_at = $4
      WHERE provider_id = $1
        AND NOT (status IN ('bounced', 'complained') AND $2 = 'delivered')`,
    [providerId, status, detail, Number.isNaN(at.getTime()) ? now : at],
  );
  return { applied: rowCount > 0, status, providerId, rows: rowCount };
}

const router = express.Router();

router.post('/resend', async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'webhook_not_configured' });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
  const ok = verifySvix({
    secret, rawBody,
    id: req.get('svix-id'), timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature'),
  });
  if (!ok) return res.status(401).json({ error: 'invalid_signature' });
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  try {
    const result = await applyEmailEvent(req.db, event);
    if (result.applied) console.log(`[email-webhook] ${event.type} → ${result.status} (${result.providerId})`);
    return res.json({ received: true, ...result });
  } catch (e) {
    console.error('[email-webhook] apply failed:', e.message);
    return res.status(500).json({ error: 'apply_failed' });
  }
});

export default router;

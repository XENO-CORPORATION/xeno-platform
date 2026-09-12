import crypto from 'node:crypto';

const PREFIX = 'xsched_';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function scheduledRunTokenConfigured() {
  return Boolean(process.env.SCHEDULED_RUN_TOKEN_SECRET);
}

export function mintScheduledRunToken({ runId, userId, maxCredits = 0, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  const secret = process.env.SCHEDULED_RUN_TOKEN_SECRET;
  if (!secret) {
    throw Object.assign(new Error('Scheduled run identity is unavailable'), { code: 'scheduled_run_identity_unavailable' });
  }
  if (!runId || !userId) {
    throw Object.assign(new Error('Scheduled run identity is incomplete'), { code: 'scheduled_run_identity_invalid' });
  }
  const payload = Buffer.from(JSON.stringify({
    runId: String(runId),
    userId: String(userId),
    maxCredits: Number(maxCredits) || 0,
    exp: Number(now) + Math.max(1_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, 15 * 60 * 1000)),
  }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${PREFIX}${payload}.${signature}`;
}

// The SQL queue persists delays as int milliseconds. Never truncate a receiver's
// requested delay to that bound: refuse automatic retry rather than retry early.
export const MAX_WEBHOOK_RETRY_DELAY_MS = 2_147_483_647;

export function webhookRetryDelay(attempt, retryAfter, now = Date.now()) {
  const fallback = Math.min(3_600_000, 7500 * 4 ** Math.min(Math.max(0, attempt), 8));
  if (typeof retryAfter !== 'string' || !retryAfter.trim()) return fallback;
  const value = retryAfter.trim();
  let requested;
  if (/^\d+$/.test(value)) requested = Number(value) * 1000;
  else {
    // Do not let Date.parse's permissive numeric and locale parsing turn malformed
    // delta seconds into a calendar date. HTTP dates have a named weekday/month.
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(value) || !/[A-Za-z]{3}/.test(value)) return fallback;
    const deadline = Date.parse(value);
    if (!Number.isFinite(deadline)) return fallback;
    requested = Math.max(0, deadline - now);
  }
  if (!Number.isSafeInteger(requested) || requested > MAX_WEBHOOK_RETRY_DELAY_MS) return null;
  return Math.max(fallback, requested);
}

/**
 * The Forum's typed error.
 *
 * ── WHY IT LIVES IN ITS OWN MODULE ──────────────────────────────────────────
 *
 * It was defined in `forumWrite.js`, which already imports `forumService.js`.
 * The moment a rule had to be enforced in the READ path — the digest's
 * `max_per_hour` — the service needed to throw one, and importing it from the
 * write module would have closed a cycle.
 *
 * ESM tolerates cycles until it doesn't: the failure mode is a binding that is
 * `undefined` at module-evaluation time depending on which side was imported
 * first, which presents as an intermittent `ForumError is not a constructor`
 * and is miserable to diagnose. A shared type does not belong in either
 * consumer.
 *
 * `forumWrite.js` re-exports it, so every existing import keeps working.
 *
 * ── `details` ───────────────────────────────────────────────────────────────
 *
 * Carries structured fields the client can ACT on — `retryAfterSeconds` being
 * the motivating case. A rate limit that says only "too fast" leaves an agent
 * with nothing but a retry loop, which is the behaviour the limit exists to
 * stop; one that says "in 847 seconds" lets it schedule.
 */
export class ForumError extends Error {
  constructor(message, code, statusCode = 400, details = null) {
    super(message);
    this.name = 'ForumError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

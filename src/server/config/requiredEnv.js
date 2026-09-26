/**
 * requiredEnv — the keys each process cannot run correctly without, checked at boot.
 *
 * 🔴 WHY THIS EXISTS. Docker Compose hands a key to a container ONLY if that
 * service's `environment:` block names it. `.env` feeds `${}` substitution and
 * nothing else — no service here uses `env_file:`. On 2026-08-24 the compose file
 * was replaced from git, and REGISTRATION_OPEN, RESEND_API_KEY,
 * FORUM_NOTIFICATION_EMAILS, XENO_EXTENSION_ORIGINS and all five STRIPE_* keys
 * stopped reaching the backend while still sitting in `.env`.
 *
 * Nothing crashed. Signup answered "registration is closed" and mail was
 * "disabled" — every key degraded into a state that looks DELIBERATE, which is
 * why it went unnoticed for most of a day. A missing key is only dangerous when
 * its absence is plausible.
 *
 * Two tiers, because a missing key is not one kind of failure:
 *
 *   required  The process is broken or unsafe without it: refuse to boot. That
 *             is safe, not reckless — the deploy pipeline's per-replica health
 *             gate stops the rollout and the previous replica keeps serving.
 *   expected  A feature silently degrades into a plausible state: boot, but say
 *             so at FATAL level on every start and export it on /metrics, where
 *             an alert rule turns it into an email. Refusing to boot over a
 *             missing mail key would turn a partial outage into a total one.
 *
 * An EMPTY value counts as missing — `REGISTRATION_OPEN=` (empty) closed signup
 * for twelve days from 2026-08-29.
 *
 * `forbidden` lists defaults committed to git. A key set to one of those is worse
 * than unset, because it WORKS — so a forbidden value refuses to boot even when
 * the key is only `expected`.
 *
 * Every key below was confirmed set inside the running container before this
 * shipped (2026-09-13), so the check cannot take down the deploy that adds it.
 * `scripts/required-env.test.mjs` asserts each key is also PASSED by its
 * service's compose block — that gate catches the 2026-08-24 class in a test run
 * instead of in production.
 *
 * Deliberately NOT listed:
 *   SALES_OPEN   empty is its designed CLOSED state — fail-closed, so an env
 *                mishap stops sales rather than charging cards.
 *   STRIPE_* / RESEND_API_KEY in chat-workers — the worker imports
 *                billingService for entitlementsFor/getPlan only, which read no
 *                provider key. A worker holding payment secrets it never uses is
 *                blast radius, not coverage.
 */

const JWT_COMMITTED_DEFAULT = 'xenostudio-super-secret-jwt-key-change-in-production';
const DB_COMMITTED_DEFAULT = 'xenostudio_password';

export const REQUIRED_ENV = {
  backend: {
    required: [
      { key: 'DB_HOST', why: 'the pool falls back to localhost, which is nothing inside a container' },
      { key: 'DB_PASSWORD', why: 'the pool falls back to a password committed to git', forbidden: [DB_COMMITTED_DEFAULT] },
      { key: 'DATABASE_URL', why: 'the conversion-models pool connects with it' },
      { key: 'JWT_SECRET', why: 'every session token is signed with it', forbidden: [JWT_COMMITTED_DEFAULT] },
      { key: 'SECRET_BOX_KEY', why: 'every stored secret is decrypted with it' },
      { key: 'REDIS_URL', why: 'Redis runs with requirepass and the fallback URL carries no password' },
      { key: 'LEDGER_SERVICE_TOKEN', why: 'the gateway-to-ledger money path authenticates with it' },
    ],
    expected: [
      { key: 'RESEND_API_KEY', why: 'all outbound mail stops, including activation codes' },
      { key: 'STRIPE_SECRET_KEY', why: 'checkout and the billing portal stop' },
      { key: 'STRIPE_PUBLISHABLE_KEY', why: 'the client cannot open Stripe' },
      { key: 'STRIPE_WEBHOOK_SECRET', why: 'paid checkouts are never credited' },
      { key: 'STRIPE_EXPECTED_MODE', why: 'the live/test account guard is off' },
      { key: 'STRIPE_EXPECTED_ACCOUNT_ID', why: 'the wrong-Stripe-account guard is off' },
      { key: 'REGISTRATION_OPEN', why: 'signup reads as deliberately closed' },
      { key: 'FORUM_NOTIFICATION_EMAILS', why: 'forum notification mail reads as disabled' },
      { key: 'XENO_EXTENSION_ORIGINS', why: 'the browser extension is refused by CORS' },
      { key: 'SUBJECT_HASH_SECRET', why: 'digests fall back to JWT_SECRET, so rotating it orphans every consent record' },
      { key: 'XENO_API_KEY', why: 'chat requests to the inference gateway are unauthenticated' },
      { key: 'CF_TURN_KEY_ID', why: 'XENO Shell sessions fall back to STUN only, so shells behind a blocking NAT cannot meet' },
      { key: 'CF_TURN_KEY_API_TOKEN', why: 'XENO Shell sessions fall back to STUN only, so shells behind a blocking NAT cannot meet' },
    ],
  },
  'chat-workers': {
    required: [
      { key: 'DB_HOST', why: 'the pool falls back to localhost, which is nothing inside a container' },
      { key: 'DB_PASSWORD', why: 'the pool falls back to a password committed to git', forbidden: [DB_COMMITTED_DEFAULT] },
    ],
    expected: [
      { key: 'JWT_SECRET', why: 'signed Library links cannot be minted', forbidden: [JWT_COMMITTED_DEFAULT] },
      { key: 'SCHEDULED_RUN_TOKEN_SECRET', why: 'every scheduled chat run fails to mint its gateway identity' },
      { key: 'XENO_API_KEY', why: 'scheduled chat requests to the inference gateway are unauthenticated' },
    ],
  },
};

const present = (env, key) => typeof env[key] === 'string' && env[key].trim() !== '';

/** Pure: which keys are unusable for `role`. Never touches process state. */
export function checkEnv(role, env = process.env) {
  const spec = REQUIRED_ENV[role];
  if (!spec) throw new Error(`requiredEnv: unknown role "${role}"`);
  const all = [...spec.required, ...spec.expected];
  return {
    missingRequired: spec.required.filter((e) => !present(env, e.key)).map((e) => e.key),
    forbidden: all.filter((e) => present(env, e.key) && (e.forbidden || []).includes(env[e.key].trim())).map((e) => e.key),
    missingExpected: spec.expected.filter((e) => !present(env, e.key)).map((e) => e.key),
  };
}

/**
 * Check, log, and refuse to boot in production when a required key is unusable.
 * Logs key NAMES and consequences only — never a value, not even a length.
 */
export function enforceEnv(role, { env = process.env, exit = (code) => process.exit(code), log = console } = {}) {
  const result = checkEnv(role, env);
  const spec = REQUIRED_ENV[role];
  const why = (key) => ([...spec.required, ...spec.expected].find((e) => e.key === key) || {}).why || '';

  if (env.NODE_ENV !== 'production') {
    const keys = [...result.missingRequired, ...result.forbidden, ...result.missingExpected];
    if (keys.length) log.warn(`[config:${role}] ${keys.length} production key(s) unset — fine outside production: ${keys.join(', ')}`);
    return result;
  }

  for (const key of result.missingExpected) {
    log.error(`FATAL-CONFIG [${role}] expected key ${key} is missing or empty — ${why(key)}. Booting anyway; this is DEGRADED, not deliberate.`);
  }
  for (const key of result.forbidden) {
    log.error(`FATAL: [${role}] ${key} is set to a default committed to git — ${why(key)}.`);
  }
  for (const key of result.missingRequired) {
    log.error(`FATAL: [${role}] required key ${key} is missing or empty — ${why(key)}.`);
  }
  if (result.missingRequired.length || result.forbidden.length) {
    const n = result.missingRequired.length + result.forbidden.length;
    log.error(`FATAL: [${role}] refusing to boot — ${n} key(s) unusable. Is each one named in this service's docker-compose environment: block? .env alone reaches no container.`);
    exit(1);
  }
  return result;
}

/**
 * The download funnel — one intent, one state machine.
 *
 * ── WHY THIS IS ONE FILE AND NOT FOUR ───────────────────────────────────────
 *
 * A person wanting an installer may be missing any of four things: an identity,
 * a profile, a plan, or a published artifact. The obvious implementation teaches
 * four surfaces about downloads — the product page, the auth page, onboarding,
 * and pricing each learn a bit of the rule.
 *
 * That is the design that rots. The four copies drift, the order becomes
 * implicit, and adding a fifth precondition (a licence agreement, an age gate, a
 * region check) means finding every surface that guessed. So the rule lives HERE,
 * once, and every surface asks it what to do.
 *
 * 🔴 THE ORDER IS NOT ARBITRARY AND MUST NOT BE REORDERED FOR CONVENIENCE:
 *
 *   signin → onboarding → plan → artifact → ready
 *
 * Identity first because nothing can be attributed to a person we cannot name.
 * Onboarding before payment because asking someone to pay before we know what
 * they came for wastes the one moment they are most willing to tell us — and
 * because a refund is expensive and a survey is free. Plan before artifact
 * because refusing on entitlement must never reveal which builds exist. Artifact
 * last because it is the only check that can fail for a reason the PERSON cannot
 * fix, and telling someone "there is no macOS build" after they have paid is a
 * refund; telling them before is honesty.
 *
 * ── ONBOARDING IS SEQUENCING, NOT ENFORCEMENT ───────────────────────────────
 *
 * 🔴 The grant endpoint deliberately does NOT require onboarding. This state
 * machine ROUTES a person through it, because that is the moment they are most
 * willing to tell us what they came for — but the only thing that guards the
 * bytes is `canDownload`.
 *
 * Someone calling the API directly with a paid plan therefore gets their file
 * without answering a survey, and that is correct. Adding onboarding to the
 * entitlement check would refuse a paying customer over an unanswered
 * questionnaire, which is a support incident dressed up as a control. If you are
 * here because "you can skip onboarding via the API" looked like a hole: it is
 * not a hole, it is the boundary between UX and enforcement, and a gate pins it.
 *
 * ── WHAT AN INTENT IS NOT ───────────────────────────────────────────────────
 *
 * It is not a credential. `resolve()` re-derives everything from the live
 * database on every call and trusts nothing stored on the intent row. A stolen
 * token yields the name of a product, which was public anyway.
 */
import crypto from 'crypto';
import { entitlementsFor } from './billingService.js';
/* Effective, not personal: a Team member is licensed by their workspace. */
import { getEffectivePlan } from './effectivePlan.js';

/** The vocabulary. Asserted here rather than in a CHECK constraint — a funnel
 *  gains steps, and a migration-per-step is how recording stops happening. */
export const STEPS = Object.freeze({
  CREATED: 'created',
  SIGNIN_REQUIRED: 'signin_required',
  SIGNIN_COMPLETED: 'signin_completed',
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_REQUIRED: 'onboarding_required',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  PLAN_REQUIRED: 'plan_required',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  UNAVAILABLE: 'unavailable',
  GRANT_MINTED: 'grant_minted',
  RESUMED: 'resumed',
});

/** The states `resolve()` can return. The client renders one branch per state. */
export const STATES = Object.freeze({
  SIGNIN: 'signin',
  ONBOARDING: 'onboarding',
  PLAN: 'plan',
  UNAVAILABLE: 'unavailable',
  READY: 'ready',
});

const OS_ALIASES = {
  win: 'windows', windows: 'windows',
  mac: 'mac', macos: 'mac', osx: 'mac',
  linux: 'linux', appimage: 'linux',
};

export const normaliseOs = (raw) => OS_ALIASES[String(raw || '').toLowerCase()] || null;

/** URL-safe, unguessable, and visibly not a database id. */
export function mintIntentToken() {
  return crypto.randomBytes(24).toString('base64url');
}

let ensured = null;
/** The funnel tables are created by migration; this is a cheap existence probe
 *  so a route can fail with a clear message instead of a raw 42P01. */
export async function funnelReady(pool) {
  if (ensured) return ensured;
  ensured = pool
    .query("SELECT to_regclass('public.download_intents') AS t")
    .then((r) => Boolean(r.rows[0]?.t))
    .catch(() => false);
  return ensured;
}

/* ── Recording ────────────────────────────────────────────────────────────── */

/**
 * Append one step. NEVER throws into the caller.
 *
 * 🔴 Analytics must not be able to break the product. A funnel that fails the
 * download when its own logging fails has inverted the priority: the person is
 * here for the software, not to be measured. Every failure here is swallowed to
 * a log line, exactly like the onboarding email.
 */
export async function record(pool, intentId, step, detail = {}, { userId = null, clientIp = null } = {}) {
  if (!pool || !intentId) return;
  try {
    await pool.query(
      `INSERT INTO download_intent_events (intent_id, step, detail, user_id, client_ip)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [intentId, step, JSON.stringify(detail || {}), userId, clientIp],
    );
  } catch (e) {
    console.error('[Funnel] failed to record step', step, e.message);
  }
}

/**
 * Record a step at most once per intent.
 *
 * Used for the milestones that are INFERRED from state rather than announced by
 * a client — "they were blocked on onboarding and are no longer". The resume
 * page can be polled or reloaded arbitrarily many times, and a milestone that
 * fires on every poll turns the funnel into noise that cannot be counted.
 *
 * Idempotent in SQL rather than in a read-then-write, because the resume page
 * polls concurrently with itself in practice (a reload mid-poll) and a
 * check-then-insert would race.
 */
export async function recordOnce(pool, intentId, step, detail = {}, opts = {}) {
  if (!pool || !intentId) return;
  try {
    await pool.query(
      `INSERT INTO download_intent_events (intent_id, step, detail, user_id, client_ip)
       SELECT $1, $2, $3::jsonb, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM download_intent_events WHERE intent_id = $1 AND step = $2
       )`,
      [intentId, step, JSON.stringify(detail || {}), opts.userId || null, opts.clientIp || null],
    );
  } catch (e) {
    console.error('[Funnel] failed to record milestone', step, e.message);
  }
}

/** Set attribution flags, additively. A flag never goes back to false: it records
 *  that a boundary WAS crossed, not where the person is now. */
export async function flag(pool, intentId, patch) {
  if (!pool || !intentId) return;
  const cols = [];
  const vals = [];
  let n = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    /* Booleans OR in, so a later false cannot erase a crossing that happened. */
    cols.push(typeof v === 'boolean' ? `${k} = ${k} OR $${n}` : `${k} = $${n}`);
    vals.push(v);
    n += 1;
  }
  if (!cols.length) return;
  vals.push(intentId);
  try {
    await pool.query(
      `UPDATE download_intents SET ${cols.join(', ')}, updated_at = NOW() WHERE id = $${n}`,
      vals,
    );
  } catch (e) {
    console.error('[Funnel] failed to flag intent', e.message);
  }
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export async function createIntent(pool, {
  slug, os, version = '', channel = 'stable',
  anonId = null, userId = null, originPath = null, referrer = null, utm = {},
}) {
  const token = mintIntentToken();
  const r = await pool.query(
    `INSERT INTO download_intents
       (token, slug, os, version, channel, anon_id, user_id, origin_path, referrer, utm)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    [token, slug, os, version, channel, anonId, userId, originPath, referrer, JSON.stringify(utm || {})],
  );
  return r.rows[0];
}

/**
 * An intent, if it is still live.
 *
 * 🔴 Expiry is enforced HERE, on read, not only by the sweeper. A sweeper is
 * hygiene — it keeps the table bounded — and hygiene running every 30 minutes is
 * not a guarantee. If expiry existed only in the sweeper, a link would keep
 * working for up to half an hour past its own deadline, which means the deadline
 * is not real. Lazy refusal makes `expires_at` mean what it says at every
 * instant; the sweeper then only decides how long the rows are KEPT.
 *
 * An expired intent is indistinguishable from an unknown one to the caller, for
 * the same reason a stranger's intent is: no oracle.
 */
export async function findIntent(pool, token) {
  if (typeof token !== 'string' || !token) return null;
  const r = await pool.query(
    'SELECT * FROM download_intents WHERE token = $1 AND expires_at > NOW()',
    [token],
  );
  return r.rows[0] || null;
}

/**
 * Mark expired intents and delete the long-dead ones.
 *
 * ⚠️ This exists because `expires_at` was added to the schema and NOTHING read
 * it — a column that describes a policy nobody enforces, which is the same
 * built-but-unreachable shape this codebase keeps finding. An unbounded row per
 * anonymous button press is a slow disk-filling primitive.
 *
 * Two stages on purpose. Marking keeps a recent expiry VISIBLE in the funnel
 * data — "this person tried and never came back" is a real and useful outcome,
 * and deleting it immediately would silently improve every conversion rate by
 * erasing the failures. Only genuinely old rows are removed.
 */
export async function sweepExpiredIntents(pool) {
  let marked = 0;
  let deleted = 0;
  try {
    const m = await pool.query(
      "UPDATE download_intents SET status = 'expired', updated_at = NOW() "
      + "WHERE status = 'open' AND expires_at <= NOW()",
    );
    marked = m.rowCount || 0;
    /* Events cascade with the intent. 180 days is well past any reporting window
     * anyone has asked for, and keeps the table from growing without bound. */
    const d = await pool.query(
      "DELETE FROM download_intents WHERE expires_at < NOW() - INTERVAL '180 days'",
    );
    deleted = d.rowCount || 0;
  } catch (e) {
    console.error('[Funnel] sweep failed:', e.message);
  }
  return { marked, deleted };
}

/**
 * Bind an intent to a user, once we know who they are.
 *
 * Deliberately first-write-wins on `user_id`: an intent belongs to whoever was
 * actually converted by it, and letting a second account claim it would let one
 * person rewrite another's attribution — and, worse, would let an attacker
 * attach their own account to a stranger's intent to read its state.
 */
export async function claimIntent(pool, intent, userId, { wasSignup = false, clientIp = null } = {}) {
  if (!intent || !userId) return intent;
  if (intent.user_id && intent.user_id !== userId) return intent;

  if (!intent.user_id) {
    await pool.query('UPDATE download_intents SET user_id = $1, updated_at = NOW() WHERE id = $2',
      [userId, intent.id]);
    await flag(pool, intent.id, { required_signin: true, required_signup: wasSignup });
    await record(pool, intent.id,
      wasSignup ? STEPS.SIGNUP_COMPLETED : STEPS.SIGNIN_COMPLETED,
      {}, { userId, clientIp });
  }
  return { ...intent, user_id: userId };
}

async function hasFinishedOnboarding(pool, userId) {
  try {
    const r = await pool.query(
      'SELECT completed_at, skipped_at FROM user_onboarding WHERE user_id = $1',
      [String(userId)],
    );
    const row = r.rows[0];
    /* Skipped counts as finished. Someone who deliberately declined must not be
     * asked again on every download — that is nagging, not onboarding. */
    return Boolean(row && (row.completed_at || row.skipped_at));
  } catch {
    /* 🔴 Fails OPEN, and only this one does. Every other check in resolve()
     * fails closed because it guards money or bytes. This one guards a SURVEY:
     * a database hiccup that sends a paying customer back through onboarding
     * instead of to their download is a worse outcome than an unanswered
     * questionnaire, and there is nothing to protect by refusing. */
    return true;
  }
}

/**
 * What is this person missing, right now?
 *
 * Everything is re-derived live. Nothing on the intent row is trusted, because
 * the row is written by a pre-auth caller.
 */
export async function resolve(pool, intent, user, { releases = null } = {}) {
  if (!user?.id) {
    return { state: STATES.SIGNIN, reason: 'not_signed_in' };
  }

  if (!(await hasFinishedOnboarding(pool, user.id))) {
    return { state: STATES.ONBOARDING, reason: 'onboarding_incomplete' };
  }

  /* Fails CLOSED to free — a database fault must refuse, not hand over bytes. */
  let plan = { plan: 'free', status: 'none' };
  try {
    plan = await getEffectivePlan(pool, user.id);
  } catch (e) {
    console.error('[Funnel] plan lookup failed, refusing', e.message);
  }
  const ent = entitlementsFor(plan.plan);
  if (!ent?.canDownload) {
    return { state: STATES.PLAN, reason: 'no_plan', currentPlan: plan.plan };
  }

  /* Artifact LAST, and only for an entitled caller — so a refusal never reveals
   * which builds exist. `releases` is injected so this stays testable and so the
   * caller controls the fetch/caching policy. */
  if (releases) {
    /* awaited — assetFor is async, and an unresolved Promise is truthy, so a
     * missing `await` here makes UNAVAILABLE unreachable and tells everyone
     * they are READY for platforms that do not exist. */
    const asset = await releases.assetFor(intent.slug, intent.os, intent.version, intent.channel);
    if (!asset) {
      return { state: STATES.UNAVAILABLE, reason: 'no_asset', plan: plan.plan };
    }
    return { state: STATES.READY, plan: plan.plan, version: asset.version, filename: asset.file };
  }

  return { state: STATES.READY, plan: plan.plan };
}

/** The path a surface should send someone to for a given state. ONE definition,
 *  so the button, the resume page and the server cannot disagree about it. */
export function nextPathFor(state, token) {
  const resume = `/download/resume?i=${encodeURIComponent(token)}`;
  switch (state) {
    case STATES.SIGNIN:
      /* BOTH parameters, and they do different jobs. `returnUrl` is what an
       * EXISTING account follows straight after sign-in. `next` is what survives
       * onboarding for a NEW account — resolveOAuthLandingPath() sends a new
       * account with a deep-link returnUrl directly to that link, skipping
       * onboarding, so returnUrl alone would silently drop the profile step. */
      return `/login?returnUrl=${encodeURIComponent(resume)}&next=${encodeURIComponent(resume)}`;
    case STATES.ONBOARDING:
      return `/onboarding?next=${encodeURIComponent(resume)}`;
    case STATES.PLAN:
      return `/pricing?i=${encodeURIComponent(token)}`;
    default:
      return resume;
  }
}

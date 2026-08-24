/**
 * The funnel's public surface.
 *
 *   POST /api/downloads/intent            create one (ANONYMOUS — that is the point)
 *   GET  /api/downloads/intent/:token     what is this person missing, right now
 *   POST /api/downloads/intent/:token/claim   bind it to the account that just signed in
 *
 * ── WHY THE FIRST TWO ARE UNAUTHENTICATED ───────────────────────────────────
 *
 * An intent exists precisely because the person does NOT yet have an account.
 * Requiring auth to record "I want Hub for Windows" would mean the funnel only
 * ever sees people who already converted, which is the one population it does
 * not need to measure.
 *
 * 🔴 That makes them abuse-reachable, so they are built to be worth abusing as
 * little as possible: they mint nothing, grant nothing, and reveal nothing that
 * is not already on the marketing site. `GET` returns a STATE — "you need to
 * sign in", "you need a plan" — never a filename, never a URL, and never a hint
 * about a build that is not published. The only thing behind them is a row.
 *
 * Rate-limited anyway, because "cheap to abuse" is not "free to abuse": an
 * unbounded anonymous INSERT is a disk-filling primitive whatever it stores.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../utils/clientIp.js';
import { releaseLookup } from '../services/releaseCatalog.js';
import {
  STATES, STEPS, normaliseOs, createIntent, findIntent, claimIntent,
  resolve, record, recordOnce, flag, nextPathFor, funnelReady,
} from '../services/downloadFunnel.js';

export const router = express.Router();

const ipOf = (req) => {
  try { return rateLimitKey(req); } catch { return null; }
};

/* Generous — a person comparing three products on two machines is normal, and a
 * limit that catches them is a conversion bug wearing a security costume. It is
 * here to stop a script, not a shopper. */
const intentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many download attempts. Try again shortly.' } },
});

/** Everything a client needs to act, and nothing it does not. */
function envelope(intent, verdict) {
  return {
    token: intent.token,
    slug: intent.slug,
    os: intent.os,
    state: verdict.state,
    reason: verdict.reason || null,
    next: nextPathFor(verdict.state, intent.token),
    /* Only ever populated for a READY caller — see resolve(): the artifact check
     * runs last precisely so a refusal cannot leak what exists. */
    version: verdict.version || null,
    filename: verdict.filename || null,
    currentPlan: verdict.currentPlan || verdict.plan || null,
  };
}

async function guard(req, res) {
  if (!req.db) {
    res.status(503).json({ error: { code: 'NO_DB', message: 'Downloads are temporarily unavailable.' } });
    return false;
  }
  if (!(await funnelReady(req.db))) {
    res.status(503).json({ error: { code: 'FUNNEL_UNAVAILABLE', message: 'Downloads are temporarily unavailable.' } });
    return false;
  }
  return true;
}

router.post('/intent', intentLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!(await guard(req, res))) return;

  const slug = String(req.body?.slug || '').toLowerCase();
  const os = normaliseOs(req.body?.os);
  if (!/^[a-z0-9-]+$/.test(slug) || !os) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'slug and os are required' } });
  }

  const intent = await createIntent(req.db, {
    slug,
    os,
    version: req.body?.version ? String(req.body.version).replace(/^v/i, '') : '',
    channel: req.body?.channel === 'beta' ? 'beta' : 'stable',
    /* Client-supplied and therefore NOT trusted for anything but grouping. It
     * cannot grant, and two visitors claiming the same anon_id corrupts a
     * marketing number, not a permission. */
    anonId: typeof req.body?.anonId === 'string' ? req.body.anonId.slice(0, 64) : null,
    userId: req.user?.id || null,
    originPath: typeof req.body?.originPath === 'string' ? req.body.originPath.slice(0, 512) : null,
    referrer: typeof req.body?.referrer === 'string' ? req.body.referrer.slice(0, 512) : null,
    utm: (req.body?.utm && typeof req.body.utm === 'object') ? req.body.utm : {},
  });

  await record(req.db, intent.id, STEPS.CREATED,
    { slug, os, originPath: intent.origin_path }, { userId: req.user?.id || null, clientIp: ipOf(req) });

  const verdict = await resolve(req.db, intent, req.user, { releases: releaseLookup });
  await recordVerdict(req, intent, verdict);

  return res.status(201).json(envelope(intent, verdict));
});

/** The step the person is now blocked on is itself a funnel event — that is the
 *  drop-off measurement, and without it the table records only successes. */
async function recordVerdict(req, intent, verdict) {
  const step = {
    [STATES.SIGNIN]: STEPS.SIGNIN_REQUIRED,
    [STATES.ONBOARDING]: STEPS.ONBOARDING_REQUIRED,
    [STATES.PLAN]: STEPS.PLAN_REQUIRED,
    [STATES.UNAVAILABLE]: STEPS.UNAVAILABLE,
  }[verdict.state];
  if (!step) return;
  await record(req.db, intent.id, step, { reason: verdict.reason },
    { userId: req.user?.id || null, clientIp: ipOf(req) });
  if (verdict.state === STATES.ONBOARDING) await flag(req.db, intent.id, { required_onboarding: true });
  if (verdict.state === STATES.PLAN) await flag(req.db, intent.id, { required_purchase: true });
}

/**
 * The milestones nobody announces.
 *
 * A person who finishes onboarding does not tell us — they just come back, and
 * the state machine quietly stops saying ONBOARDING. Inferring the crossing here
 * is strictly better than asking the client to report it: a browser closed on
 * the last onboarding screen still reports the completion the moment they
 * return, and no analytics call can be lost or blocked.
 */
async function recordCrossings(req, intent, verdict) {
  const opts = { userId: req.user?.id || null, clientIp: ipOf(req) };
  if (intent.required_onboarding && verdict.state !== STATES.ONBOARDING) {
    await recordOnce(req.db, intent.id, STEPS.ONBOARDING_COMPLETED, {}, opts);
  }
}

router.get('/intent/:token', intentLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!(await guard(req, res))) return;

  const intent = await findIntent(req.db, req.params.token);
  /* 404 for an unknown token, and the same 404 for someone else's — see below. */
  if (!intent) {
    return res.status(404).json({ error: { code: 'NO_INTENT', message: 'That download link has expired.' } });
  }

  /* 🔴 An intent bound to another account is INVISIBLE, not forbidden. A 403
   * would confirm the token is real, turning this endpoint into an oracle for
   * guessing valid tokens; a 404 tells an attacker nothing they did not have. */
  if (intent.user_id && req.user?.id && intent.user_id !== req.user.id) {
    return res.status(404).json({ error: { code: 'NO_INTENT', message: 'That download link has expired.' } });
  }

  /* Claim on read. The auth round-trip lands back here, so this is where "the
   * anonymous person became a known one" is actually observable. */
  let live = intent;
  if (req.user?.id && !intent.user_id) {
    live = await claimIntent(req.db, intent, req.user.id, { clientIp: ipOf(req) });
  }

  const verdict = await resolve(req.db, live, req.user, { releases: releaseLookup });
  await recordVerdict(req, live, verdict);
  await recordCrossings(req, live, verdict);
  return res.json(envelope(live, verdict));
});

/**
 * Explicitly bind an intent to the caller, and say whether this was a signup.
 * The client knows that; the server cannot infer it from a token alone.
 */
router.post('/intent/:token/claim', intentLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!(await guard(req, res))) return;
  if (!req.user?.id) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in first.' } });
  }
  const intent = await findIntent(req.db, req.params.token);
  if (!intent) {
    return res.status(404).json({ error: { code: 'NO_INTENT', message: 'That download link has expired.' } });
  }
  if (intent.user_id && intent.user_id !== req.user.id) {
    return res.status(404).json({ error: { code: 'NO_INTENT', message: 'That download link has expired.' } });
  }

  const live = await claimIntent(req.db, intent, req.user.id, {
    wasSignup: req.body?.signup === true,
    clientIp: ipOf(req),
  });
  const verdict = await resolve(req.db, live, req.user, { releases: releaseLookup });
  await recordVerdict(req, live, verdict);
  await recordCrossings(req, live, verdict);
  return res.json(envelope(live, verdict));
});

export default router;

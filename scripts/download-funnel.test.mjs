/**
 * THE FUNNEL — one intent, carried across four boundaries.
 *
 * The thing being protected here is not "does the button work". It is that a
 * person's INTENT survives identity, profile, payment and entitlement, and that
 * carrying it across those boundaries does not accidentally carry AUTHORITY with
 * it.
 *
 * Those two requirements pull against each other, and that tension is what these
 * gates hold:
 *
 *   - the intent must travel through URLs, through a third party (Stripe) and
 *     through an OAuth round-trip, so it must be worthless to steal;
 *   - it must still be enough, on return, to finish the job without asking the
 *     person to start over.
 *
 * The resolution is that an intent names a WISH and never a PERMISSION. Every
 * gate below is ultimately checking that nothing has quietly turned it into a
 * credential.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'funnel-test-secret';

const {
  STATES, STEPS, resolve, nextPathFor, normaliseOs, mintIntentToken, record, recordOnce,
} = await import('../src/server/services/downloadFunnel.js');

const read = (f) => readFileSync(f, 'utf8');
const funnelSvc = read('src/server/services/downloadFunnel.js');
const funnelRoutes = read('src/server/routes/downloadFunnelRoutes.js');
const billing = read('src/server/services/billingService.js');
const index = read('src/server/index.js');
const pricingPage = read('src/pages/Pricing.tsx');
const resumePage = read('src/pages/DownloadResume.tsx');
const flowLib = read('src/lib/downloadFlow.ts');
const migration = read('src/server/database/migrations/20260824140000-download-funnel.sql');

/* A pool stub. The state machine takes its pool as a parameter and its release
 * lookup by injection, so the whole decision is testable with no database and no
 * network — which is why these cases can be exhaustive instead of representative. */
function stubPool({ onboarded = true, plan = 'free', status = 'active', throwOnboarding = false } = {}) {
  return {
    async query(sql) {
      if (/user_onboarding/.test(sql)) {
        if (throwOnboarding) throw new Error('db down');
        return { rows: onboarded ? [{ completed_at: new Date(), skipped_at: null }] : [] };
      }
      if (/xeno_account_plans/.test(sql)) {
        return { rows: [{ plan, status, current_period_end: null }] };
      }
      return { rows: [] };
    },
  };
}

const INTENT = { id: 'i1', token: 't1', slug: 'hub', os: 'windows', version: '', channel: 'stable' };
const HAS_ASSET = { assetFor: async () => ({ version: '0.11.5', file: 'v0.11.5/Setup.exe', channel: 'stable' }) };
const NO_ASSET = { assetFor: async () => null };
const USER = { id: 'u1' };

/* ── 1 · The order, which is the whole design ────────────────────────────── */

test('an anonymous visitor is asked to sign in, and nothing else is evaluated', async () => {
  const v = await resolve(stubPool({ onboarded: false, plan: 'free' }), INTENT, null, { releases: NO_ASSET });
  assert.equal(v.state, STATES.SIGNIN);
});

test('identity comes before profile', async () => {
  const v = await resolve(stubPool({ onboarded: false }), INTENT, USER, { releases: HAS_ASSET });
  assert.equal(v.state, STATES.ONBOARDING);
});

test('profile comes before payment', async () => {
  /* Asking someone to pay before we know what they came for wastes the one
   * moment they are most willing to tell us — and a refund is expensive where a
   * survey is free. */
  const v = await resolve(stubPool({ onboarded: false, plan: 'free' }), INTENT, USER, { releases: HAS_ASSET });
  assert.equal(v.state, STATES.ONBOARDING, 'payment is being demanded before onboarding');
});

test('payment comes before the artifact check', async () => {
  /* 🔴 The security-shaped one. If the artifact check ran first, a free account
   * could enumerate which platforms and builds exist by reading the difference
   * between "no plan" and "no build". */
  const v = await resolve(stubPool({ plan: 'free' }), INTENT, USER, { releases: NO_ASSET });
  assert.equal(v.state, STATES.PLAN, 'an unentitled caller can tell which builds exist');
  assert.equal(v.version, undefined);
  assert.equal(v.filename, undefined);
});

test('an entitled caller with no build is told honestly, and before paying again', async () => {
  const v = await resolve(stubPool({ plan: 'pro' }), INTENT, USER, { releases: NO_ASSET });
  assert.equal(v.state, STATES.UNAVAILABLE);
});

test('everything present resolves READY, with the resolved version', async () => {
  const v = await resolve(stubPool({ plan: 'pro' }), INTENT, USER, { releases: HAS_ASSET });
  assert.equal(v.state, STATES.READY);
  assert.equal(v.version, '0.11.5');
});

test('every paid plan can download; free cannot', async () => {
  for (const p of ['pro', 'team', 'studio', 'internal']) {
    const v = await resolve(stubPool({ plan: p }), INTENT, USER, { releases: HAS_ASSET });
    assert.equal(v.state, STATES.READY, `${p} cannot download`);
  }
  const free = await resolve(stubPool({ plan: 'free' }), INTENT, USER, { releases: HAS_ASSET });
  assert.equal(free.state, STATES.PLAN);
});

/* ── 2 · Which way each check fails ──────────────────────────────────────── */

test('the ENTITLEMENT check fails closed', () => {
  /* A database fault must refuse, never hand over bytes. */
  assert.ok(funnelSvc.includes("let plan = { plan: 'free', status: 'none' };"),
    'the plan lookup no longer defaults to free before trying — a throw would now leave plan undefined');
});

test('the ONBOARDING check fails OPEN, and only that one', async () => {
  /* Deliberate asymmetry. Onboarding guards a SURVEY: a hiccup that sends a
   * paying customer back through a questionnaire instead of to their download is
   * a worse outcome than an unanswered form, and there is nothing to protect. */
  const v = await resolve(stubPool({ throwOnboarding: true, plan: 'pro' }), INTENT, USER, { releases: HAS_ASSET });
  assert.equal(v.state, STATES.READY, 'a database hiccup now blocks a paying customer on a survey');
});

/* ── 3 · The intent carries no authority ─────────────────────────────────── */

test('the intent table records no permission', () => {
  /* The moment this row records entitlement, a pre-auth object minted before we
   * know who anyone is becomes a credential that travels in URLs. */
  for (const forbidden of ['entitled', 'can_download', 'grant', 'plan_active']) {
    assert.ok(!new RegExp(`^\\s+${forbidden}\\s`, 'm').test(migration),
      `download_intents has a '${forbidden}' column — an intent must name a wish, never a permission`);
  }
});

test('resolve() trusts nothing stored on the intent row', () => {
  /* Everything is re-derived per call. A row that could assert its own state
   * would let a stale or tampered intent answer for the live database. */
  const body = funnelSvc.slice(funnelSvc.indexOf('export async function resolve('));
  for (const cheat of ['intent.plan', 'intent.entitled', 'intent.user.plan', 'intent.status ===']) {
    assert.ok(!body.includes(cheat), `resolve() reads ${cheat} from the intent instead of the database`);
  }
  /* The PROPERTY, not the function name. This pinned `getPlan` specifically and
   * went red when the resolver correctly became getEffectivePlan — a mechanism
   * check failing against strictly better code. What matters is that the plan is
   * fetched from the database per call, not read off the intent row. */
  assert.ok(/await get(Effective)?Plan\(pool, user\.id\)/.test(body),
    'resolve() no longer derives the plan live from the database');
});

test('an intent token is unguessable and is not a database id', () => {
  const a = mintIntentToken();
  const b = mintIntentToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32, `intent token is only ${a.length} chars — brute-forceable`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), 'intent token is not URL-safe');
  assert.ok(!/^[0-9a-f-]{36}$/.test(a), 'the token is a UUID — do not hand out primary keys');
});

test("another account's intent is INVISIBLE, not forbidden", () => {
  /* A 403 confirms the token is real, which turns the endpoint into an oracle
   * for guessing valid tokens. A 404 tells an attacker nothing. */
  const g = funnelRoutes.indexOf("if (intent.user_id && req.user?.id && intent.user_id !== req.user.id)");
  assert.ok(g > -1, 'the cross-account guard is gone');
  const branch = funnelRoutes.slice(g, g + 260);
  assert.ok(branch.includes('404'), 'a mismatched intent answers something other than 404 — that is a token oracle');
  assert.ok(!branch.includes('403'), 'a mismatched intent answers 403, confirming the token exists');
});

/* ── 4 · Nothing about the funnel can break the product ──────────────────── */

test('recording a step can never throw into the caller', async () => {
  /* A funnel that fails the download when its own logging fails has inverted the
   * priority: the person is here for the software, not to be measured.
   *
   * ⚠️ Asserted by BEHAVIOUR, not by the presence of a try/catch. The structural
   * version stayed green with the catch body replaced by `throw e` — the block
   * was still there, it just re-raised. Run it against a pool that throws. */
  const exploding = { async query() { throw new Error('db down'); } };
  await record(exploding, 'i1', 'created', {});
  await recordOnce(exploding, 'i1', 'created', {});
  /* Reaching here at all is the assertion: an unswallowed throw fails the test. */
  assert.ok(true);
});

test('the client falls back to a bare grant when the funnel is unreachable', () => {
  assert.ok(flowLib.includes('if (!env) {'), 'the client no longer handles an unreachable funnel');
  /* The literal call, not merely the name somewhere nearby: beginDownload's
   * READY branch also calls startTransfer, and a 700-char window reached it, so
   * gutting the fallback stayed green. */
  assert.ok(flowLib.includes('const ok = await startTransfer(slug, os, undefined, opts.version);'),
    'a signed-in, entitled customer cannot download while analytics is down — measurement has become a dependency');
});

/* ── 5 · The redirect chain, which is where this silently breaks ─────────── */

test('sign-in carries BOTH returnUrl and next, for different reasons', () => {
  /* returnUrl is what an EXISTING account follows straight after sign-in. `next`
   * is what survives onboarding for a NEW one — resolveOAuthLandingPath() sends
   * a new account with a deep-link returnUrl directly to that link, skipping
   * onboarding, so returnUrl alone silently drops the profile step. */
  const p = nextPathFor(STATES.SIGNIN, 'tok');
  assert.ok(p.includes('returnUrl='), 'sign-in does not carry returnUrl — an existing user never comes back');
  assert.ok(p.includes('next='), 'sign-in does not carry next — a NEW user would skip onboarding entirely');
});

test('the pricing page bounces to returnUrl, not the ignored `return`', () => {
  /* AuthContent.tsx reads `returnUrl`. The old `return` was silently dropped, so
   * every signed-out visitor who clicked a plan CTA authenticated and then never
   * came back to pricing — a lost sale on the page that takes money. */
  assert.ok(!/\/auth\?return=/.test(pricingPage),
    'Pricing still bounces to /auth?return=, which AuthContent ignores');
  assert.ok(pricingPage.includes('/auth?returnUrl='), 'Pricing lost its sign-in return entirely');
});

test('every non-ready state has somewhere to go', () => {
  for (const s of [STATES.SIGNIN, STATES.ONBOARDING, STATES.PLAN, STATES.UNAVAILABLE]) {
    const p = nextPathFor(s, 'tok');
    assert.ok(p && p.startsWith('/'), `${s} has no destination — that is a dead end`);
    assert.ok(p.includes('tok'), `${s} drops the intent token, so the journey cannot resume`);
  }
});

/* ── 6 · Payment ─────────────────────────────────────────────────────────── */

test('the checkout return URL is built server-side, never accepted from a client', () => {
  /* 🔴 A client-supplied success_url is an open redirect with a payment attached
   * — the most credible phishing hop a site can offer, because the victim has
   * just been on a real Stripe page. */
  assert.ok(billing.includes('function checkoutReturn(base, itemId, downloadIntent)'),
    'the checkout return destination is no longer built server-side');
  assert.ok(/\/^\[A-Za-z0-9_-\]\{16,64\}\$\/|\[A-Za-z0-9_-\]\{16,64\}/.test(billing),
    'the intent is no longer format-validated before being interpolated into success_url');
  assert.ok(!billing.includes('success_url: req.body'), 'success_url is taken from the request body');
});

test('the intent rides on the Stripe session metadata', () => {
  /* The webhook is a different process with no browser, no session and no
   * referrer. The metadata is the ONLY channel by which "this subscription was
   * bought to get Pixel" survives the round trip. */
  /* In the metadata OBJECT specifically. A file-level check stayed green with
   * the metadata spread deleted, because attributeDownloadIntent still READS the
   * field — the reader is not the writer. */
  assert.ok(billing.includes('xenoDownloadIntent: String(downloadIntent)'),
    'the intent no longer rides on the checkout session metadata — the webhook has nothing to attribute');
  assert.ok(billing.includes('session?.metadata?.xenoDownloadIntent'),
    'the webhook no longer reads the intent off the session');
  assert.ok(billing.includes('async function attributeDownloadIntent('),
    'nothing attributes a completed checkout back to the download that caused it');
});

test('attribution happens AFTER the plan is granted', () => {
  /* The resume page is polling. Attributing first would let it observe the
   * attribution while still being refused — a visible flicker of "we took your
   * money and you still cannot download". */
  const set = billing.indexOf("await setPlan(pool, uid, { plan, status: 'active', subId: session.subscription || null });");
  const attr = billing.indexOf('await attributeDownloadIntent(pool, session, plan);');
  assert.ok(set > -1 && attr > -1, 'the subscription branch changed shape — re-verify the ordering');
  assert.ok(set < attr, 'the intent is attributed before the plan is granted');
});

test('attribution can never fail a payment', () => {
  const fn = billing.slice(billing.indexOf('async function attributeDownloadIntent('));
  assert.ok(fn.slice(0, 1400).includes('catch'), 'a funnel write can now break a webhook — payments would retry forever');
});

/* ── 7 · The wait that nobody thinks about ───────────────────────────────── */

test('returning from checkout WAITS for the webhook instead of bouncing to pricing', () => {
  /* 🔴 Stripe redirects the instant payment is authorised; the plan is granted by
   * a webhook arriving up to tens of seconds later. Asking once and seeing
   * `plan` sends the person who just paid back to the pricing page — the single
   * worst screen in this flow, and the DEFAULT outcome if nobody thinks about it. */
  assert.ok(resumePage.includes("checkout === 'success' && first.state !== 'ready'"),
    'the resume page no longer distinguishes a post-checkout arrival — a paying customer gets bounced to pricing');
  assert.ok(resumePage.includes("setPhase('waiting')"), 'there is no waiting state');
  assert.ok(resumePage.includes('POLL_MS'), 'the resume page no longer polls for the entitlement');
});

test('the wait gives up into a truthful message, not an error', () => {
  /* The payment may still be settling. Telling someone their purchase failed
   * when it has not is worse than telling them to wait. */
  const giveUp = resumePage.slice(resumePage.indexOf('if (i >= POLL_MS.length)'));
  assert.ok(giveUp.slice(0, 600).includes("setPhase('settled')"),
    'a slow webhook now surfaces as an error — that tells a paying customer their payment failed');
});

test('the transfer starts once, not twice', () => {
  /* React 18 StrictMode double-invokes effects in development, and two grants for
   * one click is a confusing audit row in a security table. */
  /* The assignment, not the identifier: the guard `!started.current` and the
   * ref declaration both contain the name, so deleting the write that actually
   * latches it stayed green. */
  assert.ok(resumePage.includes('started.current = true;'),
    'the once-guard is never latched — the resume page can mint two grants for one arrival');
  assert.ok(resumePage.includes('started.current) return'),
    'the once-guard is never read');
});

/* ── 8 · Wiring ──────────────────────────────────────────────────────────── */

test('the funnel is mounted user-AWARE, before the authenticated grant router', () => {
  /* Express runs mounts in order. Reversing these puts authMiddleware in front of
   * the anonymous endpoints and silently 401s every first-time visitor — which
   * is exactly the population the funnel exists to measure. */
  const lines = index.split('\n');
  /* MOUNTS only. Matching the router NAME finds the import lines first, which
   * sit in the opposite order and made this gate fail against correct code —
   * a pattern that happens to fit is not the rule. */
  const mounts = index.split(String.fromCharCode(10)).filter((l) => l.includes('app.use(') && l.includes('/api/downloads'));
  const funnelAt = mounts.findIndex((l) => l.includes('downloadFunnelRouter'));
  const grantAt = mounts.findIndex((l) => l.includes('downloadGrantRouter'));
  assert.ok(funnelAt > -1, 'the funnel router is not mounted');
  assert.ok(grantAt > -1, 'the grant router mount moved');
  assert.ok(funnelAt < grantAt, 'the funnel is mounted after the authenticated router — anonymous visitors get 401');
  assert.ok(mounts[funnelAt].includes('optionalAuthMiddleware'),
    'the funnel demands auth — an intent exists precisely because there is no account yet');
});

test('the grant mint writes an audit row', () => {
  /* A grant is an exercise of authority. Without this, "what did this account
   * actually take, and when?" has no answer at all. */
  const route = read('src/server/routes/productDownloadRoutes.js');
  assert.ok(route.includes('INSERT INTO download_grants'), 'grants are no longer audited');
  const mint = route.indexOf('const grant = mintDownloadGrant({ userId, slug, os, version });');
  const audit = route.indexOf('INSERT INTO download_grants');
  const gate = route.indexOf('if (!check.allowed) return res.status(403)');
  assert.ok(gate < audit, 'the audit records attempts rather than grants');
  assert.ok(mint > -1, 'the mint moved — re-verify the audit still follows the entitlement check');
});

test('the audit cannot refuse a legitimate download', () => {
  /* It is a log, not a second gate. */
  const route = read('src/server/routes/productDownloadRoutes.js');
  const a = route.indexOf('INSERT INTO download_grants');
  const before = route.slice(Math.max(0, a - 400), a);
  assert.ok(before.includes('try {'), 'a failing audit write now blocks an authorised download');
});

test('os aliases normalise consistently', () => {
  assert.equal(normaliseOs('win'), 'windows');
  assert.equal(normaliseOs('WINDOWS'), 'windows');
  assert.equal(normaliseOs('osx'), 'mac');
  assert.equal(normaliseOs('appimage'), 'linux');
  assert.equal(normaliseOs('solaris'), null);
});

test('the funnel vocabulary covers every boundary', () => {
  /* Each of these answers a question someone will actually ask. */
  for (const s of ['CREATED', 'SIGNIN_COMPLETED', 'SIGNUP_COMPLETED', 'ONBOARDING_COMPLETED',
    'PLAN_REQUIRED', 'CHECKOUT_COMPLETED', 'GRANT_MINTED']) {
    assert.ok(STEPS[s], `the funnel no longer records ${s}`);
  }
});

/* ── 9 · Expiry, which was declared and then not enforced ────────────────── */

test('expires_at is ENFORCED on read, not only by a sweeper', () => {
  /* ⚠️ This column existed in the schema with nothing reading it — a policy
   * nobody enforced. A sweeper alone is not enough either: running every 30
   * minutes means a link keeps working up to half an hour past its own
   * deadline, so the deadline is not real. */
  const fn = funnelSvc.slice(funnelSvc.indexOf('export async function findIntent('));
  const body = fn.slice(0, fn.indexOf('}') + 1);
  assert.ok(body.includes('expires_at > NOW()'),
    'findIntent returns expired intents — expires_at describes a policy nothing enforces');
});

test('an expired intent is INDISTINGUISHABLE from an unknown one', () => {
  /* Same reason a stranger's intent 404s: anything that separates "expired"
   * from "never existed" is an oracle for probing valid tokens. */
  const g = funnelRoutes.indexOf("if (!intent) {");
  assert.ok(g > -1, 'the not-found branch is gone');
  assert.ok(funnelRoutes.slice(g, g + 220).includes('404'), 'a missing or expired intent no longer answers 404');
});

test('the sweeper MARKS before it deletes', async () => {
  /* "Tried and never came back" is a real funnel outcome. Deleting expired
   * intents immediately would silently improve every conversion rate by
   * erasing exactly the failures the funnel exists to show. */
  const sw = funnelSvc.slice(funnelSvc.indexOf('export async function sweepExpiredIntents('));
  const mark = sw.indexOf("status = 'expired'");
  const del = sw.indexOf('DELETE FROM download_intents');
  assert.ok(mark > -1, 'the sweeper no longer marks expired intents');
  assert.ok(del > -1, 'the sweeper no longer prunes, so the table grows without bound');
  assert.ok(mark < del, 'the sweeper deletes before marking — drop-offs vanish from the funnel');
  assert.ok(/INTERVAL '\d+ days'/.test(sw.slice(0, 1500)),
    'pruning is no longer bounded by an age window');
});

test('the sweeper is actually SCHEDULED', () => {
  /* The whole defect this replaces was a capability that existed and was
   * called from nowhere. A sweeper nobody runs is the same bug again. */
  assert.ok(index.includes('sweepExpiredIntents'), 'the intent sweeper is imported nowhere');
  /* On a LIVE line. Commenting the call out leaves the substring intact, so a
   * file-level check stayed green with the sweeper disabled — the same shape
   * that has fooled a gate five times in this suite now. */
  const live = index.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  assert.ok(live.some((l) => l.includes('setInterval(sweepIntents')),
    'the intent sweeper is never scheduled — expires_at is a policy nothing applies');
  assert.ok(live.some((l) => l.includes('sweepIntents();')),
    'the sweeper never runs at boot, so a restart leaves a backlog unswept');
});

test('the sweeper cannot throw into startup', async () => {
  const { sweepExpiredIntents } = await import('../src/server/services/downloadFunnel.js');
  const exploding = { async query() { throw new Error('db down'); } };
  const r = await sweepExpiredIntents(exploding);
  assert.deepEqual(r, { marked: 0, deleted: 0 }, 'a failing sweep can now take down boot');
});

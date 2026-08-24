/**
 * WHAT YOU ARE ENTITLED TO IS NOT WHAT YOU PAY FOR.
 *
 * Per-seat Team is a WORKSPACE subscription — `setWorkspacePlan()` writes
 * `workspaces.metadata.billing`. Entitlement was resolved purely from
 * `xeno_account_plans` keyed by user, and nothing mapped one to the other.
 *
 * 🔴 So buying Team granted the buyer nothing personally. Before the download
 * gate that meant a Team customer quietly missed some platform features; after
 * it, it means they pay and are then refused the software. It would have fired on
 * the first Team sale, and the customer's own evidence — a Stripe receipt — would
 * have said they were entitled.
 *
 * These gates hold the fix and, just as importantly, hold the SEPARATION: the
 * two questions must not collapse into each other in either direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'effective-plan-test';

const { getEffectivePlan, getEffectiveEntitlements, workspacePlansFor } =
  await import('../src/server/services/effectivePlan.js');

const read = (f) => readFileSync(f, 'utf8');
const svc = read('src/server/services/effectivePlan.js');
const billing = read('src/server/services/billingService.js');
const gate = read('src/server/utils/entitlementGate.js');
const funnel = read('src/server/services/downloadFunnel.js');
const wsRoutes = read('src/server/routes/workspaceRoutes.js');

/**
 * A pool stub. `personal` is the xeno_account_plans row; `workspaces` are the
 * rows the membership join would return.
 */
function stubPool({ personal = null, workspaces = [], throwWorkspaces = false } = {}) {
  return {
    async query(sql) {
      if (/relationship_tuples/.test(sql)) {
        if (throwWorkspaces) throw new Error('db down');
        return { rows: workspaces };
      }
      if (/xeno_account_plans/.test(sql)) {
        return { rows: personal ? [personal] : [] };
      }
      return { rows: [] };
    },
  };
}

const ws = (plan, status = 'active', id = 'w1') => ({ id, plan, status });

/* ── 1 · The defect ──────────────────────────────────────────────────────── */

test('a Team WORKSPACE member is entitled, with no personal plan at all', async () => {
  /* The exact case that was broken: pay for Team, own nothing personally, be
   * refused your own software. */
  const p = await getEffectivePlan(stubPool({ personal: null, workspaces: [ws('team')] }), 'u1');
  assert.equal(p.plan, 'team');
  assert.equal(p.source, 'workspace');

  const e = await getEffectiveEntitlements(stubPool({ workspaces: [ws('team')] }), 'u1');
  assert.equal(e.entitlements.canDownload, true, 'a Team member still cannot download the software they paid for');
});

test('the answer explains itself', async () => {
  /* "You have this because of the Acme workspace" is the difference between a
   * support ticket and a self-serve answer. */
  const p = await getEffectivePlan(stubPool({ workspaces: [ws('team', 'active', 'acme')] }), 'u1');
  assert.equal(p.via, 'acme', 'the effective plan does not say WHICH workspace licensed it');
});

/* ── 2 · Which plan wins ─────────────────────────────────────────────────── */

test('the STRONGEST plan wins, from either source', async () => {
  const a = await getEffectivePlan(stubPool({ personal: { plan: 'pro', status: 'active' }, workspaces: [ws('team')] }), 'u1');
  assert.equal(a.plan, 'team', 'a personal Pro shadows a stronger Team workspace');

  const b = await getEffectivePlan(stubPool({ personal: { plan: 'studio', status: 'active' }, workspaces: [ws('team')] }), 'u1');
  assert.equal(b.plan, 'studio', 'a weaker workspace plan shadows a stronger personal one');
  assert.equal(b.source, 'personal');
});

test('staff outrank a workspace', async () => {
  /* An internal account that also sits in a customer workspace must not be
   * reported as a Team subscriber. */
  const p = await getEffectivePlan(stubPool({ personal: { plan: 'internal', status: 'active' }, workspaces: [ws('team')] }), 'u1');
  assert.equal(p.plan, 'internal');
});

test('an inactive workspace subscription grants nothing', async () => {
  for (const status of ['canceled', 'incomplete', 'unpaid', 'paused']) {
    const p = await getEffectivePlan(stubPool({ workspaces: [ws('team', status)] }), 'u1');
    assert.equal(p.plan, 'free', `a ${status} workspace subscription still grants entitlement`);
  }
});

test('a FREE workspace is not a licence source at all', async () => {
  /* Every workspace has a billing blob; most say 'free'. Including them would
   * make "is this person licensed by a workspace?" true for essentially
   * everyone, and it survives today only because rank('free') never wins — a
   * coincidence, not a rule. Exclude them at the source. */
  const rows = await workspacePlansFor(stubPool({ workspaces: [ws('free'), ws('team', 'active', 'w2')] }), 'u1');
  assert.deepEqual(rows.map((r) => r.plan), ['team'],
    'a free workspace is being treated as a licence source');
});

test('past_due still grants — dunning must not evict mid-retry', async () => {
  /* Stripe retries a failed card for days. Locking a whole team out of their
   * software on the first failed charge is a support incident, not enforcement. */
  const p = await getEffectivePlan(stubPool({ workspaces: [ws('team', 'past_due')] }), 'u1');
  assert.equal(p.plan, 'team');
});

/* ── 3 · Failure direction ───────────────────────────────────────────────── */

test('the workspace lookup fails CLOSED', async () => {
  /* A database fault must never invent an entitlement. It degrades a member to
   * their own plan; it does not grant anyone something they did not buy. */
  const p = await getEffectivePlan(
    stubPool({ personal: { plan: 'pro', status: 'active' }, workspaces: [ws('team')], throwWorkspaces: true }), 'u1');
  assert.equal(p.plan, 'pro', 'a failed workspace lookup granted something');
  assert.equal(p.source, 'personal');

  assert.deepEqual(await workspacePlansFor(stubPool({ throwWorkspaces: true }), 'u1'), []);
});

/* ── 4 · The separation, which must hold in BOTH directions ──────────────── */

test('the GATE path resolves effectively', () => {
  /* ⚠️ The CALL, not the file. `includes('getEffectiveEntitlements')` is
   * satisfied by the import line, so reverting the call site stayed green — on
   * the gate guarding the original defect, which is the worst one to have blind.
   * Seventh instance of this shape; assert the invocation. */
  assert.ok(gate.includes('await getEffectiveEntitlements(db, userId)'),
    'entitlementGate resolves from the personal plan — every Team member is refused');
  assert.ok(!/await getEntitlements\(db, userId\)/.test(gate),
    'entitlementGate still calls the personal-only resolver');
  assert.ok(funnel.includes('await getEffectivePlan(pool, user.id)'),
    'the download funnel resolves from the personal plan — Team members cannot download');
});

test('BILLING and DUNNING stay personal', () => {
  /* 🔴 The other direction, and it is not symmetric. If the billing page read the
   * effective plan it would tell an employee they are subscribed to Team and
   * offer to cancel a subscription that is not theirs. Worse, dunning resolves
   * `invoice.payment_failed` against `getPlan` to mark YOUR subscription
   * past_due — resolving that effectively would mark the wrong subscription. */
  for (const f of ['src/server/utils/accountViews.js', 'src/server/routes/accountRoutes.js', 'src/server/routes/dashboardRoutes.js']) {
    assert.ok(!read(f).includes('getEffectivePlan'),
      `${f} shows the effective plan — it would claim a user subscribed to their employer's plan`);
  }
  const dunning = billing.slice(billing.indexOf("case 'invoice.payment_failed'"));
  assert.ok(!dunning.slice(0, 900).includes('getEffectivePlan'),
    'dunning resolves effectively — a failed card would mark the wrong subscription past_due');
});

/* ── 5 · Seats gate JOINING, not USING ───────────────────────────────────── */

test('the seat cap is enforced at invite time, and NOT again at entitlement time', () => {
  /* Derived from the code, not chosen: workspaceRoutes refuses an invite with 403
   * once used >= limit, so membership is already seat-bounded at the only moment
   * it can be bounded fairly.
   *
   * Re-checking here would revoke an ARBITRARY member's access — there is no
   * ordering over members, so WHICH person loses access could change between two
   * requests. A licence that flickers is worse than one occasionally
   * over-granted, and the remedy for an over-seated workspace is a billing
   * conversation, not locking someone out mid-task. */
  assert.ok(/seatInfo\.used >= seatInfo\.limit/.test(wsRoutes),
    'the invite path no longer enforces the seat cap — membership is now unbounded');
  assert.ok(!/seat_limit|seatInfo/.test(svc),
    'effectivePlan re-checks the seat cap — an arbitrary member would lose access when someone else joins');
});

/* ── 6 · The Team purchase completes the funnel ──────────────────────────── */

test('the per-seat Team checkout carries the download intent', () => {
  /* Without this a Team buyer who came from a Download button lands on the
   * billing page with no download and no explanation. */
  const fn = billing.slice(billing.indexOf('export async function createWorkspaceSeatCheckout('));
  /* The PARAMETER, not the word somewhere in the body: the signature is what
   * decides whether an intent can reach this function at all. */
  assert.ok(/createWorkspaceSeatCheckout\(pool, user, \{[^}]*downloadIntent/.test(billing),
    'the Team checkout cannot accept a download intent');
  assert.ok(fn.slice(0, 1600).includes("checkoutReturn(base, 'team_seat', downloadIntent)"),
    'the Team checkout does not build its return from the intent');
  assert.ok(fn.slice(0, 1600).includes('seatReturn.successUrl'),
    'the Team checkout still hardcodes its return URL — a download-driven purchase lands nowhere');
  assert.ok(wsRoutes.includes('downloadIntent'), 'the subscribe route never forwards an intent');
});

test('the WORKSPACE webhook branch attributes the purchase', () => {
  /* It did not, so a Team purchase driven by a download was recorded as caused
   * by nothing. */
  const branch = billing.slice(billing.indexOf('const wsId = session.metadata?.xenoWorkspaceId;'));
  const set = branch.indexOf('await setWorkspacePlan(');
  const attr = branch.indexOf("attributeDownloadIntent(pool, session, 'team')");
  assert.ok(attr > -1, 'a Team purchase is attributed to nothing');
  assert.ok(set > -1 && set < attr, 'the Team purchase is attributed before the plan lands');
});

/* ── 7 · Membership means the same thing here as everywhere else ─────────── */

test('membership matches the ReBAC definition of member', () => {
  /* authzReBAC.check treats `member` as "holds ANY relation on the object". The
   * join here must mean the same, or a person can open a workspace they are not
   * licensed by, or be licensed by one they cannot open. Either direction is a
   * bug; the two must not drift. */
  assert.ok(/object_type = 'workspace'/.test(svc), 'the membership join no longer targets workspaces');
  assert.ok(/subject_type = 'user'/.test(svc), 'the membership join no longer targets users');
  assert.ok(!/AND t\.relation\s*=/.test(svc),
    "the join filters on a specific relation — ReBAC 'member' is ANY relation, so this now disagrees with authzReBAC");
});

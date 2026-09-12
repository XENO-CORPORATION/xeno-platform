/**
 * The FREE/PAID boundary — gates for where the paywall actually falls.
 *
 * ⚠️ RENAMED from watch-not-use.test.mjs, 2026-08-20, because the policy it
 * was named for is retired. "Look at everything, run nothing" was tried and
 * reversed by `XENO PRICING - STANDARD & LEDGER.md` for three reasons: it
 * contradicted the public "BYOK everywhere" commitment, it withheld in-house
 * inference that costs us near nothing to give, and it was UNENFORCEABLE in
 * the direction it claimed — the apps are downloadable installers and local
 * editing never consults this table.
 *
 * The boundary now is LAYER, not permission: free runs the local tool with a
 * real quota; paid connects it to our servers. That is a line a local binary
 * genuinely cannot cross, which is why it can be gated honestly.
 *
 * ⚠️ AMENDED 2026-08-24 — a second, DIFFERENT gate sits above that one. The
 * account owner overrode the Layer-1 rule: obtaining an installer now needs an
 * active paid plan (`canDownload`). The paragraph above is still right about
 * what it describes — we cannot police a binary already on a laptop — but
 * "unenforceable" was only ever true of RUNNING one. HANDING IT OVER is
 * enforceable, because every installer comes from our CDN.
 *
 * So the two coexist: canUse asks whether we serve this account, canDownload
 * asks whether we give it the bytes. Do not collapse them back into one.
 *
 * ── WHY THESE ARE WORTH HAVING ─────────────────────────────────────────────
 *
 * This ecosystem has shipped the same defect four times: xeno-workflow's 76
 * node types, xeno-tools' never-called `install`, and twice in
 * xeno-agent-interface. Every one was fully unit-tested and reachable from
 * nothing. The shape is always the same — the PIECE is correct, the WIRING is
 * absent, and the tests only ever asked about the piece.
 *
 * So these deliberately test two different things:
 *   - that the entitlement table says what we think it says (cheap, obvious)
 *   - that the refusal is actually WIRED to routes (the one that catches the
 *     failure mode above)
 *
 * Every assertion here has been mutation-checked: each one was watched to FAIL
 * against a deliberately broken version before being trusted. A gate that
 * cannot fail is not evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { entitlementsFor } from '../src/server/services/billingService.js';
import { cheapestPlanWith, grants, upgradeRequiredBody } from '../src/server/middleware/requireEntitlement.js';

const ROUTES = 'src/server/routes';

/* ── 1 · The table says what we think ───────────────────────────────────── */

test('free CAN use — with a real, finite quota', () => {
  /* The reversal, pinned in both directions so neither half drifts back.
   * `canUse: false` was unenforceable; a null (unmetered) quota would give
   * away the paid tier. It must be a positive, finite number. */
  const free = entitlementsFor('free');
  assert.equal(free.canUse, true, 'free cannot run anything — the retired watch/use policy is back');
  assert.ok(Number.isFinite(free.inHouseDailyLimit) && free.inHouseDailyLimit > 0,
    `free must have a real daily allowance, got ${free.inHouseDailyLimit}`);
});

test('free gets NO Layer-2 capability — that is where the paywall is', () => {
  /* The actual boundary. Each of these needs OUR servers, so each is a line a
   * local binary cannot fake — unlike "may you run the app at all", which it
   * can simply ignore. */
  const free = entitlementsFor('free');
  for (const cap of ['cloudSync', 'crossApp', 'agents', 'privateProjects', 'collaboration']) {
    assert.equal(free[cap], false, `free grants ${cap} — the paywall has moved`);
  }
  // A licence, not a switch: the enforceable half of the free tier.
  assert.equal(free.commercial, false, 'free grants a commercial licence');
});

test('free CANNOT download — the installer is a paid entitlement', () => {
  /* OWNER OVERRIDE, 2026-08-24. `XENO PRICING - STANDARD & LEDGER.md` puts the
   * apps in Layer 1 at EUR 0; the account owner moved the installer above the
   * paywall. This gate is the record of that decision.
   *
   * It does NOT contradict `free CAN use` above. canUse is "may this account
   * call our servers" — unenforceable against a binary already installed.
   * canDownload is "may we hand over the bytes", which we do control because
   * every installer comes from our CDN. Different questions, different answers. */
  assert.equal(entitlementsFor('free').canDownload, false,
    'free grants canDownload — the installer paywall is gone');
});

test('every sellable plan CAN download, and so can staff', () => {
  for (const plan of ['pro', 'team', 'studio', 'internal']) {
    assert.equal(entitlementsFor(plan).canDownload, true, `${plan} cannot download`);
  }
  // The legacy alias resolves to a real plan, so it must not lose the installer.
  assert.equal(entitlementsFor('ultra').canDownload, true, 'the ultra alias lost downloads');
});

test('an unknown plan cannot download — the gate fails CLOSED', () => {
  /* A typo must never mint a download. Same direction as the plan fallback:
   * unrecognised resolves to free, and free cannot download. */
  assert.equal(entitlementsFor('bogus-typo-plan').canDownload, false);
  assert.equal(entitlementsFor(undefined).canDownload, false);
  assert.equal(entitlementsFor(null).canDownload, false);
});

test('a refused download names a plan that can actually be bought', () => {
  /* The failure this repeats: `free` was on the upgrade ladder and refusals
   * said "upgrade to free". A download refusal has to name something with a
   * checkout behind it. */
  const plan = cheapestPlanWith('canDownload');
  assert.ok(plan, 'nothing sellable grants canDownload — every refusal would be a dead end');
  assert.notEqual(plan, 'free');
  assert.notEqual(plan, 'internal', 'a refusal must not point a customer at a staff plan');
  const body = upgradeRequiredBody('canDownload', entitlementsFor('free'));
  assert.equal(body.requiredPlan, plan);
});

test('the download refusal carries a context the UpgradePrompt can render', () => {
  /* An unknown context token renders nothing, so the user sees a blank refusal.
   * The union lives in components/common/UpgradePrompt.tsx. */
  const body = upgradeRequiredBody('canDownload', entitlementsFor('free'));
  const prompt = readFileSync(join('src/components/common', 'UpgradePrompt.tsx'), 'utf8');
  assert.ok(body.context, 'the download refusal carries no context token');
  assert.ok(prompt.includes(`'${body.context}'`),
    `UpgradePrompt does not accept context '${body.context}'`);
});

test('the fail-closed fallback refuses downloads during an outage', () => {
  /* resolveEntitlements returns FREE_ENT on any database error, so this row is
   * what every paying customer looks like during a fault. It must not hand out
   * installers, and it must say so explicitly rather than by omission. */
  const gate = readFileSync(join('src/server/utils', 'entitlementGate.js'), 'utf8');
  const start = gate.indexOf('const FREE_ENT');
  assert.ok(start > -1, 'FREE_ENT is gone — re-verify the fallback refuses downloads');
  const body = gate.slice(start, gate.indexOf('};', start));
  assert.match(body, /canDownload:\s*false/, 'the outage fallback does not refuse downloads');
});

test('the Free pricing card does not offer a download', () => {
  /* The copy half. The card used to read "Download free" over href /download,
   * which is now a promise the server refuses — the worst kind of claim,
   * because the user only finds out after clicking. */
  const pricing = readFileSync(join('src/config', 'pricing.ts'), 'utf8');
  const free = pricing.slice(pricing.indexOf("id: 'free'"), pricing.indexOf("id: 'pro'"));
  assert.ok(free.length > 0, 'the free tier moved — re-verify it offers no download');
  assert.doesNotMatch(free, /cta:\s*'[^']*Download/i, 'the Free card offers a download again');
  assert.doesNotMatch(free, /href:\s*'\/download'/, 'the Free card links straight at the download page');
});

test('every sellable plan can use', () => {
  for (const plan of ['pro', 'team', 'studio']) {
    assert.equal(entitlementsFor(plan).canUse, true, `${plan} must grant canUse`);
  }
});

test('internal staff accounts can use — they are not customers to gate', () => {
  assert.equal(entitlementsFor('internal').canUse, true);
});

test('an UNKNOWN plan fails closed to FREE, not to a paid tier', () => {
  /* ⚠️ The assertion had to change shape, not just value.
   *
   * It used to read `canUse === false`, which worked only because free granted
   * nothing — "fell back to free" and "was denied" were the same observation.
   * They are no longer, so asserting canUse would now pass for a fallback that
   * had wrongly landed on Pro. Fail-closed means LEAST PRIVILEGE: the free
   * row, and none of the paid capabilities. */
  for (const bogus of ['enterprise-typo', undefined, null, '', 'PRO']) {
    const ent = entitlementsFor(bogus);
    assert.equal(ent.plan, 'free', `unknown plan ${String(bogus)} did not fall back to free`);
    for (const cap of ['cloudSync', 'crossApp', 'agents', 'collaboration', 'commercial']) {
      assert.equal(ent[cap], false, `unknown plan ${String(bogus)} granted ${cap}`);
    }
  }
});

test('the legacy `ultra` alias still resolves to a usable plan', () => {
  // Prod carries real accounts on 'ultra'. Flipping canUse on without checking
  // aliases would have silently locked them out of what they paid for.
  assert.equal(entitlementsFor('ultra').canUse, true);
});

test('an upgrade prompt never names a plan that cannot be bought', () => {
  /* 🔴 A real defect this caught. UPGRADE_LADDER began with 'free', which was
   * harmless only while free granted nothing — the lookup returns the first
   * plan that GRANTS the capability, so a free tier granting nothing is never
   * returned. The moment free gained a real allowance, every canUse refusal
   * began telling the user to "upgrade to free". */
  for (const cap of ['canUse', 'cloudSync', 'crossApp', 'agents', 'collaboration', 'privateProjects', 'commercial']) {
    const plan = cheapestPlanWith(cap);
    assert.ok(plan, `${cap} is gateable but no sellable plan grants it — the refusal cannot name a fix`);
    assert.notEqual(plan, 'free', `${cap} refusals tell the user to upgrade to free`);
    assert.notEqual(plan, 'internal', `${cap} refusals name the staff plan`);
  }
});

test('paid tiers keep an UNMETERED in-house allowance', () => {
  // The pitch is "everyone else counts, a plan stops the counter". A finite
  // number here would quietly reintroduce the meter it sells against.
  for (const plan of ['pro', 'team', 'studio']) {
    assert.equal(entitlementsFor(plan).inHouseDailyLimit, null,
      `${plan} meters in-house inference — the plan no longer stops the counter`);
  }
});

/* ── 2 · The refusal is usable by the client ────────────────────────────── */

test('a refusal names a concrete plan to buy, not "upgrade required"', () => {
  assert.equal(cheapestPlanWith('canUse'), 'pro');
  const body = upgradeRequiredBody('canUse', { plan: 'free' });
  assert.equal(body.requiredPlan, 'pro');
  assert.equal(body.currentPlan, 'free');
});

test('the refusal carries a context token the existing UpgradePrompt accepts', () => {
  const body = upgradeRequiredBody('canUse', { plan: 'free' });
  const ACCEPTED = ['cloudSync', 'crossApp', 'agents', 'collaboration', 'resolution', 'credits', 'commercial', 'general'];
  assert.ok(ACCEPTED.includes(body.context), `context ${body.context} is not renderable`);
});

test('grants() is a boolean check, not a truthy one', () => {
  /* The false case moved from canUse to cloudSync: free now grants canUse, so
   * the old pair no longer exercised both branches. The point of this test is
   * the RETURN TYPE, not the capability — a caller doing `=== true` must not
   * be defeated by a truthy non-boolean. */
  assert.equal(grants(entitlementsFor('pro'), 'cloudSync'), true);
  assert.equal(grants(entitlementsFor('free'), 'cloudSync'), false);
  assert.equal(grants(undefined, 'cloudSync'), false);

  // teamSeats is a NUMBER in the table. Returning 25 here would pass every
  // `if (grants(...))` and fail every `=== true`, which is the exact bug this
  // test exists to prevent. Team quantity is workspace billing state, so the
  // fixed numeric entitlement belongs only to Studio.
  assert.equal(grants(entitlementsFor('studio'), 'teamSeats'), true);
  assert.equal(grants(entitlementsFor('team'), 'teamSeats'), false);
  assert.equal(grants(entitlementsFor('pro'), 'teamSeats'), false);
});

/* ── 3 · IT IS ACTUALLY WIRED — the gate that catches the real defect ───── */

function routeSources() {
  return readdirSync(ROUTES)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, src: readFileSync(join(ROUTES, f), 'utf8') }));
}

test('canUse is enforced on at least one real route', () => {
  // The assertion that would have caught workflow's 76 unreachable nodes.
  // Reads the SOURCE, because the question is not "does the middleware work"
  // but "did anyone mount it".
  const wired = routeSources().filter(({ src }) => /requireEntitlement\(\s*['"]canUse['"]/.test(src));
  assert.ok(
    wired.length > 0,
    'canUse is defined and enforced NOWHERE. The entitlement is advertised and free to bypass — ' +
    'mount requireEntitlement(\'canUse\') on the endpoints that spend compute.',
  );
});

test('the compute-spending routes specifically are gated', () => {
  // Named routes, not a count: a count passes forever once one route is gated,
  // which is how a second unprotected endpoint slips in later.
  const MUST_GATE = ['aiRoutes.js', 'imageRoutes.js'];
  const byFile = new Map(routeSources().map(({ file, src }) => [file, src]));

  for (const file of MUST_GATE) {
    const src = byFile.get(file);
    if (src === undefined) continue; // route file renamed — not this test's job to fail on that
    assert.match(
      src,
      /requireEntitlement\(\s*['"]canUse['"]/,
      `${file} spends compute and does not check canUse — an unpaid account can call it directly`,
    );
  }
});

/**
 * The download gate — an installer requires an active paid plan.
 *
 * Owner override, 2026-08-24, of the Layer-1 rule in the pricing standard. The
 * entitlement itself is gated in free-tier-boundary.test.mjs; this file gates
 * the DOOR.
 *
 * ── WHAT THIS IS REALLY GUARDING AGAINST ────────────────────────────────────
 *
 * Not "does the flag exist" — that is cheap and was never the failure. The
 * failure mode here is a gate with a hole beside it:
 *
 *   1. The route 302s to the CDN for anyone (what it did before this change).
 *   2. A Download button links straight at the CDN, so the gated route is
 *      simply never involved.
 *   3. The paywall runs AFTER the asset lookup, so a refusal still leaks the
 *      filename and version it refused.
 *   4. The mint endpoint is mounted without auth, making the grant free.
 *
 * Every one of those leaves the flag perfectly correct and the product open,
 * which is exactly the shape this repo keeps re-shipping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'download-gate-test-secret';
const { mintDownloadGrant, verifyDownloadGrant, GRANT_TTL_SECONDS } =
  await import('../src/server/utils/downloadGrant.js');

const read = (...p) => readFileSync(join(...p), 'utf8');
const route = read('src/server/routes', 'productDownloadRoutes.js');
const index = read('src/server', 'index.js');
const catalog = read('src/lib', 'productCatalog.ts');

const UI = [
  ['src/components/product', 'ReleaseFeed.tsx'],
  ['src/pages', 'ProductReleaseDetail.tsx'],
  ['src/pages', 'ProductDownload.tsx'],
  ['src/pages', 'ProductPage.tsx'],
  ['src/pages', 'ProductLanding.tsx'],
];

const CDN_HOST = ['updates', 'xenostudio', 'ai'].join('.');

/** The app.use(…) line for a mount, so a mount's middlewares can be asserted. */
const mountLine = (prefix) =>
  index.split(String.fromCharCode(10)).find((l) => l.includes('app.use(') && l.includes(prefix));

/* ── 1 · The grant is a permission for ONE artifact ─────────────────────── */

test('a valid grant opens exactly the artifact it names', () => {
  const g = mintDownloadGrant({ userId: 'u1', slug: 'hub', os: 'windows' });
  assert.equal(verifyDownloadGrant(g, { slug: 'hub', os: 'windows' }).ok, true);
});

test('a grant cannot be replayed against another product or OS', () => {
  /* The binding check. Verifying only the signature would turn a grant for one
   * download into a pass for the whole catalogue. */
  const g = mintDownloadGrant({ userId: 'u1', slug: 'hub', os: 'windows' });
  assert.equal(verifyDownloadGrant(g, { slug: 'pixel', os: 'windows' }).reason, 'wrong_artifact');
  assert.equal(verifyDownloadGrant(g, { slug: 'hub', os: 'linux' }).reason, 'wrong_artifact');
  assert.equal(verifyDownloadGrant(g, { slug: 'hub', os: 'windows', version: '9.9.9' }).reason, 'wrong_artifact');
});

test('a forged or garbage grant is refused, not crashed on', () => {
  /* timingSafeEqual throws on a length mismatch, which would turn a forgery
   * into a 500 — and a 500 on the paywall is an outage, not a refusal. */
  const g = mintDownloadGrant({ userId: 'u1', slug: 'hub', os: 'windows' });
  assert.equal(verifyDownloadGrant(g.split('.')[0] + '.AAAA', { slug: 'hub', os: 'windows' }).reason, 'bad_signature');
  assert.equal(verifyDownloadGrant('nonsense', { slug: 'hub', os: 'windows' }).reason, 'malformed');
  assert.equal(verifyDownloadGrant(undefined, { slug: 'hub', os: 'windows' }).reason, 'malformed');
  assert.equal(verifyDownloadGrant('', { slug: 'hub', os: 'windows' }).reason, 'malformed');
});

test('a grant expires, and soon', () => {
  const stale = mintDownloadGrant({ userId: 'u1', slug: 'hub', os: 'windows', ttlSeconds: -1 });
  assert.equal(verifyDownloadGrant(stale, { slug: 'hub', os: 'windows' }).reason, 'expired');
  assert.ok(GRANT_TTL_SECONDS > 0 && GRANT_TTL_SECONDS <= 900,
    'a download grant must be short-lived, got ' + GRANT_TTL_SECONDS + 's');
});

/* ── 2 · The door ───────────────────────────────────────────────────────── */

test('the route refuses BEFORE it looks the asset up', () => {
  /* Order matters: refusing after the lookup still tells an unentitled caller
   * the version and filename it was refused. */
  const gate = route.indexOf('verifyDownloadGrant(req.query.grant');
  const lookup = route.indexOf('await loadReleases(slug)');
  assert.ok(gate > -1, 'the route no longer checks a grant');
  assert.ok(lookup > -1, 'the asset lookup moved — re-verify the paywall still precedes it');
  assert.ok(gate < lookup, 'the paywall runs after the asset lookup, leaking what it refused');
});

test('an ungranted request is never handed an installer', () => {
  /* The whole point. Everything before the grant check must be a refusal or a
   * 404 — never the redirect that hands over bytes. */
  const gate = route.indexOf('verifyDownloadGrant(req.query.grant');
  const handler = route.indexOf('router.get(');
  assert.ok(handler > -1 && gate > handler, 'the download handler moved — re-verify the paywall');
  const before = route.slice(handler, gate);
  assert.ok(!before.includes('res.redirect(302, url)'),
    'the route can 302 to an installer before checking the grant');
});

test('a browser navigation is sent somewhere it can act', () => {
  /* A bare 401 in a browser tab is a dead end. HTML gets the sign-in page with
   * a returnUrl; everything else gets JSON it can branch on. */
  assert.ok(route.includes('wantsHtml(req)'), 'the route no longer distinguishes a navigation from an API call');
  assert.ok(route.includes('/auth?returnUrl='), 'a browser navigation is not sent anywhere it can act');
  assert.ok(route.includes('download_grant_required'), 'the JSON refusal lost its code');
});

test('the deep-link route is NOT mounted behind authMiddleware', () => {
  /* Deliberate, and the reason is in auth.js: this app sets no auth cookie, so
   * a plain anchor navigation carries no credential. Mounting auth here would
   * refuse every paying customer — a gate that looks like it works because it
   * refuses everyone. The grant is what carries the permission instead. */
  const line = mountLine('/product');
  assert.ok(line, 'the /product mount moved');
  assert.ok(!line.includes('authMiddleware'),
    'the deep-link is behind authMiddleware — that refuses real customers, see auth.js');
});

/* ── 3 · Minting is the authenticated half ──────────────────────────────── */

test('the mint endpoint sits behind auth AND the database', () => {
  const line = mountLine('/api/downloads');
  assert.ok(line, 'the grant mint endpoint is not mounted');
  assert.ok(line.includes('authMiddleware'), 'grants can be minted without signing in');
  assert.ok(line.includes('databaseMiddleware'), 'the mint endpoint has no db to resolve entitlements with');
});

test('minting checks canDownload, and refuses with 403', () => {
  assert.ok(route.includes('canDownload'), 'the mint endpoint does not check canDownload');
  assert.ok(route.includes('assertEntitlement'), 'the mint endpoint does not assert an entitlement');
  assert.ok(route.includes('if (!check.allowed) return res.status(403)'),
    'a refused entitlement does not produce a 403');
});

/* ── 4 · No hole beside the door ────────────────────────────────────────── */

test('no Download control links straight at the CDN', () => {
  /* The bypass that makes the whole gate theatre. assetUrl() returns the raw
   * public CDN URL; ReleaseFeed and ProductReleaseDetail both used it for their
   * download hrefs, so the gated route was simply never involved. */
  for (const f of UI) {
    const src = read(...f);
    assert.ok(!src.includes('assetUrl'), f[1] + ' links the public CDN directly — the gate is bypassed');
    assert.ok(!src.includes(CDN_HOST), f[1] + ' hardcodes the CDN origin');
  }
});

test('every Download control mints a grant on click', () => {
  /* href alone is not enough: the plain navigation of a paying customer carries
   * no token, so without the handler they are bounced to sign-in like everyone
   * else — the gate would refuse the very people who paid. */
  for (const f of UI) {
    const src = read(...f);
    /* Assert it is USED, not merely imported. A substring check for the name
     * alone stayed green with every onClick stripped — the import satisfied it,
     * which is precisely the mechanism-not-outcome trap this repo keeps hitting. */
    assert.ok(src.includes('onClick={downloadClickHandler('),
      f[1] + ' imports the grant handler but never attaches it to a Download control');
  }
});

test('a refused download sends a free account to pricing, not in a loop', () => {
  const helper = read('src/lib', 'startDownload.ts');
  assert.ok(helper.includes('res.status === 403'), 'the client does not handle a plan refusal');
  assert.ok(helper.includes('/pricing'), 'a refused download does not offer a way to fix it');
  assert.ok(helper.includes('res.status === 401'), 'the client does not handle a signed-out download');
});

test('assetUrl carries a warning so it is not re-used for downloads', () => {
  assert.ok(catalog.includes('NOT FOR DOWNLOAD LINKS'), 'assetUrl lost its do-not-use-for-downloads warning');
});

/* ── 5 · The updater's half (Phase 3) ───────────────────────────────────── */

test('the update-grant endpoint sits behind auth AND the database', () => {
  const line = mountLine('/api/updates');
  assert.ok(line, 'the update grant endpoint is not mounted');
  assert.ok(line.includes('authMiddleware'), 'an updater could mint a grant without an account');
  assert.ok(line.includes('databaseMiddleware'), 'the update endpoint has no db to resolve entitlements with');
});

test('the update grant is refused before the release is looked up', () => {
  /* Same ordering rule as the deep link. An updater that is refused must not
   * learn from the error that a new version exists. */
  const start = route.indexOf('updateGrantRouter.get(');
  assert.ok(start > -1, 'the update grant route is gone');
  const body = route.slice(start);
  const gate = body.indexOf('assertEntitlement');
  const lookup = body.indexOf('await loadReleases(slug)');
  assert.ok(gate > -1, 'the update endpoint does not assert an entitlement');
  assert.ok(lookup > -1, 'the update endpoint stopped resolving a release');
  assert.ok(gate < lookup, 'the update paywall runs after the lookup, leaking that an update exists');
});

test('an update grant is bound to the RESOLVED version, never to "latest"', () => {
  /* A "latest"-shaped grant held across a release silently starts pointing at
   * different bytes than the updater decided to install — the grant would still
   * verify, against the wrong file. Pin it to what was actually resolved. */
  const body = route.slice(route.indexOf('updateGrantRouter.get('));
  const mint = body.indexOf('mintDownloadGrant(');
  assert.ok(mint > -1, 'the update endpoint stopped minting a grant');
  /* Bound to the CALL, not the file: the JSON response also carries
   * `version: release.version`, so a file-level check stayed green with the
   * mint reverted to the unresolved value. Second time this exact shape has
   * fooled a gate in this suite. */
  const call = body.slice(mint, body.indexOf(')', mint));
  assert.ok(call.includes('version: release.version'),
    'the update grant is minted against an unresolved version, not the one it resolved');
});

test('update and download stay SEPARABLE, on one named seam', () => {
  /* They check the same capability today because nobody has decided otherwise.
   * What must not happen is the two collapsing into one call site, because then
   * "an expired plan still gets security fixes" stops being a decision anyone
   * can make. */
  assert.ok(route.includes('const UPDATE_CAPABILITY ='),
    'the update capability is no longer a named seam — splitting it is now a refactor, not a line');
  assert.ok(route.includes('assertEntitlement(req.db, userId, UPDATE_CAPABILITY)'),
    'the update endpoint no longer goes through its own capability constant');
});

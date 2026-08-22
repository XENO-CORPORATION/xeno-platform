#!/usr/bin/env node
/**
 * Measures which products have a REAL release, and writes it down.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `productCatalog.ts` carries `status: 'coming-soon' | 'beta' | 'shipping'`,
 * and the onboarding cards were deriving "Soon" from it. That field is a
 * hand-maintained CLAIM, not a measurement, and this ecosystem has been bitten
 * by exactly that repeatedly — xeno-browser sat documented as "Scaffolded
 * v0.0.1" while shipping v0.3.0.
 *
 * The first run of this probe found three live examples: 3d, architect and
 * engine are all marked `coming-soon` while serving real v0.1.0 releases.
 *
 * A release either exists or it does not, and that is checkable. So check it.
 *
 * ── DELIVERY DECIDES WHERE THE TRUTH LIVES ─────────────────────────────────
 *
 *   desktop / cli  → R2 `apps/<slug>/version.json` is the channel. 200 with a
 *                    version means shipped.
 *   web            → runs on the site; it never publishes to R2, so a 404
 *                    there means nothing. `post` is web-delivered and 404s on
 *                    R2 while being live at post.xenostudio.ai — reading that
 *                    as "unreleased" would be the same class of error in the
 *                    opposite direction.
 *   soon           → STILL PROBED. This is the case that matters: a product
 *                    nobody updated the catalog for looks like `soon` and has
 *                    a live feed. Trusting `delivery` here would make the
 *                    probe agree with the claim it is meant to audit.
 *
 * ── NETWORK HERE, DETERMINISM IN THE GATE ──────────────────────────────────
 *
 * This script does the I/O and commits a manifest. `release-status.test.mjs`
 * then compares catalog against that manifest offline, so the gate is
 * deterministic and runs without a network. A test that hits R2 would fail on
 * a plane and get marked flaky, which is how a real signal gets ignored.
 *
 * Usage:  node scripts/probe-release-status.mjs          (writes the manifest)
 *         node scripts/probe-release-status.mjs --check  (exit 1 on drift)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const R2 = 'https://updates.xenostudio.ai/apps';
const OUT = 'src/lib/releaseStatus.json';
const TIMEOUT_MS = 10_000;

/** Parse the catalog without importing TypeScript. */
function catalogProducts() {
  const src = readFileSync('src/lib/productCatalog.ts', 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    if (!line.includes('slug:') || !line.includes('category:')) continue;
    const slug = line.match(/slug:\s*'([^']+)'/)?.[1];
    const status = line.match(/status:\s*'([^']+)'/)?.[1];
    const delivery = line.match(/delivery:\s*'([^']+)'/)?.[1];
    const hasExternal = /externalUrl:/.test(line);
    const hasLaunch = /launchPath:/.test(line);
    if (slug) out.push({ slug, status, delivery, hasExternal, hasLaunch });
  }
  return out;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { status: res.status, body: null };
    return { status: 200, body: await res.json() };
  } catch (err) {
    return { status: 0, error: err.name, body: null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * R2 serves TWO feed shapes and a product uses one or the other.
 *
 * 🔴 The first version of this probe only checked `version.json` and reported
 * `extension` as unreleased — it ships through the `releases.json` CHANNEL
 * feed instead, and is live at stable v1.1.0. That is a false accusation, and
 * a gate that cries wolf is a gate people switch off. Check both before
 * concluding anything.
 */
async function probeR2(slug) {
  const v = await getJson(`${R2}/${slug}/version.json`);
  if (v.status === 200) {
    const version = v.body?.version || null;
    // A feed that exists but carries no version is NOT a release. Treating
    // "the file is there" as shipped is how an empty pointer reads as green.
    return version
      ? { released: true, version, source: 'r2:version.json' }
      : { released: false, source: 'r2:no-version' };
  }
  if (v.status === 0) {
    // Unreachable is UNKNOWN, never false — a network blip must not silently
    // retire a shipping product from the UI.
    return { released: null, source: `error:${v.error}` };
  }

  const r = await getJson(`${R2}/${slug}/releases.json`);
  if (r.status === 200) {
    const stable = r.body?.channels?.stable;
    const version = stable?.tag || stable?.version || null;
    return version
      ? { released: true, version, source: 'r2:releases.json' }
      : { released: false, source: 'r2:releases-no-stable' };
  }
  if (r.status === 0) return { released: null, source: `error:${r.error}` };

  /* Neither feed exists. That is NOT proof of "unreleased": a product can ship
   * through npm (the CLI), GitHub releases (xeno-rt, a public Rust repo), or a
   * registry this probe cannot see. Absence of evidence in the ONE place we
   * looked is not evidence of absence, so this returns UNKNOWN and the UI
   * falls back to the catalog rather than contradicting it on a guess. */
  return { released: null, source: 'no-r2-feed' };
}

async function probe(p) {
  // Web products live on the site, so their release fact is "it has somewhere
  // to open". R2 is not their channel and a 404 there is expected.
  if (p.delivery === 'web') {
    return (p.hasExternal || p.hasLaunch)
      ? { released: true, source: 'web' }
      : { released: false, source: 'web:no-destination' };
  }
  return probeR2(p.slug);
}

const products = catalogProducts();
const results = {};
// Sequential on purpose: 37 parallel requests to one origin is a burst that
// looks like abuse and gets rate-limited, which would return 429s and read as
// "not released" — the worst possible failure for this script.
for (const p of products) {
  results[p.slug] = { ...(await probe(p)), catalogStatus: p.status, delivery: p.delivery };
  process.stdout.write(
    `${p.slug.padEnd(12)} ${String(results[p.slug].released).padEnd(5)} ` +
    `${(results[p.slug].version || '').padEnd(12)} ${results[p.slug].source}\n`,
  );
}

/** Products whose catalog status disagrees with the measurement. */
function drift() {
  const out = [];
  for (const [slug, r] of Object.entries(results)) {
    if (r.released === null) continue; // unknown proves nothing
    const claimsUnreleased = r.catalogStatus === 'coming-soon';
    /* Only the CONFIRMED direction is reported.
     *
     * "Catalog says coming-soon, a release exists" is a fact: something is
     * published and the claim is stale. The reverse — "catalog says beta, we
     * found nothing" — is only a fact if we know the channel applies, and for
     * npm/GitHub-shipped products it does not. Reporting it anyway is how a
     * gate produces false accusations, and a gate that cries wolf gets
     * switched off. Unknown is carried, not converted into an accusation. */
    if (claimsUnreleased && r.released) {
      out.push(`${slug}: catalog says coming-soon, but a real release is published (${r.version || 'live'})`);
    }
    if (!claimsUnreleased && r.released === false) {
      out.push(`${slug}: catalog says ${r.catalogStatus}, but its own feed is empty (${r.source})`);
    }
  }
  return out;
}

const d = drift();
console.log(`\n${products.length} products probed, ${d.length} disagree with the catalog.`);
for (const line of d) console.log(`  ⚠ ${line}`);

if (process.argv.includes('--check')) {
  process.exit(d.length ? 1 : 0);
}

writeFileSync(OUT, `${JSON.stringify({
  // Stamped so a stale manifest is visible rather than silently authoritative.
  checkedAt: new Date().toISOString(),
  note: 'Generated by scripts/probe-release-status.mjs — do not hand-edit.',
  products: results,
}, null, 2)}\n`);
console.log(`\nwrote ${OUT}`);

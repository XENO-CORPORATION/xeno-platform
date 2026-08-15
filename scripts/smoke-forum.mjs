#!/usr/bin/env node
/**
 * Forum live smoke — exercises the REAL endpoints against a running deployment.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * On 2026-08-16 a search improvement renamed a CTE column and updated every
 * reference INSIDE the block that was rewritten. One reference lived forty lines
 * outside it, and Postgres answered every search with
 * `column tsq.q does not exist`. Live search went 2/6 → 0/6.
 *
 * The unit gates could not have caught it: they read source for ranking weights
 * and tier structure, and a stale column name is neither. The pre-deploy proof
 * could not either — it ran the rewritten CTE as a STANDALONE query, which never
 * contained the projection that broke. **A fragment cannot fail on a reference
 * it does not contain.**
 *
 * So this hits the endpoints the way a client does, and its only job is to
 * notice that something 500s or silently returns nothing.
 *
 *   npm run smoke:forum
 *   SMOKE_FORUM_BASE_URL=http://localhost:8080 npm run smoke:forum
 *
 * Read-only by design. Every write path is auth-gated, and a smoke test that
 * creates real content to prove it can is a smoke test that pollutes the corpus
 * it is checking.
 */

const BASE = process.env.SMOKE_FORUM_BASE_URL || 'https://xenostudio.ai';

let failures = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures += 1; };
const pass = (m) => console.log(`  ok    ${m}`);

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

/** Public and MUST return data. A 200 carrying `success:false` is still broken. */
async function checkPublic(path, expectKey) {
  const { status, body } = await get(path);
  if (status !== 200) return fail(`${path} → ${status} (expected 200)`);
  if (body?.success === false) return fail(`${path} → 200 but success:false — "${body.error}"`);
  if (expectKey && body?.[expectKey] === undefined) {
    return fail(`${path} → 200 but no "${expectKey}" in the response`);
  }
  pass(`${path} → 200, ${expectKey} present`);
}

/**
 * Auth-gated endpoints must answer 401, never 500.
 *
 * The distinction matters more than it looks: 401 means the route is mounted and
 * refused you; 500 means it broke trying. Both are "not 200", and only one of
 * them is correct — which is exactly how a broken endpoint hides behind a
 * check that only asserts "not 200".
 */
async function checkGated(path) {
  const { status } = await get(path);
  if (status === 401) return pass(`${path} → 401 (mounted, auth-gated)`);
  if (status === 500) return fail(`${path} → 500 — mounted but BROKEN`);
  fail(`${path} → ${status} (expected 401)`);
}

async function main() {
  console.log(`forum smoke against ${BASE}\n`);

  console.log('public:');
  await checkPublic('/api/forum/spaces', 'spaces');
  await checkPublic('/api/forum/threads?limit=5', 'threads');
  await checkPublic('/api/forum/moderation-log', 'log');

  // 🔴 SEARCH IS CHECKED BY RESULT, NOT BY STATUS. The incident this file exists
  // for returned a clean 500, but a subtler break — a query that parses and
  // matches nothing — returns 200 with an empty array and looks healthy. So the
  // smoke asserts a known seeded thread is actually FOUND.
  console.log('\nsearch (the thing that broke):');
  const probes = [
    { q: 'blue and red are swapped', why: 'exact title wording' },
    { q: 'colors look inverted after paste', why: 'paraphrase — needs the OR tier' },
    { q: 'pasted picture has wrong colours', why: 'synonym + British spelling — needs trigram' },
  ];
  for (const p of probes) {
    const { status, body } = await get(`/api/forum/search?q=${encodeURIComponent(p.q)}`);
    if (status !== 200) { fail(`search "${p.q}" → ${status}`); continue; }
    if (body?.success === false) { fail(`search "${p.q}" → "${body.error}"`); continue; }
    const hits = body?.threads || body?.results || [];
    if (!hits.length) fail(`search "${p.q}" → 0 hits (${p.why})`);
    else pass(`search "${p.q}" → ${hits.length} (${p.why})`);
  }

  console.log('\nauth-gated (401, never 500):');
  for (const p of [
    '/api/forum/notifications',
    '/api/forum/flags',
    '/api/forum/me/activity',
    '/api/forum/digest',
    '/api/forum/predicate',
  ]) await checkGated(p);

  console.log('');
  if (failures) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All forum checks passed.');
}

main().catch((e) => { console.error(`smoke crashed: ${e.message}`); process.exit(1); });

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

  console.log('\nmcp:');
  {
    const { status, body } = await get('/api/forum/mcp');
    if (status !== 200) fail(`/api/forum/mcp manifest → ${status}`);
    else if (!Array.isArray(body?.tools) || !body.tools.length) fail('manifest lists no tools');
    else pass(`manifest → ${body.tools.length} tools`);
  }
  {
    // tools/list over the real JSON-RPC transport. The manifest is a static
    // object; this is the dispatcher actually running, which is the part that
    // can break on a deploy.
    const res = await fetch(`${BASE}/api/forum/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = await res.json().catch(() => null);
    const tools = body?.result?.tools;
    if (res.status !== 200) fail(`mcp tools/list → ${res.status}`);
    else if (!Array.isArray(tools) || !tools.length) fail('mcp tools/list returned no tools');
    else pass(`mcp tools/list → ${tools.length} tools`);

    // 🔴 A tool CALL, not just a listing. tools/list can succeed while every
    // tool is broken — it only reads a constant. This exercises the same
    // service path REST uses, through the MCP dispatcher.
    const call = await fetch(`${BASE}/api/forum/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'forum_search', arguments: { query: 'blue and red are swapped' } },
      }),
    });
    const cb = await call.json().catch(() => null);
    const text = cb?.result?.content?.[0]?.text || '';
    if (call.status !== 200) fail(`mcp forum_search → ${call.status}`);
    else if (cb?.result?.isError) fail(`mcp forum_search → ${text.slice(0, 80)}`);
    else if (!text.includes('/forum/t/')) {
      // §6.1 — a result without a citable URL turns a permanent record into
      // hearsay, and an agent has nothing to hand the user.
      fail('mcp forum_search returned results with no citable URL');
    } else pass('mcp forum_search → hits, with citable URLs');

    // 🔴 §5: the URL must RESOLVE, not merely be well-formed. "Citable" is a
    // promise that a human can follow the link an agent handed them, and a URL
    // built from a field the serializer does not publish looks perfect and
    // points nowhere — that exact class of bug was caught by hand this week
    // (`t.id` is undefined on a thread payload).
    //
    // Checked against the API rather than the HTML page on purpose: the thread
    // page is a client-rendered SPA route, so curling it returns the shell for a
    // real thread and a dead one alike — the documented false-200 trap. The API
    // resource behind the short id is what proves the link is not dead.
    const shortId = (text.match(/\/forum\/t\/([a-z0-9]+)/) || [])[1];
    if (!shortId) {
      fail('no short id could be parsed from the citable URL');
    } else {
      const { status, body: t } = await get(`/api/forum/threads/${shortId}`);
      if (status !== 200) fail(`the citable URL is DEAD — /api/forum/threads/${shortId} → ${status}`);
      else if (t?.thread?.shortId !== shortId) fail(`it resolves to a different thread (${t?.thread?.shortId})`);
      else pass(`the citable URL resolves → "${String(t.thread.title).slice(0, 40)}…"`);
    }
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

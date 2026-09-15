/**
 * A failed page read must not outlive its cause.
 *
 * ## The defect, found 2026-09-14
 *
 * The chat tool loop called `searchAndFetch` with `userMessageId: null`, so its idempotency
 * key was actor + conversation + query. Two DIFFERENT turns asking the same thing were the
 * same request as far as Web Context could tell — so a page job that failed once was handed
 * back, by replay, to every later turn with that query in that conversation. It returned the
 * stale failure in ~1 s without touching a page, until retention cleared it.
 *
 * It surfaced during verification of an unrelated fix and looked exactly like a regression:
 * the same three URLs completed 3/3 with a fresh key and failed 0/3 with the replayed one.
 *
 * ## Two halves, because either alone leaves a hole
 *
 *   1. The key is scoped to the TURN. Different turns, different requests.
 *   2. A replayed job that is ALREADY terminal-failed is never adopted, even within one turn.
 *      Idempotency exists so retries do not repeat work that succeeded or is running; a stale
 *      failure is neither, and adopting it means never trying the pages at all.
 *
 * ⚠️ Research is untouched: it passes a real per-turn `userMessageId`, and its key formula is
 * pinned byte-for-byte below so a deploy cannot silently change it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createChatWebContextService } from '../src/server/services/chatWebContext.js';

const REQUIRED_SCOPES = [
  'account:read', 'search:execute', 'jobs:write', 'jobs:read', 'jobs:control', 'artifacts:read',
];
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const BASE = {
  actorId: 'user-1',
  conversationId: '00000000-0000-4000-8000-000000000001',
  userMessageId: null,
  query: 'latest survival game released',
  count: 2,
};

/**
 * @param {object[]} batchReplies  what successive POST /v1/batch-scrape calls return
 */
function harness(batchReplies) {
  const calls = [];
  const warnings = [];
  let batchIndex = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/v1/account') return json({ tenantId: 'tenant-1', scopes: REQUIRED_SCOPES, quota: {} });
    if (url.pathname === '/v1/search') {
      return json({
        requestId: 'r', terminalReason: 'completed',
        items: [
          { url: 'https://example.com/a', title: 'A', description: 'a', rank: 1, provider: 'brave' },
          { url: 'https://example.com/b', title: 'B', description: 'b', rank: 2, provider: 'brave' },
        ],
      });
    }
    if (url.pathname === '/v1/batch-scrape') {
      const reply = batchReplies[Math.min(batchIndex, batchReplies.length - 1)];
      batchIndex += 1;
      return json(reply, 202);
    }
    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const reply = batchReplies.find((r) => r.job.jobId === jobMatch[1]);
      // A job that was still RUNNING when it was started finishes by the first poll, so a
      // replayed in-flight job can be waited on without the test polling forever.
      const state = reply.job.state === 'running' ? 'completed' : reply.job.state;
      return json({ job: { ...reply.job, state, completedPages: state === 'completed' ? 2 : 0, failedPages: 0, excludedPages: 0 } });
    }
    if (/^\/v1\/jobs\/[^/]+\/results$/.test(url.pathname)) return json({ items: [] });
    throw new Error(`unexpected request ${url.href}`);
  };
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://127.0.0.1:4310', XENO_WEB_CONTEXT_TOKEN: 'test-token',
    },
    fetchImpl,
    logger: { warn: (message, fields) => warnings.push({ message, fields }) },
  });
  return { service, calls, warnings };
}

const fresh = (jobId) => ({ job: { jobId, operation: 'batch-scrape', state: 'completed' }, created: true });
const keyOf = (calls, path) => calls.filter((c) => c.path === path).map((c) => c.body.idempotencyKey);

test('🔴 two different turns asking the same question get DIFFERENT keys', async () => {
  const first = harness([fresh('job-1')]);
  await first.service.searchAndFetch({ ...BASE, turnId: 'turn-A' });
  const second = harness([fresh('job-2')]);
  await second.service.searchAndFetch({ ...BASE, turnId: 'turn-B' });

  assert.notEqual(
    keyOf(first.calls, '/v1/batch-scrape')[0], keyOf(second.calls, '/v1/batch-scrape')[0],
    'with the key built from actor + conversation + query alone, a page job that failed in one '
    + 'turn was replayed to every later turn asking the same thing',
  );
  assert.notEqual(keyOf(first.calls, '/v1/search')[0], keyOf(second.calls, '/v1/search')[0]);
});

test('the SAME turn keeps the same key — a client retry must still be idempotent', async () => {
  const a = harness([fresh('job-1')]);
  await a.service.searchAndFetch({ ...BASE, turnId: 'turn-A' });
  const b = harness([fresh('job-1')]);
  await b.service.searchAndFetch({ ...BASE, turnId: 'turn-A' });
  assert.equal(keyOf(a.calls, '/v1/search')[0], keyOf(b.calls, '/v1/search')[0],
    'dropping idempotency entirely would double-charge the provider on every retry');
});

test('🔴 Research keys are unchanged, byte for byte', async () => {
  // Research passes a real userMessageId and no turnId. Its formula must not move.
  const input = { ...BASE, userMessageId: '00000000-0000-4000-8000-000000000002' };
  const { service, calls } = harness([fresh('job-1')]);
  await service.searchAndFetch(input);
  const expected = `chat:${crypto.createHash('sha256')
    .update(`${input.actorId}\0${input.conversationId}\0${input.userMessageId}\0${input.query}`)
    .digest('hex').slice(0, 48)}`;
  assert.equal(keyOf(calls, '/v1/search')[0], expected);
});

test('🔴 a replayed job that already FAILED is never adopted — a fresh one is started', async () => {
  const { service, calls, warnings } = harness([
    { job: { jobId: 'job-stale', operation: 'batch-scrape', state: 'failed' }, created: false },
    fresh('job-fresh'),
  ]);
  const result = await service.searchAndFetch({ ...BASE, turnId: 'turn-A' });

  const starts = keyOf(calls, '/v1/batch-scrape');
  assert.equal(starts.length, 2, 'the stale failure must trigger exactly one fresh attempt');
  assert.notEqual(starts[0], starts[1], 'with a distinct key, or the service would replay it again');
  assert.equal(result.job?.state, 'completed', 'and the result comes from the fresh job, not the stale one');
  assert.ok(calls.some((c) => c.path === '/v1/jobs/job-fresh'), 'the fresh job is the one waited on');
  assert.ok(!calls.some((c) => c.path === '/v1/jobs/job-stale'), 'the stale job is never waited on');
  assert.ok(warnings.some((w) => w.fields.reason === 'page_job_replayed_failure'), 'and the replay is logged');
});

test('a replayed job that is still RUNNING or COMPLETED is adopted — that is what idempotency is for', async () => {
  for (const state of ['completed', 'running']) {
    const reply = { job: { jobId: `job-${state}`, operation: 'batch-scrape', state }, created: false };
    const { service, calls } = harness([reply]);
    const result = await service.searchAndFetch({ ...BASE, turnId: 'turn-A' });
    assert.equal(keyOf(calls, '/v1/batch-scrape').length, 1, `a replayed ${state} job must not be restarted`);
    assert.ok(calls.some((c) => c.path === `/v1/jobs/job-${state}`), `the replayed ${state} job is the one waited on`);
    assert.equal(result.job?.state, 'completed');
  }
});

test('the fresh attempt is bounded: a second stale failure is not retried again', async () => {
  const stale = (id) => ({ job: { jobId: id, operation: 'batch-scrape', state: 'failed' }, created: false });
  const { service, calls } = harness([stale('job-stale-1'), stale('job-stale-2')]);
  await service.searchAndFetch({ ...BASE, turnId: 'turn-A' });
  assert.equal(keyOf(calls, '/v1/batch-scrape').length, 2, 'one fresh attempt, never a loop');
});

test('🔴 BOTH chat callers actually pass a turnId — the fix is unreachable otherwise', async () => {
  /*
   * The service change is inert unless a caller supplies the turn. There are two chat tool
   * loops (the streaming route and the generate route); each must pass one, or that route
   * keeps the old cross-turn key and the sticky failure survives there.
   */
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [['src', 'server', 'routes', 'aiRoutes.js'], ['src', 'server', 'index.js']]) {
    const source = readFileSync(join(root, ...file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const calls = [...source.matchAll(/chatWebContextService\.searchAndFetch\(\{([\s\S]*?)\}\)/g)]
      .map((m) => m[1]).filter((body) => /userMessageId:\s*null/.test(body));
    assert.ok(calls.length >= 1, `${file.join('/')} must still contain its chat searchAndFetch call`);
    for (const body of calls) {
      assert.match(body, /\bturnId:\s*\w/, `${file.join('/')}: a chat search with no userMessageId must pass a turnId`);
    }
  }
});

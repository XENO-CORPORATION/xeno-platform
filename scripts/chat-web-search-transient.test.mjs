/**
 * Chat search must never ask the provider for storage rights it does not have.
 *
 * ## The live defect this pins, found 2026-09-14
 *
 * Every chat web search failed, 100% of the time, from the day the tool loop shipped. The
 * user asked "what's the latest survival game" and got back:
 *
 *   "My searches errored out — both came back with: search failed: Durable web citations
 *    are unavailable until provider storage rights are approved."
 *
 * `chatWebContext.searchAndFetch` called `client.searchAndScrape(…)` — ONE operation that
 * searches AND writes the provider's result URLs, titles, snippets and search evidence to a
 * durable job. Persisting provider output is a plan-licensing right. Ours is transient-only,
 * so the service refused, correctly:
 *
 *   403 PROVIDER_STORAGE_NOT_APPROVED
 *   "approval brave-public-transient-2026-08-29 for provider brave-search does not grant
 *    the right to persist provider results"
 *
 * 🔴 And the operation could not be asked to skip storage. Sending `transient` to that same
 * endpoint is refused from the OTHER side:
 *
 *   400 RESULT_HANDLING_NOT_DURABLE
 *   "search-and-scrape writes provider result URLs, titles, snippets and search evidence to
 *    a durable job; the request must declare resultHandling: 'persist'"
 *
 * Both measured against production on 2026-09-14. A deadlock: persist → 403, transient →
 * 400. There was no value of `resultHandling` that let chat search work through that call.
 *
 * ## Why transient is the HONEST declaration here, not a workaround
 *
 * `resultHandling` is a statement about what the caller will DO with provider output, and
 * the runtime enforces the licence against it. Declaring `transient` to dodge a refusal
 * while still storing the results would be a lie to a licensing control — the trust-store
 * failure of 2026-08-16 in a different costume.
 *
 * It is true here, and that was verified in production rather than assumed: chat's tool
 * loop writes NO provider output. Every `chat_messages.search_context` is NULL on the chat
 * path and `chat_web_context_receipts` is empty — those belong to Research, which issues a
 * server receipt precisely so citations survive a reload. Chat puts sources in the model's
 * context for one turn and cites them in the reply. Nothing is persisted.
 *
 * ⚠️ So this gate has TWO halves and the second is the one that protects the licence:
 * chat must send `transient`, AND the chat path must not persist provider output. If chat
 * ever gains durable citations, this test must go red — that is a licensing decision (an
 * upgraded Brave plan), never a code change.
 *
 * Mutation-checked 2026-09-14, each failing alone against a green control:
 *   resultHandling 'transient' -> 'persist'      -> test 1 fails
 *   restore client.searchAndScrape(…)            -> test 2 fails
 *   make a failed page-job throw instead of degrading -> test 4 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatWebContextService } from '../src/server/services/chatWebContext.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = readFileSync(join(ROOT, 'src', 'server', 'services', 'chatWebContext.js'), 'utf8');
const REQUIRED_SCOPES = [
  'account:read', 'search:execute', 'jobs:write', 'jobs:read', 'jobs:control', 'artifacts:read',
];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

const evidence = (url, id) => ({
  evidenceId: id,
  sourceUrl: url,
  finalUrl: url,
  retrievedAt: '2026-09-14T09:00:00.000Z',
  executor: { kind: 'xeno-worker', id: 'worker-1', version: '1.0.0' },
  policy: { decision: 'allowed', reasons: ['public-classification'] },
  content: { sha256: 'a'.repeat(64), bytes: 120, truncated: false },
  citations: [],
});

const INPUT = {
  actorId: 'user-1',
  conversationId: '00000000-0000-4000-8000-000000000001',
  userMessageId: '00000000-0000-4000-8000-000000000002',
  query: 'latest survival game released',
  count: 2,
};

/**
 * A harness whose upstream behaves like the REAL service did on 2026-09-14: it refuses
 * `persist` with the production 403, and refuses the fused endpoint entirely. A caller that
 * regresses to either therefore fails the way production failed, not in a bespoke way.
 */
function harness({ pageJobState = 'completed', failBatchScrape = false } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, body });

    if (url.pathname === '/v1/account') {
      return json({ tokenId: 't', tenantId: 'tenant-1', scopes: REQUIRED_SCOPES, quota: {} });
    }

    // The production refusal, reproduced exactly.
    if (url.pathname === '/v1/search-and-scrape') {
      return json({ error: {
        code: 'PROVIDER_STORAGE_NOT_APPROVED',
        message: "approval brave-public-transient-2026-08-29 for provider brave-search does not grant the right to persist provider results",
      } }, 403);
    }

    if (url.pathname === '/v1/search') {
      if (body?.resultHandling === 'persist') {
        return json({ error: {
          code: 'PROVIDER_STORAGE_NOT_APPROVED',
          message: 'does not grant the right to persist provider results',
        } }, 403);
      }
      return json({
        requestId: 'req-1',
        terminalReason: 'completed',
        evidence: evidence('https://example.com/', 'search-evidence'),
        items: [
          { url: 'https://example.com/', title: 'Example', description: 'A snippet', rank: 1, provider: 'brave' },
          { url: 'https://example.org/', title: 'Second', description: 'Another snippet', rank: 2, provider: 'brave' },
        ],
      });
    }

    if (url.pathname === '/v1/batch-scrape') {
      if (failBatchScrape) return json({ error: { code: 'UPSTREAM', message: 'no job' } }, 503);
      return json({ job: { jobId: 'job-1', operation: 'batch-scrape', state: pageJobState } }, 202);
    }
    if (url.pathname === '/v1/jobs/job-1') {
      return json({ job: {
        jobId: 'job-1', operation: 'batch-scrape', state: pageJobState,
        completedPages: pageJobState === 'completed' ? 2 : 0, failedPages: 0, excludedPages: 0,
      } });
    }
    if (url.pathname === '/v1/jobs/job-1/results') return json({ items: [] });

    throw new Error(`unexpected request ${url.href}`);
  };

  const warnings = [];
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test',
      XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://127.0.0.1:4310',
      XENO_WEB_CONTEXT_TOKEN: 'test-token',
    },
    fetchImpl,
    logger: { warn: (message, fields) => warnings.push({ message, fields }) },
  });
  return { service, calls, warnings };
}

test('🔴 the search declares resultHandling: transient', async () => {
  const { service, calls } = harness();
  await service.searchAndFetch(INPUT);

  const search = calls.find((c) => c.path === '/v1/search');
  assert.ok(search, 'chat must issue a plain search');
  assert.equal(
    search.body.resultHandling, 'transient',
    'Asking to persist provider results is refused 403 PROVIDER_STORAGE_NOT_APPROVED under our '
    + 'transient-only Brave approval, and it is the reason every chat search failed. It must '
    + 'also be TRUE: chat stores no provider output, which is what makes this declaration '
    + 'honest rather than a way past a licensing control.',
  );
});

test('🔴 chat never calls the fused search-and-scrape operation', async () => {
  const { service, calls } = harness();
  await service.searchAndFetch(INPUT);

  assert.equal(
    calls.some((c) => c.path === '/v1/search-and-scrape'), false,
    'search-and-scrape ALWAYS writes provider output to a durable job — it refuses '
    + 'resultHandling: transient with 400 RESULT_HANDLING_NOT_DURABLE. So it can never be '
    + 'reached under a transient approval, at any parameter value. Search and page-read must '
    + 'stay two operations.',
  );
});

test('the page read is a separate job, and it carries only URLs we already hold', async () => {
  const { service, calls } = harness();
  await service.searchAndFetch(INPUT);

  const scrape = calls.find((c) => c.path === '/v1/batch-scrape');
  assert.ok(scrape, 'page content must still be fetched — splitting the call recovers it, not costs it');
  assert.deepEqual(
    scrape.body.seedUrls.map((s) => s.url).sort(),
    ['https://example.com/', 'https://example.org/'],
    'the fetch step reads the URLs the search returned',
  );
  assert.notEqual(
    scrape.body.idempotencyKey, calls.find((c) => c.path === '/v1/search').body.idempotencyKey,
    'the two operations are separate jobs and must not collide on one idempotency key',
  );
});

test('🔴 a failed page read degrades to snippets instead of losing the turn', async () => {
  for (const [label, options] of [
    ['the job could not be started', { failBatchScrape: true }],
    ['the job failed', { pageJobState: 'failed' }],
  ]) {
    const { service } = harness(options);
    const result = await service.searchAndFetch(INPUT);

    assert.equal(
      result.sources.length, 2,
      `${label}: the SEARCH succeeded, so the turn holds real citable sources. Throwing here `
      + 'would bill the user for a turn and hand them nothing — the exact failure this change '
      + 'exists to remove.',
    );
    assert.equal(result.sources[0].content, '', `${label}: no page text was read`);
    assert.equal(
      result.sources[0].fetchStatus, 'not-fetched',
      `${label}: a degraded source must SAY it is degraded, or a thinner answer looks identical `
      + 'to a complete one',
    );
    assert.equal(result.sources[0].title, 'Example', `${label}: the search result survives`);
  }
});

test('🔴 a degrade is LOGGED with its reason — never silently, and never with user content', async () => {
  /*
   * Found 2026-09-14 in production: the page-read job failed on most real sites and every such
   * turn quietly degraded to snippets with no signal anywhere. The user got a thinner answer;
   * we got nothing to act on. Same silent-catch shape as the `void error` that hid the Opus 5
   * temperature 400 the same morning.
   */
  for (const [label, options, reason] of [
    ['start failed', { failBatchScrape: true }, 'page_job_start_failed'],
    ['job failed', { pageJobState: 'failed' }, 'page_job_failed'],
  ]) {
    const { service, warnings } = harness(options);
    const result = await service.searchAndFetch(INPUT);

    assert.equal(warnings.length, 1, `${label}: exactly one degrade warning`);
    assert.equal(warnings[0].fields.reason, reason, `${label}: the log must say WHY it degraded`);
    assert.equal(warnings[0].fields.requestId, result.requestId, `${label}: and which request, to correlate`);

    const logged = JSON.stringify(warnings[0]);
    assert.doesNotMatch(logged, /survival/, `${label}: the query is user content and must not be logged`);
    assert.doesNotMatch(logged, /example\.(com|org)/, `${label}: nor the result URLs`);
  }
});

test('a page read that succeeds logs no degrade warning', async () => {
  const { service, warnings } = harness();
  await service.searchAndFetch(INPUT);
  assert.equal(warnings.length, 0, 'a warning on the healthy path trains everyone to ignore the real one');
});

test('a cancelled page read is still a cancellation', async () => {
  const { service } = harness({ pageJobState: 'cancelled' });
  await assert.rejects(
    service.searchAndFetch(INPUT),
    (error) => error.code === 'web_context_cancelled',
    'cancellation means the caller went away — unlike a failure, there is no turn left to serve',
  );
});

test('🔴 the chat path persists no provider output — which is what makes transient true', () => {
  /*
   * The declaration is only honest while it holds. Research persists a receipt
   * (`persistWebContextReceipt` in chatRoutes.js) precisely so citations survive a reload,
   * and that is exactly what our approval does not cover. Chat must not grow one silently.
   *
   * Verified against production 2026-09-14: every chat_messages.search_context on the chat
   * path is NULL and chat_web_context_receipts has zero rows.
   */
  assert.doesNotMatch(
    SERVICE, /resultHandling:\s*'persist'/,
    'the chat service must not request result persistence anywhere — our Brave approval is '
    + 'transient-only, and declaring otherwise asks a licensing control to permit what the '
    + 'plan does not',
  );

  const routes = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');
  assert.doesNotMatch(
    routes, /persistWebContextReceipt/,
    'the chat turn must not write a Web Context receipt. Storing provider output is '
    + 'the right our approval withholds; if chat ever needs durable citations the fix is an '
    + 'upgraded provider plan, not a code change that quietly starts storing them.',
  );
});

test('🔴 a failed search is logged on the SERVER with its code', () => {
  /*
   * The client already received the code; the box kept nothing. A turn of rate-limited
   * searches on 2026-09-14 left no trace anywhere on the server — the third silent catch
   * found that day. The query is user content and must not appear in the log call.
   */
  const routes = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');
  const at = routes.indexOf("case 'search_error':");
  assert.ok(at > 0);
  const block = routes.slice(at, routes.indexOf('break;', at));
  assert.match(block, /console\.warn\('\[chat\/stream\] search failed'/, 'the failure must be logged server-side');
  assert.match(block, /code: event\.code/, 'with the code, or the log cannot be acted on');
  assert.doesNotMatch(block, /console\.warn\([^)]*query/s, 'the query is user content and must not be logged');
});

test('🔴 job polling is no faster than once a second', () => {
  /*
   * Every poll is a quota-counted request against a per-token requests-per-minute window
   * the whole platform shares. At 350 ms one search burned ~7 polls and a single chat turn
   * exhausted the window on its own: 5 of 8 searches came back rate-limited.
   */
  const m = SERVICE.match(/pollMs:\s*([\d_]+)/);
  assert.ok(m, 'the page job must be polled');
  assert.ok(Number(m[1].replace(/_/g, '')) >= 1000, `pollMs ${m[1]} — polls are quota-counted; keep them at or above 1 s`);
});

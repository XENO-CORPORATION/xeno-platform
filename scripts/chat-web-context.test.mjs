import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatWebContextError,
  createChatWebContextService,
} from '../src/server/services/chatWebContext.js';

const REQUIRED_SCOPES = [
  'account:read', 'search:execute', 'jobs:write',
  'jobs:read', 'jobs:control', 'artifacts:read',
];

const evidence = (url, id) => ({
  evidenceId: id,
  sourceUrl: url,
  finalUrl: url,
  retrievedAt: '2026-08-31T12:00:00.000Z',
  executor: { kind: 'xeno-worker', id: 'worker-1', version: '1.0.0' },
  policy: { decision: 'allowed', reasons: ['public-classification'] },
  content: { sha256: 'a'.repeat(64), bytes: 120, truncated: false, artifactId: 'private-artifact' },
  citations: [{ url, title: 'Example', artifactId: 'private-artifact' }],
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness({ scopes = REQUIRED_SCOPES, startStatus = 202 } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.href, method: init.method || 'GET', headers: init.headers, body });
    if (url.pathname === '/v1/account') return json({ tokenId: 'token-1', tenantId: 'tenant-1', scopes, quota: {} });
    if (url.pathname === '/v1/search-and-scrape') return json({
      search: {
        terminalReason: 'completed',
        evidence: evidence('https://example.com/', 'search-evidence'),
        items: [{ url: 'https://example.com/', title: 'Example', description: 'Public source', rank: 1, provider: 'brave' }],
      },
      job: { jobId: 'job-1', state: 'completed', completedPages: 1, failedPages: 0, excludedPages: 0 },
    }, startStatus);
    if (url.pathname === '/v1/jobs/job-1/results') return json({
      items: [{
        url: 'https://example.com/',
        state: 'completed',
        artifactUrl: '/v1/jobs/job-1/artifacts/artifact:abc123',
        result: { evidence: evidence('https://example.com/', 'page-evidence') },
      }],
    });
    if (url.pathname === '/v1/jobs/job-1/artifacts/artifact:abc123') {
      return new Response('Verified public page content.', { status: 200, headers: { 'content-type': 'text/markdown' } });
    }
    throw new Error(`unexpected request ${url.href}`);
  };
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test',
      XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://127.0.0.1:4310',
      XENO_WEB_CONTEXT_TOKEN: 'test-secret-token',
    },
    fetchImpl,
    sleep: async () => {},
  });
  return { service, calls };
}

const input = {
  actorId: 'user-1',
  conversationId: '00000000-0000-4000-8000-000000000001',
  userMessageId: '00000000-0000-4000-8000-000000000002',
  query: 'current XENO Web Context status',
  count: 5,
};

test('search-and-fetch sends one provider-neutral public request and projects safe evidence', async () => {
  const { service, calls } = harness();
  const result = await service.searchAndFetch(input);
  const start = calls.find((call) => call.url.endsWith('/v1/search-and-scrape'));
  assert.ok(start);
  assert.equal(start.body.purpose, 'xeno-chat-research');
  assert.equal(start.body.classification, 'public');
  assert.deepEqual(start.body.scope, { kind: 'tenant', tenantId: 'tenant-1' });
  assert.equal(start.body.budget.maxPages, 5);
  assert.deepEqual(start.body.policyContext.allowedPorts, [443]);
  assert.equal(start.headers.authorization, 'Bearer test-secret-token');
  assert.equal(result.sources[0].content, 'Verified public page content.');
  assert.equal(result.searchContext.schema, 'xeno.chat.web-context.v1');
  assert.equal(result.searchContext.sources[0].evidenceId, 'page-evidence');
  assert.doesNotMatch(JSON.stringify(result.searchContext), /private-artifact/);
});

test('stable turn identity produces the same upstream idempotency key', async () => {
  const { service, calls } = harness();
  await service.searchAndFetch(input);
  await service.searchAndFetch(input);
  const starts = calls.filter((call) => call.url.endsWith('/v1/search-and-scrape'));
  assert.equal(starts.length, 2);
  assert.equal(starts[0].body.idempotencyKey, starts[1].body.idempotencyKey);
  assert.notEqual(starts[0].body.requestId, starts[1].body.requestId);
});

test('credentials without the complete Chat authority fail before search', async () => {
  const { service, calls } = harness({ scopes: ['account:read', 'search:execute'] });
  await assert.rejects(
    service.searchAndFetch(input),
    (error) => error instanceof ChatWebContextError && error.code === 'web_context_unavailable',
  );
  assert.equal(calls.some((call) => call.url.endsWith('/v1/search-and-scrape')), false);
});

test('production refuses a plaintext environment token and query bounds are enforced', async () => {
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'production',
      XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'https://web-context.example',
      XENO_WEB_CONTEXT_TOKEN: 'must-not-be-used',
    },
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(service.searchAndFetch(input), /token file/);
  const { service: bounded } = harness();
  await assert.rejects(
    bounded.searchAndFetch({ ...input, query: 'x'.repeat(501) }),
    (error) => error.code === 'invalid_web_context_query' && error.status === 400,
  );
});

test('production reads the bearer credential from its mounted token file', async () => {
  const reads = [];
  const authorization = [];
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'production', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'https://web-context.example',
      XENO_WEB_CONTEXT_TOKEN_FILE: '/run/secrets/xeno_web_context_token',
    },
    readFileSync: (path, encoding) => {
      reads.push({ path, encoding });
      return 'mounted-token\n';
    },
    fetchImpl: async (request, init) => {
      authorization.push(init.headers.authorization);
      return new URL(request).pathname === '/v1/account'
        ? json({ tenantId: 'tenant-1', scopes: REQUIRED_SCOPES })
        : json({ search: { terminalReason: 'completed', items: [] } });
    },
  });
  await service.searchAndFetch(input);
  assert.deepEqual(reads, [{ path: '/run/secrets/xeno_web_context_token', encoding: 'utf8' }]);
  assert.deepEqual(authorization, ['Bearer mounted-token', 'Bearer mounted-token']);
});

test('upstream bodies and credentials do not escape through public errors', async () => {
  const secretBody = 'provider-secret-body';
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://localhost:4310', XENO_WEB_CONTEXT_TOKEN: 'token-do-not-leak',
    },
    fetchImpl: async (input) => new URL(input).pathname === '/v1/account'
      ? json({ tenantId: 'tenant-1', scopes: REQUIRED_SCOPES })
      : json({ error: { code: 'PROVIDER_FAILED', message: secretBody } }, 502),
  });
  await assert.rejects(service.searchAndFetch(input), (error) => {
    assert.equal(error.code, 'web_context_unavailable');
    assert.doesNotMatch(error.message, new RegExp(`${secretBody}|token-do-not-leak`));
    return true;
  });
});

test('partial jobs preserve terminal counters and bound artifact text', async () => {
  const longText = 'x'.repeat(20 * 1024);
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/v1/account') return json({ tenantId: 'tenant-1', scopes: REQUIRED_SCOPES });
    if (url.pathname === '/v1/search-and-scrape') return json({
      search: {
        evidence: evidence('https://example.com/', 'search-partial'),
        items: [
          { url: 'https://example.com/', title: 'Completed', rank: 1, provider: 'brave' },
          { url: 'http://insecure.example/', title: 'Discarded', rank: 2, provider: 'brave' },
        ],
      },
      job: { jobId: 'job-1', state: 'partial', completedPages: 1, failedPages: 1, excludedPages: 0 },
    }, 202);
    if (url.pathname === '/v1/jobs/job-1/results') return json({
      items: [{
        url: 'https://example.com/', state: 'completed',
        artifactUrl: '/v1/jobs/job-1/artifacts/artifact:abc123',
        result: { evidence: evidence('https://example.com/', 'page-partial') },
      }],
    });
    if (url.pathname.includes('/artifacts/')) return new Response(longText);
    throw new Error(`unexpected request ${url.href}`);
  };
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://localhost:4310', XENO_WEB_CONTEXT_TOKEN: 'token',
    },
    fetchImpl,
  });
  const result = await service.searchAndFetch(input);
  assert.equal(result.terminalReason, 'partial');
  assert.deepEqual(result.job, { state: 'partial', completedPages: 1, failedPages: 1, excludedPages: 0 });
  assert.equal(result.sources.length, 1, 'non-HTTPS source URLs must be discarded');
  assert.equal(new TextEncoder().encode(result.sources[0].content).byteLength, 12 * 1024);
});

test('polling is capped and a timed-out durable job is cancelled', async () => {
  let polls = 0;
  let cancelled = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/v1/account') return json({ tenantId: 'tenant-1', scopes: REQUIRED_SCOPES });
    if (url.pathname === '/v1/search-and-scrape') return json({
      search: {
        evidence: evidence('https://example.com/', 'search-running'),
        items: [{ url: 'https://example.com/', title: 'Example', rank: 1, provider: 'brave' }],
      },
      job: { jobId: 'job-1', state: 'running' },
    }, 202);
    if (url.pathname === '/v1/jobs/job-1' && (init.method || 'GET') === 'GET') {
      polls += 1;
      return json({ job: { jobId: 'job-1', state: 'running' } });
    }
    if (url.pathname === '/v1/jobs/job-1/cancel') {
      cancelled += 1;
      return json({ job: { jobId: 'job-1', state: 'cancelled' } });
    }
    throw new Error(`unexpected request ${url.href}`);
  };
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'test', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: 'http://localhost:4310', XENO_WEB_CONTEXT_TOKEN: 'token',
    },
    fetchImpl,
    sleep: async () => {},
  });
  await assert.rejects(service.searchAndFetch(input), (error) => error.code === 'web_context_timeout');
  assert.equal(polls, 12);
  assert.equal(cancelled, 1);
});

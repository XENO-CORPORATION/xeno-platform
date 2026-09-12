import crypto from 'crypto';
import fs from 'fs';
import { WebContextClient } from '@xenosystem/web-context-client';

const CONTRACT_VERSION = '1.0.0';
const REQUIRED_SCOPES = Object.freeze([
  'account:read',
  'search:execute',
  'jobs:write',
  'jobs:read',
  'jobs:control',
  'artifacts:read',
]);
const MAX_QUERY_CHARS = 500;
const DEFAULT_COUNT = 6;
const MAX_COUNT = 8;
const MAX_PAGE_TEXT_BYTES = 12 * 1024;
const MAX_TOTAL_TEXT_BYTES = 48 * 1024;
const RESEARCH_BUDGETS = Object.freeze({
  quick: Object.freeze({ operationMs: 25_000, upstreamMs: 20_000, maxAttempts: 2, maxConcurrency: 3 }),
  deep: Object.freeze({ operationMs: 90_000, upstreamMs: 85_000, maxAttempts: 3, maxConcurrency: 4 }),
});

export class ChatWebContextError extends Error {
  constructor(code, message, { status = 503, retryable = false, requestId, cause } = {}) {
    super(message, { cause });
    this.name = 'ChatWebContextError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeQuery(value) {
  const query = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!query || query.length > MAX_QUERY_CHARS) {
    throw new ChatWebContextError(
      'invalid_web_context_query',
      `Query must contain between 1 and ${MAX_QUERY_CHARS} characters.`,
      { status: 400 },
    );
  }
  return query;
}

function normalizeCount(value) {
  if (value === undefined) return DEFAULT_COUNT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_COUNT) {
    throw new ChatWebContextError(
      'invalid_web_context_count',
      `Result count must be an integer between 1 and ${MAX_COUNT}.`,
      { status: 400 },
    );
  }
  return value;
}

function normalizeMaxProviderCost(value) {
  const cost = value === undefined || value === '' ? 0.02 : Number(value);
  if (!Number.isFinite(cost) || cost < 0 || cost > 1) {
    throw new ChatWebContextError(
      'web_context_unavailable',
      'Web Context provider cost budget is invalid.',
    );
  }
  return cost;
}

function normalizeServiceUrl(raw, nodeEnv) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ChatWebContextError('web_context_unavailable', 'Web Context service URL is invalid.');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost';
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ChatWebContextError('web_context_unavailable', 'Web Context service URL must be an origin only.');
  }
  if (url.protocol !== 'https:' && !(nodeEnv !== 'production' && loopback && url.protocol === 'http:')) {
    throw new ChatWebContextError('web_context_unavailable', 'Web Context requires HTTPS outside local development.');
  }
  return url;
}

function readToken(env, readFileSync) {
  if (env.XENO_WEB_CONTEXT_TOKEN_FILE) {
    const token = String(readFileSync(env.XENO_WEB_CONTEXT_TOKEN_FILE, 'utf8')).trim();
    if (!token) throw new ChatWebContextError('web_context_unavailable', 'Web Context token file is empty.');
    return token;
  }
  if (env.NODE_ENV === 'production' && env.XENO_WEB_CONTEXT_TOKEN) {
    throw new ChatWebContextError('web_context_unavailable', 'Production Web Context credentials must use a token file.');
  }
  const token = String(env.XENO_WEB_CONTEXT_TOKEN || '').trim();
  if (!token) throw new ChatWebContextError('web_context_unavailable', 'Web Context credentials are not configured.');
  return token;
}

function enabled(env) {
  return String(env.XENO_CHAT_WEB_CONTEXT_ENABLED || '').toLowerCase() === 'true';
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function projectEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const sourceUrl = safeHttpsUrl(evidence.sourceUrl);
  const finalUrl = safeHttpsUrl(evidence.finalUrl || evidence.sourceUrl);
  const citations = Array.isArray(evidence.citations)
    ? evidence.citations.slice(0, 16).flatMap((citation) => {
        const url = safeHttpsUrl(citation?.url);
        return url ? [{ url, title: String(citation?.title || '').slice(0, 500) || undefined }] : [];
      })
    : [];
  return {
    evidenceId: String(evidence.evidenceId || '').slice(0, 256),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(finalUrl ? { finalUrl } : {}),
    retrievedAt: String(evidence.retrievedAt || '').slice(0, 64),
    executor: {
      kind: String(evidence.executor?.kind || '').slice(0, 32),
      id: String(evidence.executor?.id || '').slice(0, 128),
      version: String(evidence.executor?.version || '').slice(0, 64),
    },
    policy: {
      decision: String(evidence.policy?.decision || '').slice(0, 16),
      reasons: Array.isArray(evidence.policy?.reasons)
        ? evidence.policy.reasons.slice(0, 16).map((reason) => String(reason).slice(0, 256))
        : [],
    },
    content: {
      ...(typeof evidence.content?.sha256 === 'string' ? { sha256: evidence.content.sha256.slice(0, 128) } : {}),
      ...(Number.isFinite(evidence.content?.bytes) ? { bytes: Number(evidence.content.bytes) } : {}),
      truncated: Boolean(evidence.content?.truncated),
    },
    citations,
  };
}

function upstreamError(error, requestId) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || 'WEB_CONTEXT_UPSTREAM_ERROR');
  const retryable = status === 429 || status >= 500;
  const publicCode = code === 'PROVIDER_STORAGE_NOT_APPROVED'
    ? 'web_context_storage_not_approved'
    : status === 429 ? 'web_context_rate_limited' : 'web_context_unavailable';
  return new ChatWebContextError(publicCode, retryable
    ? 'Web research is temporarily unavailable. Please try again.'
    : code === 'PROVIDER_STORAGE_NOT_APPROVED'
      ? 'Durable web citations are unavailable until provider storage rights are approved.'
      : 'Web research is not available for this request.', {
    status: code === 'PROVIDER_STORAGE_NOT_APPROVED' ? 403 : status === 429 ? 429 : 503,
    retryable,
    requestId,
    cause: error,
  });
}

export function createChatWebContextService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileSync = fs.readFileSync,
  now = () => Date.now(),
  researchBudgets = RESEARCH_BUDGETS,
} = {}) {
  let accountCache = null;

  function configuration() {
    if (!enabled(env)) throw new ChatWebContextError('web_context_unavailable', 'Web research is not enabled.');
    const baseUrl = normalizeServiceUrl(env.XENO_WEB_CONTEXT_URL || '', env.NODE_ENV);
    const token = readToken(env, readFileSync);
    return { baseUrl, token, tokenDigest: digest(token) };
  }

  async function account(client, config, signal) {
    if (accountCache?.tokenDigest === config.tokenDigest) return accountCache.value;
    const value = await client.account({ signal });
    const scopes = Array.isArray(value.scopes) ? value.scopes : [];
    const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes('*') && !scopes.includes(scope));
    if (!value.tenantId || missing.length) {
      throw new ChatWebContextError('web_context_unavailable', 'Web Context credential lacks required authority.');
    }
    accountCache = { tokenDigest: config.tokenDigest, value };
    return value;
  }

  async function searchAndFetch({ actorId, conversationId, userMessageId, query: rawQuery, count: rawCount, depth = 'quick', signal, onProgress }) {
    const query = normalizeQuery(rawQuery);
    const count = normalizeCount(rawCount);
    if (!Object.hasOwn(researchBudgets, depth)) {
      throw new ChatWebContextError('invalid_web_context_depth', 'Research depth must be quick or deep.', { status: 400 });
    }
    const budget = researchBudgets[depth];
    const config = configuration();
    const client = new WebContextClient({ baseUrl: config.baseUrl.href, token: config.token, fetchImpl });
    const requestId = crypto.randomUUID();
    try {
      const principal = await account(client, config, signal);
      const idempotencyKey = `chat:${digest(`${actorId}\0${conversationId}\0${userMessageId}\0${query}`).slice(0, 48)}`;
      const upstreamDeadline = new Date(now() + budget.upstreamMs).toISOString();
      const searchRequest = {
        contractVersion: CONTRACT_VERSION,
        requestId,
        actor: { id: actorId, kind: 'human' },
        purpose: 'xeno-chat-research',
        classification: 'public',
        scope: { kind: 'tenant', tenantId: principal.tenantId },
        budget: {
          deadline: upstreamDeadline,
          maxAttempts: budget.maxAttempts,
          maxConcurrency: budget.maxConcurrency,
          maxBytes: 1024 * 1024,
          maxPages: count,
          maxDurationMs: budget.upstreamMs,
          maxRedirects: 5,
          maxProviderCostUsd: normalizeMaxProviderCost(env.XENO_CHAT_WEB_CONTEXT_MAX_COST_USD),
        },
        policyContext: { allowedPorts: [443], allowedMediaTypes: ['text/html', 'text/plain', 'text/markdown'] },
        idempotencyKey,
        query,
        resultHandling: 'persist',
        count,
      };
      const started = await client.searchAndScrape(searchRequest, { signal });
      const search = started.search;
      const searchEvidence = projectEvidence(search?.evidence);
      const searchItems = Array.isArray(search?.items)
        ? search.items.flatMap((item) => {
            const url = safeHttpsUrl(item?.url);
            return url ? [{
              url,
              title: String(item?.title || url).slice(0, 500),
              description: String(item?.description || '').slice(0, 2_000),
              rank: Number.isFinite(item?.rank) ? Number(item.rank) : 0,
              provider: String(item?.provider || 'unknown').slice(0, 128),
            }] : [];
          })
        : [];
      if (!started.job) {
        return {
          requestId,
          terminalReason: search?.terminalReason || 'completed',
          sources: [],
          searchEvidence,
          searchContext: {
            schema: 'xeno.chat.web-context.v1', operation: 'search-and-fetch', query,
            requestId, terminalReason: search?.terminalReason || 'completed',
            evidenceId: searchEvidence?.evidenceId || null,
            retrievedAt: searchEvidence?.retrievedAt || new Date(now()).toISOString(), sources: [],
          },
        };
      }
      const jobId = String(started.job.jobId);
      const job = await client.waitForJob(jobId, {
        timeoutMs: budget.operationMs,
        pollMs: 350,
        signal,
        onProgress,
        cancelOnAbort: true,
        cancelOnTimeout: true,
        cancelConfirmationMs: 2_000,
      });
      if (job.state === 'failed' || job.state === 'cancelled') {
        throw new ChatWebContextError('web_context_failed', 'Web research could not retrieve public sources.', {
          status: 502, retryable: job.state === 'failed', requestId,
        });
      }
      const results = await client.results(jobId, { limit: count, signal });
      const byUrl = new Map((Array.isArray(results.items) ? results.items : []).map((item) => [safeHttpsUrl(item?.url), item]));
      let totalTextBytes = 0;
      const sources = [];
      for (const item of searchItems) {
        const page = byUrl.get(item.url);
        const evidence = projectEvidence(page?.result?.evidence);
        let content = '';
        const artifactId = typeof page?.artifactId === 'string'
          ? page.artifactId
          : typeof page?.artifactUrl === 'string' ? page.artifactUrl.split('/').at(-1) : '';
        if (page?.state === 'completed' && /^artifact:[a-f0-9]{64}$/i.test(artifactId) && totalTextBytes < MAX_TOTAL_TEXT_BYTES) {
          const limit = Math.min(MAX_PAGE_TEXT_BYTES, MAX_TOTAL_TEXT_BYTES - totalTextBytes);
          const artifact = await client.artifact(jobId, artifactId, { signal });
          const bytes = artifact.bytes.subarray(0, limit);
          content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          totalTextBytes += bytes.byteLength;
        }
        sources.push({
          ...item,
          content,
          fetchStatus: String(page?.state || 'not-fetched'),
          evidence,
        });
      }
      const contextSources = sources.map(({ content: _content, evidence, ...source }) => ({
        uri: source.url,
        title: source.title,
        description: source.description,
        provider: source.provider,
        rank: source.rank,
        fetchStatus: source.fetchStatus,
        ...(evidence || {}),
      }));
      return {
        requestId,
        terminalReason: job.state,
        job: {
          state: job.state,
          completedPages: Number(job.completedPages || 0),
          failedPages: Number(job.failedPages || 0),
          excludedPages: Number(job.excludedPages || 0),
        },
        sources,
        searchEvidence,
        searchContext: {
          schema: 'xeno.chat.web-context.v1', operation: 'search-and-fetch', query,
          requestId, terminalReason: job.state,
          evidenceId: searchEvidence?.evidenceId || null,
          retrievedAt: searchEvidence?.retrievedAt || new Date(now()).toISOString(),
          sources: contextSources,
        },
      };
    } catch (error) {
      if (error instanceof ChatWebContextError) throw error;
      if (signal?.aborted || error?.name === 'AbortError') {
        throw new ChatWebContextError('web_context_cancelled', 'Web research was cancelled.', {
          status: 499, retryable: false, requestId, cause: error,
        });
      }
      if (error?.code === 'WAIT_TIMEOUT') {
        throw new ChatWebContextError('web_context_timeout', 'Web research timed out before it could finish.', {
          status: 504, retryable: true, requestId, cause: error,
        });
      }
      if (Number.isFinite(error?.status) || typeof error?.code === 'string') throw upstreamError(error, requestId);
      throw new ChatWebContextError('web_context_unavailable', 'Web research is temporarily unavailable.', {
        retryable: true, requestId, cause: error,
      });
    }
  }

  return { searchAndFetch };
}

export const chatWebContextService = createChatWebContextService();
export const CHAT_WEB_CONTEXT_REQUIRED_SCOPES = REQUIRED_SCOPES;

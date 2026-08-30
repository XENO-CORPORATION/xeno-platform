import crypto from 'crypto';
import fs from 'fs';

const CONTRACT_VERSION = '1.0.0';
const REQUIRED_SCOPES = Object.freeze([
  'account:read',
  'search:execute',
  'jobs:write',
  'jobs:read',
  'jobs:control',
  'artifacts:read',
]);
const TERMINAL_JOB_STATES = new Set(['completed', 'partial', 'failed', 'cancelled']);
const MAX_QUERY_CHARS = 500;
const DEFAULT_COUNT = 6;
const MAX_COUNT = 8;
const OPERATION_TIMEOUT_MS = 25_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_POLL_CALLS = 12;
const MAX_PAGE_TEXT_BYTES = 12 * 1024;
const MAX_TOTAL_TEXT_BYTES = 48 * 1024;

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

async function readTextBounded(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - bytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      bytes += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function upstreamError(status, body, requestId) {
  const code = String(body?.error?.code || 'WEB_CONTEXT_UPSTREAM_ERROR');
  const retryable = status === 429 || status >= 500;
  const publicCode = status === 429 ? 'web_context_rate_limited' : 'web_context_unavailable';
  return new ChatWebContextError(publicCode, retryable
    ? 'Web research is temporarily unavailable. Please try again.'
    : 'Web research is not available for this request.', {
    status: status === 429 ? 429 : 503,
    retryable,
    requestId: body?.error?.requestId || requestId,
    cause: new Error(`Web Context ${status} ${code}`),
  });
}

export function createChatWebContextService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileSync = fs.readFileSync,
  now = () => Date.now(),
  sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  }),
} = {}) {
  let accountCache = null;

  function configuration() {
    if (!enabled(env)) throw new ChatWebContextError('web_context_unavailable', 'Web research is not enabled.');
    const baseUrl = normalizeServiceUrl(env.XENO_WEB_CONTEXT_URL || '', env.NODE_ENV);
    const token = readToken(env, readFileSync);
    return { baseUrl, token, tokenDigest: digest(token) };
  }

  async function request(config, path, { method = 'GET', body, signal } = {}) {
    const target = new URL(path, config.baseUrl);
    if (target.origin !== config.baseUrl.origin) {
      throw new ChatWebContextError('web_context_unavailable', 'Web Context target escaped the configured origin.');
    }
    let response;
    try {
      response = await fetchImpl(target, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw signal.reason || cause;
      throw new ChatWebContextError('web_context_unavailable', 'Web research is temporarily unavailable.', {
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch { /* intentionally redacted */ }
      throw upstreamError(response.status, payload);
    }
    return response;
  }

  async function account(config, signal) {
    if (accountCache?.tokenDigest === config.tokenDigest) return accountCache.value;
    const response = await request(config, '/v1/account', { signal });
    const value = await response.json();
    const scopes = Array.isArray(value.scopes) ? value.scopes : [];
    const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes('*') && !scopes.includes(scope));
    if (!value.tenantId || missing.length) {
      throw new ChatWebContextError('web_context_unavailable', 'Web Context credential lacks required authority.');
    }
    accountCache = { tokenDigest: config.tokenDigest, value };
    return value;
  }

  async function cancelJob(config, jobId) {
    try { await request(config, `/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }); } catch { /* best effort */ }
  }

  async function searchAndFetch({ actorId, conversationId, userMessageId, query: rawQuery, count: rawCount, signal }) {
    const query = normalizeQuery(rawQuery);
    const count = normalizeCount(rawCount);
    const config = configuration();
    const requestId = crypto.randomUUID();
    const deadline = now() + OPERATION_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new ChatWebContextError(
      'web_context_timeout',
      'Web research timed out before it could finish.',
      { status: 504, retryable: true, requestId },
    )), OPERATION_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    let jobId = null;
    try {
      const principal = await account(config, controller.signal);
      const idempotencyKey = `chat:${digest(`${actorId}\0${conversationId}\0${userMessageId}\0${query}`).slice(0, 48)}`;
      const upstreamDeadline = new Date(Math.min(deadline - 5_000, now() + UPSTREAM_TIMEOUT_MS)).toISOString();
      const searchRequest = {
        contractVersion: CONTRACT_VERSION,
        requestId,
        actor: { id: actorId, kind: 'human' },
        purpose: 'xeno-chat-research',
        classification: 'public',
        scope: { kind: 'tenant', tenantId: principal.tenantId },
        budget: {
          deadline: upstreamDeadline,
          maxAttempts: 2,
          maxConcurrency: 3,
          maxBytes: 1024 * 1024,
          maxPages: count,
          maxDurationMs: UPSTREAM_TIMEOUT_MS,
          maxRedirects: 5,
          maxProviderCostUsd: normalizeMaxProviderCost(env.XENO_CHAT_WEB_CONTEXT_MAX_COST_USD),
        },
        policyContext: { allowedPorts: [443], allowedMediaTypes: ['text/html', 'text/plain', 'text/markdown'] },
        idempotencyKey,
        query,
        resultHandling: 'persist',
        count,
      };
      const startResponse = await request(config, '/v1/search-and-scrape', {
        method: 'POST', body: searchRequest, signal: controller.signal,
      });
      const started = await startResponse.json();
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
      jobId = String(started.job.jobId);
      let job = started.job;
      let delay = 350;
      for (let polls = 0; !TERMINAL_JOB_STATES.has(job.state) && polls < MAX_POLL_CALLS; polls += 1) {
        await sleep(Math.min(delay, Math.max(1, deadline - now())), controller.signal);
        const response = await request(config, `/v1/jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
        job = (await response.json()).job;
        delay = Math.min(2_000, Math.ceil(delay * 1.65));
      }
      if (!TERMINAL_JOB_STATES.has(job.state)) {
        throw new ChatWebContextError('web_context_timeout', 'Web research timed out before it could finish.', {
          status: 504, retryable: true, requestId,
        });
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        throw new ChatWebContextError('web_context_failed', 'Web research could not retrieve public sources.', {
          status: 502, retryable: job.state === 'failed', requestId,
        });
      }
      const resultsResponse = await request(config, `/v1/jobs/${encodeURIComponent(jobId)}/results?limit=${count}`, {
        signal: controller.signal,
      });
      const results = await resultsResponse.json();
      const byUrl = new Map((Array.isArray(results.items) ? results.items : []).map((item) => [safeHttpsUrl(item?.url), item]));
      let totalTextBytes = 0;
      const sources = [];
      for (const item of searchItems) {
        const page = byUrl.get(item.url);
        const evidence = projectEvidence(page?.result?.evidence);
        let content = '';
        const artifactUrl = typeof page?.artifactUrl === 'string' ? page.artifactUrl : '';
        const expectedPrefix = `/v1/jobs/${jobId}/artifacts/artifact:`;
        if (page?.state === 'completed' && artifactUrl.startsWith(expectedPrefix) && totalTextBytes < MAX_TOTAL_TEXT_BYTES) {
          const limit = Math.min(MAX_PAGE_TEXT_BYTES, MAX_TOTAL_TEXT_BYTES - totalTextBytes);
          const artifactResponse = await request(config, artifactUrl, { signal: controller.signal });
          content = await readTextBounded(artifactResponse, limit);
          totalTextBytes += new TextEncoder().encode(content).byteLength;
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
      if (jobId && (controller.signal.aborted || error?.code === 'web_context_timeout')) await cancelJob(config, jobId);
      if (error instanceof ChatWebContextError) throw error;
      throw new ChatWebContextError('web_context_unavailable', 'Web research is temporarily unavailable.', {
        retryable: true, requestId, cause: error,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return { searchAndFetch };
}

export const chatWebContextService = createChatWebContextService();
export const CHAT_WEB_CONTEXT_REQUIRED_SCOPES = REQUIRED_SCOPES;

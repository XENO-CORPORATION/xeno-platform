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

/**
 * Container names that may be reached over plain HTTP in production.
 *
 * 🔴 Why this exists: Web Context runs on the SAME host as this backend, yet every chat
 * search used to leave the machine, cross Cloudflare's edge and come back — 151 ms against
 * 3 ms direct, measured 2026-09-14, and the source of intermittent 502 HTML pages that made
 * four of six searches in one turn fail. The backend now joins Web Context's own `frontend`
 * Docker network and calls the API container by name, so the traffic never touches a wire.
 *
 * ⚠️ The HTTPS rule below is still right for everything else, so this is an explicit
 * ALLOWLIST of names, never a "private IP range" heuristic: `10.x` addresses also carry VPN
 * and overlay traffic that DOES cross a physical wire, where a plaintext bearer token would
 * be exposed. A name must be listed here to be exempt.
 */
function internalHosts(env) {
  return new Set(
    String(env.XENO_WEB_CONTEXT_INTERNAL_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeServiceUrl(raw, nodeEnv, allowedInternalHosts = new Set()) {
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
  /*
   * A Docker service/container name is a single label. Refusing any host containing a dot
   * (or a colon) means the allowlist cannot be pointed at a public FQDN or a raw IP address
   * even by mistake — the exemption is structurally confined to container-name resolution.
   */
  const internalContainer = url.protocol === 'http:'
    && !url.hostname.includes('.')
    && !url.hostname.includes(':')
    && allowedInternalHosts.has(url.hostname.toLowerCase());
  if (url.protocol !== 'https:'
    && !internalContainer
    && !(nodeEnv !== 'production' && loopback && url.protocol === 'http:')) {
    throw new ChatWebContextError('web_context_unavailable', 'Web Context requires HTTPS outside local development.');
  }
  return url;
}

/**
 * Transient upstream failures worth ONE quick retry.
 *
 * ⚠️ 429 is deliberately absent. A rate limit is the service asking us to slow down, and a
 * retry a few hundred milliseconds later just spends quota answering the same refusal. Only
 * gateway faults (502/503/504) and a request that never got an HTTP status at all — a dropped
 * connection — are retried. The search carries an idempotency key, so a retry cannot
 * double-charge the provider.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function isRetryable(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return false;
  if (typeof error?.status === 'number') return RETRYABLE_STATUSES.has(error.status);
  return !(error instanceof ChatWebContextError);
}

async function withRetry(operation, { signal, sleep, random, attempts = 2 }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error, signal)) throw error;
      // Jittered so concurrent turns that hit the same fault do not retry in lockstep.
      await sleep(150 + Math.floor(random() * 250));
    }
  }
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

/**
 * Is web search actually configured on this deployment?
 *
 * Exported so the chat endpoint can decide whether to offer the `web_search` TOOL at all,
 * reading the same flag this service gates itself on rather than a second copy of the check.
 *
 * 🔴 Two copies of an availability test is how a model comes to be handed a tool the server
 * cannot run — the fabrication defect of 2026-09-13, one layer down. If the flag is off the
 * tool must never be declared, so the model refuses honestly instead of calling into nothing.
 */
export const webSearchAvailable = (env = process.env) => enabled(env);

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

/**
 * The turn's result when the SEARCH worked but the page fetch did not.
 *
 * 🔴 Search and fetch are two operations now, so they can fail independently — and the
 * search half is the one that carries the answer's substance. Titles, URLs and snippets are
 * real, citable sources; a model can answer "what is the latest survival game" from them
 * perfectly well. Throwing away a successful search because the follow-up fetch failed
 * would bill the user for a turn and hand them nothing, which is the failure this whole
 * change exists to remove.
 *
 * ⚠️ `fetchStatus: 'not-fetched'` is deliberate and load-bearing: the caller can tell a
 * snippet-only source from a fully-read one, so a degraded turn is visible rather than
 * silently thinner. Never report it as fetched.
 */
function snippetOnlyResult({ requestId, query, searchItems, searchEvidence, search, now = () => Date.now() }) {
  const terminalReason = search?.terminalReason || 'completed';
  const sources = searchItems.map((item) => ({
    ...item,
    content: '',
    fetchStatus: 'not-fetched',
    evidence: null,
  }));
  return {
    requestId,
    terminalReason,
    sources,
    searchEvidence,
    searchContext: {
      schema: 'xeno.chat.web-context.v1', operation: 'search-and-fetch', query,
      requestId, terminalReason,
      evidenceId: searchEvidence?.evidenceId || null,
      retrievedAt: searchEvidence?.retrievedAt || new Date(now()).toISOString(),
      sources: searchItems.map((item) => ({
        uri: item.url,
        title: item.title,
        description: item.description,
        provider: item.provider,
        rank: item.rank,
        fetchStatus: 'not-fetched',
      })),
    },
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
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  logger = console,
} = {}) {
  let accountCache = null;

  /**
   * 🔴 A degrade must be VISIBLE to us, not only to the user.
   *
   * Found 2026-09-14: the page-read job was failing on most real sites, every such turn
   * quietly degraded to snippets, and nothing anywhere said so — the same silent-catch shape
   * as the `void error` that hid the Opus 5 temperature 400 the same morning. The user got a
   * thinner answer and we got no signal at all.
   *
   * ⚠️ Request id, reason and counters ONLY. Never the query, the result URLs or the user:
   * a search query is user content, and these logs are retained far longer than the turn.
   */
  function logDegraded(reason, requestId, details = {}) {
    logger.warn('[ChatWebContext] page read degraded to snippets', { requestId, reason, ...details });
  }

  function configuration() {
    if (!enabled(env)) throw new ChatWebContextError('web_context_unavailable', 'Web research is not enabled.');
    const baseUrl = normalizeServiceUrl(env.XENO_WEB_CONTEXT_URL || '', env.NODE_ENV, internalHosts(env));
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
      const requestBase = {
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
      };

      /*
       * ── STEP 1: SEARCH, TRANSIENTLY ───────────────────────────────────────────────────
       *
       * 🔴 `resultHandling: 'transient'`, and it is the whole fix. This used to call
       * `searchAndScrape` — ONE operation that searches and then writes the provider's
       * result URLs, titles, snippets and search evidence to a durable job. Storing
       * provider output is a plan-licensing right, and ours is transient-only:
       *
       *   403 PROVIDER_STORAGE_NOT_APPROVED
       *   "approval brave-public-transient-2026-08-29 for provider brave-search does not
       *    grant the right to persist provider results"
       *
       * And that operation cannot be asked to skip storage — it refuses from the other side
       * with 400 RESULT_HANDLING_NOT_DURABLE. So chat search sat in a deadlock and failed
       * 100% of the time, which the user saw as "My searches errored out".
       *
       * ⚠️ The provider was REFUSING CORRECTLY. It would rather fail loudly than spend a
       * Brave request and quietly store data the approval forbids. The defect was ours: chat
       * inherited the Research path, whose durable citations genuinely need those rights.
       * A chat turn does not — it needs sources in context now, cited in the reply.
       *
       * This mirrors `xeno-agent-sdk/src/tools/web-context.ts`, whose WebSearch tool has
       * always called `search(… resultHandling: "transient")` and has always worked against
       * this same service and token class. The pattern is not new; chat was the odd caller.
       */
      /*
       * Retried ONCE on a gateway fault or a dropped connection — the idempotency key is the
       * same on both attempts, so the provider can never be charged twice for one search.
       * See `withRetry` for why a 429 is deliberately not retried.
       */
      const search = await withRetry(
        () => client.search(
          { ...requestBase, idempotencyKey, query, resultHandling: 'transient', count },
          { signal },
        ),
        { signal, sleep, random },
      );
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

      /*
       * ── STEP 2: READ THE PAGES ────────────────────────────────────────────────────────
       *
       * Fetching a URL the caller already holds is not provider output, so `batch-scrape`
       * needs no storage approval — verified against production, 202 → completed, with
       * artifact text read back. That is why splitting the fused operation recovers page
       * content rather than costing it: only the SEARCH half was ever licence-restricted.
       *
       * A search with no usable results skips this entirely: there is nothing to fetch, and
       * issuing an empty job would spend a round trip to learn what we already know.
       */
      if (searchItems.length === 0) {
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

      /*
       * ⚠️ If the page fetch cannot even be STARTED, the turn still has real sources — the
       * titles, URLs and snippets the search returned. Answering from those is strictly
       * better than failing a turn the user has been billed for, so this degrades to
       * snippet-only rather than throwing. `fetchStatus` tells the caller which it got.
       *
       * 🔴 The failure arrives as a THROWN client error, not a falsy return — found by the
       * gate, which fed it the 503 a real upstream sends. Checking only the return value
       * would have left the degrade path unreachable for the way this actually fails, so the
       * turn would still have died with the search results sitting unused in hand.
       *
       * An abort is re-thrown: the caller went away, so there is no turn left to serve, and
       * silently "degrading" a cancellation would hide it from the outer handler.
       */
      let started;
      let startError = null;
      try {
        started = await client.batchScrape({
          ...requestBase,
          idempotencyKey: `${idempotencyKey}:pages`,
          seedUrls: searchItems.map((item) => ({ url: item.url })),
        }, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        started = null;
        startError = error;
      }

      if (!started?.job) {
        logDegraded(startError ? 'page_job_start_failed' : 'page_job_not_created', requestId, {
          status: startError?.status,
          code: startError?.code,
        });
        return snippetOnlyResult({ requestId, query, searchItems, searchEvidence, search });
      }

      const jobId = String(started.job.jobId);
      const job = await client.waitForJob(jobId, {
        timeoutMs: budget.operationMs,
        /*
         * 🔴 Every poll is a quota-counted request. Web Context enforces a fixed
         * requests-per-minute window per token, the whole platform shares one token, and a
         * page job takes ~2–3 s — so at 350 ms a single search spent ~7 polls on top of its
         * search, job and results calls, and one chat turn (up to 10 searches) blew the
         * window by itself. Measured 2026-09-14: 5 of 8 searches in one turn came back
         * web_context_rate_limited, starved by the polls of the searches before them.
         * At 1 s a search costs ~3 polls; the extra latency is under a second.
         */
        pollMs: 1_000,
        signal,
        onProgress,
        cancelOnAbort: true,
        cancelOnTimeout: true,
        cancelConfirmationMs: 2_000,
      });
      /*
       * 🔴 A CANCELLED fetch is still a cancellation — it means the caller aborted, and the
       * turn is over. But a FAILED one is not fatal any more: the search half succeeded, so
       * we hold real sources. Throwing here would discard them and produce exactly the
       * "searches errored out" message the user already saw, for a turn that in fact has
       * something to say. Degrade to snippets and let the model answer from those.
       */
      if (job.state === 'cancelled') {
        throw new ChatWebContextError('web_context_cancelled', 'Web research was cancelled.', {
          status: 499, retryable: false, requestId,
        });
      }
      if (job.state === 'failed') {
        logDegraded('page_job_failed', requestId, {
          completedPages: Number(job.completedPages || 0),
          failedPages: Number(job.failedPages || 0),
          excludedPages: Number(job.excludedPages || 0),
        });
        return snippetOnlyResult({ requestId, query, searchItems, searchEvidence, search });
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

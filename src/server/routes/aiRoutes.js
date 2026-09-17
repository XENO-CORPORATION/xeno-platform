import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import path from 'path';
import { generateSignedUrl } from '../middleware/cdnOptimization.js';
import { resolveRoute, normalizePath, catalogPaths } from '../utils/modelPaths.js';
import { meterPremiumChat, meterPremiumChatStream } from '../utils/inferenceMeter.js';
import { estimateChatCostMicro, estimateMessageTokens } from '../utils/creditCosts.js';
import { getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { xenoChatCompletion, xenoChatCompletionStream, xenoApiConfigured, classifyUpstreamError } from '../utils/xenoChat.js';
import { enforceInHouseDailyLimit, limitExceededBody } from '../middleware/inHouseDailyLimit.js';
import requireEntitlement from '../middleware/requireEntitlement.js';
import { byokEnabled, resolveInferenceRoute } from '../services/providerCredentials.js';
import { mintGrant } from '../services/inferenceGrants.js';
import { requestSurface } from '../utils/requestSurface.js';
import { recordInferenceUsage } from '../utils/recordInferenceUsage.js';
import { upstreamFetch } from '../services/upstream.js';
import { streamToolLoop, addUsage, TOOL_BUDGETS } from '../utils/chatToolLoop.js';
import { ToolCallAccumulator } from '../utils/streamingToolCalls.js';
import { chatWebContextService, webSearchAvailable } from '../services/chatWebContext.js';
import { toProviderMessages, looksLikePartsShape } from '../utils/chatMessageParts.js';
import { shapeChatResponse } from '../utils/chatResponseShape.js';
import { searchInfoFromAnnotations } from '../utils/searchInfo.js';
import { openProjectContextTurn, closeProjectContextTurn } from '../utils/projectContextTurn.js';
import { assembleProjectContext } from '../services/chatProjectContext.js';

const router = express.Router();

/**
 * Normalize one upstream call's usage into what the meter settles from.
 *
 * 🔴 `hasOutputUsage: false` is load-bearing and must NOT become a chars/4 estimate: when
 * the provider reported no usage the meter charges the RESERVED worst case, which is the
 * existing rule in `meterPremiumChat`. A character estimate looks more precise and
 * systematically under-bills, because output tokens are rarely 4 chars each.
 */
const usageFrom = (usage, estInputTokens, outputChars) => {
  const hasOutputUsage = usage != null
    && (usage.completion_tokens != null || usage.total_tokens != null);
  return {
    inputTokens: usage?.prompt_tokens ?? estInputTokens,
    outputTokens: usage?.completion_tokens
      ?? (usage?.total_tokens != null
        ? Math.max(0, usage.total_tokens - (usage.prompt_tokens || 0))
        : Math.ceil(outputChars / 4)),
    hasOutputUsage,
  };
};

/**
 * The citation projection sent to the client.
 *
 * Deliberately narrow: title and url only. The fetched page CONTENT stays server-side —
 * it is already in the model's context, and shipping it again would multiply the payload
 * of a 10-search turn for nothing the UI renders.
 */
const projectSources = (sources) => {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const url = typeof s?.url === 'string' ? s.url : '';
    if (!url || seen.has(url)) continue; // one entry per URL across the whole turn
    seen.add(url);
    out.push({ url, title: String(s.title || url).slice(0, 300) });
  }
  return out;
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_MODEL_CATALOG_PATH = path.resolve(__dirname, '../data/localModelCatalog.json');

// ── All inference routes through the XENO API (api.xenostudio.ai) ─────────────
// The platform holds ZERO provider keys and contains NO provider logic. Chat is
// proxied to the private API (xeno-api-proxy), the single key-holder, via its
// OpenAI-compatible POST /v1/chat/completions (XENO_API_KEY, server-to-server).
// Premium is metered LOCALLY as an interim measure until the XENO API's
// platform-credit integration is live. BYOK is owned by the XENO API, not here.
async function callXenoApi(model, messages, temperature, max_tokens, extra = {}, headers = {}) {
  const data = await xenoChatCompletion({ model, messages, temperature, max_tokens, extra, headers });
  const message = data.choices?.[0]?.message || {};
  return {
    success: true,
    content: message.content || '',
    // Preserve tool calls + the raw OpenAI choices so agent clients (the
    // browser extension) can drive a tool-use loop through the metered proxy.
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
    choices: data.choices,
    model: data.model || model,
    provider: 'xeno',
    usage: data.usage,
  };
}

function readLocalModelCatalog() {
  const raw = readFileSync(LOCAL_MODEL_CATALOG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function serializeLocalModelCatalogModel(model) {
  const installSpec = model.installSpec
    ? {
        ...model.installSpec,
        downloadUrl: model.installSpec.artifactKey
          ? generateSignedUrl(model.installSpec.artifactKey, 6 * 60 * 60)
          : null,
      }
    : null;

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    category: model.category,
    description: model.description,
    size: model.size,
    sizeBytes: model.sizeBytes ?? null,
    parameters: model.parameters ?? null,
    tags: Array.isArray(model.tags) ? model.tags : [],
    license: model.license ?? null,
    runtime: model.runtime ?? null,
    installable: Boolean(model.installable && installSpec?.downloadUrl),
    installSpec,
    unavailableReason: model.unavailableReason ?? null,
    // These run on the user's own machine via Hub + xeno-rt → the in-house path.
    path: 'inhouse',
    paths: ['inhouse'],
  };
}

/** In-house path: proxy to a self-hosted xeno-rt OpenAI-compatible server. */
async function callInhouse(baseUrl, model, messages, temperature, max_tokens, extra = {}) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/v1/chat/completions`;
  // 🔴 Through upstreamFetch, not bare fetch. Node's fetch has NO default
  // timeout, so an inference server that accepts the connection and then stops
  // talking held this request forever — and every held request occupies a
  // worker, so one sick provider quietly starved every other one. The bulkhead
  // is the part that actually prevents that; the breaker just stops us queueing
  // behind a target already known to be down.
  //
  // NOT idempotent: a completion may be metered and billed, so a retry could
  // charge twice. Timeouts are generous because inference legitimately is slow.
  const response = await upstreamFetch(url, {
    target: 'xeno-rt',
    timeoutMs: Number(process.env.XENO_RT_TIMEOUT_MS || 120000),
    idempotent: false,
    maxConcurrent: Number(process.env.XENO_RT_MAX_CONCURRENT || 8),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.XENO_RT_API_KEY ? { Authorization: `Bearer ${process.env.XENO_RT_API_KEY}` } : {}),
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens, ...extra }),
  });
  if (!response.ok) {
    throw new Error(`xeno-rt error: ${response.status} - ${await response.text()}`);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message || {};
  return {
    success: true,
    content: message.content || '',
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
    choices: data.choices,
    model,
    provider: 'xeno-rt',
    usage: data.usage,
  };
}

/**
 * POST /api/ai/chat — three-path metered chat.
 *   path='premium' (default): XENO server keys → METERED on credits (hold→settle)
 *   path='byok'   : the user's own key        → never metered
 *   path='inhouse': xeno-rt open/local        → never metered
 * Auth is enforced at the mount (index.js: databaseMiddleware, authMiddleware).
 */
/* canUse: the watch/use boundary. Mounted per-route, NOT on the router, because
   /models and /local-model-catalog below are browsing endpoints — gating the
   whole router would wall off the catalog an unpaid account is meant to be able
   to read, which is the half of the product decision that says "let them look".
   /chat/estimate is deliberately open too: telling somebody what a request WOULD
   cost is how they decide to buy, and it spends nothing to answer. */
router.post('/chat', requireEntitlement('canUse'), async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 4096, path: reqPath, requestId, tools, tool_choice } = req.body;

  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Model and messages are required' });
  }

  // Optional OpenAI tool-use passthrough (additive; older clients omit it).
  // Forwarded verbatim to the upstream OpenAI-compatible API so agent clients
  // get tool_calls back through the metered proxy.
  const toolExtra = Array.isArray(tools) && tools.length
    ? { tools, tool_choice: tool_choice || 'auto' }
    : {};
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const requestedPath = reqPath != null && String(reqPath).trim() !== '' ? normalizePath(reqPath) : null;
  const surface = requestSurface(req);
  const route = resolveRoute(model);

  // Flag off + an explicit byok request keeps today's exact 400. Stored
  // routes are ignored until BYOK_ENABLED=true — fail closed, not silent serve.
  if (requestedPath === 'byok' && !byokEnabled()) {
    return res.status(400).json({
      error: 'byok_unavailable',
      message: 'Bring-your-own-key is managed on your XENO account and is coming soon. Use a premium model for now.',
    });
  }

  let decision;
  if (!byokEnabled()) {
    // Stored routes are ignored while the flag is off. Today's chat path.
    decision = { path: requestedPath || 'premium', mode: 'managed', reason: 'flag-off', credential: null };
  } else {
    try {
      decision = await resolveInferenceRoute(req.db, userId, { surface, requestedPath, model });
    } catch (error) {
      const code = error && error.code;
      if (code === 'byok_disabled') {
        return res.status(400).json({
          error: 'byok_unavailable',
          message: 'Bring-your-own-key is managed on your XENO account and is coming soon. Use a premium model for now.',
        });
      }
      if (code && (String(code).startsWith('byok_') || code === 'inhouse_unavailable')) {
        return res.status(error.http || 409).json({ error: code, message: error.message });
      }
      return res.status(500).json({ error: 'AI generation failed', model });
    }
  }

  const inferencePath = decision.path;

  try {
    // ── BYOK — mint a grant, egress through the gateway, never meter (D4/D5).
    if (inferencePath === 'byok') {
      if (decision.mode === 'local') {
        return res.status(409).json({
          error: 'byok_local_egress',
          message: 'This product is set to call the provider itself. The key never reaches XENO.',
        });
      }
      if (!decision.credential || !decision.credential.id) {
        return res.status(409).json({ error: 'byok_credential_missing', message: 'no key is configured for this product' });
      }
      if (!xenoApiConfigured()) {
        return res.status(503).json({ error: 'Premium inference unavailable', message: 'The inference service is not configured.' });
      }
      const minted = await mintGrant(req.db, userId, {
        surface,
        model,
        credentialId: decision.credential.id,
      });
      const response = await callXenoApi(model, messages, temperature, max_tokens, toolExtra, {
        'X-Xeno-Byok-Grant': minted.grant,
        'X-Xeno-Surface': surface,
      });
      // cost_micro is 0 by construction — recordInferenceUsage refuses any other value.
      await recordInferenceUsage(req.db, userId, {
        surface,
        model,
        provider: decision.credential.provider || 'byok',
        requestId: requestId || req.headers['x-request-id'] || randomUUID(),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        endpoint: '/api/ai/chat',
      }).catch(() => {});
      return res.json({ ...response, path: 'byok', metered: false, cost_micro: 0 });
    }

    // ── IN-HOUSE (xeno-rt) ──────────────────────────────────────────────────
    if (inferencePath === 'inhouse') {
      const baseUrl = process.env.XENO_RT_BASE_URL;
      if (!baseUrl) {
        return res.status(400).json({
          error: 'inhouse_unavailable',
          message: 'In-house models run locally via XENO Hub today. Server-side xeno-rt is not yet available — use a premium model or your own key.',
        });
      }
      // Enforce the plan's in-house daily cap (free = 50/day; pro/team = unlimited).
      // Checked AFTER the availability guard so a 400-ing request never burns quota;
      // fails OPEN (loudly) if the counter infrastructure errors.
      const capVerdict = await enforceInHouseDailyLimit(req.db, userId);
      if (!capVerdict.allowed) return res.status(429).json(limitExceededBody(capVerdict));
      const response = await callInhouse(baseUrl, route.premium.providerModel, messages, temperature, max_tokens, toolExtra);
      return res.json({ ...response, path: 'inhouse', metered: false });
    }

    // ── PREMIUM (metered, routed through the private API) ────────────────────
    if (!xenoApiConfigured()) {
      return res.status(503).json({ error: 'Premium inference unavailable', message: 'The inference service is not configured.' });
    }
    // Idempotency seed: a client-supplied requestId makes a retry a no-op; otherwise
    // a fresh UUID so two distinct concurrent requests never collide (Date.now() would).
    const reqIdSeed = requestId || req.headers['x-request-id'] || randomUUID();
    const estInputTokens = estimateMessageTokens(messages);

    const metered = await meterPremiumChat(req.db, userId, {
      model, provider: 'xeno', requestId: reqIdSeed,
      estInputTokens, maxTokens: max_tokens, surface,
      run: () => callXenoApi(model, messages, temperature, max_tokens, toolExtra, {
        'X-Xeno-Surface': surface,
      }),
    });

    return res.json({
      ...metered.result,
      path: 'premium',
      metered: true,
      credits_charged: metered.creditsCharged,
      cost_micro: metered.costMicro,
    });
  } catch (error) {
    if (error.code === 'QUOTA_EXCEEDED') return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: error.message, resetsAt: error.resetsAt });
    if (error.http === 402) {
      const bal = await getBalanceV2(req.db, userId).catch(() => null);
      return res.status(402).json({
        error: 'Insufficient credits',
        message: 'Top up credits to use premium models, or switch to your own key (BYOK) or an in-house model.',
        balance: bal ? bal.availableMicro / MICRO_PER_CREDIT : undefined,
      });
    }
    if (error.http === 403) return res.status(403).json({ error: 'Account frozen' });
    if (error.http === 503) return res.status(503).json({ error: 'Premium inference unavailable', message: 'The inference service is not configured.' });
    console.error(`[AI Chat] Error (path=${inferencePath}, model=${model}):`, error.message);
    // The caller's own mistake (unknown model, bad request) keeps its status and the
    // provider's sentence; only a genuinely unexplained failure is a 500.
    const upstream = classifyUpstreamError(error);
    if (upstream) return res.status(upstream.status).json({ ...upstream.body, model });
    return res.status(500).json({ error: 'AI generation failed', model });
  }
});

/**
 * POST /api/ai/chat/stream — token-streaming premium chat, WITH TOOLS (SSE).
 *
 * Same auth + db middleware + rate limit + premium metering as POST /api/ai/chat,
 * but relays upstream OpenAI SSE chunks to the client as normalized events:
 *   {"type":"delta","text":...}                       ← choices[].delta.content
 *   {"type":"reasoning","text":...}                    ← delta.reasoning / reasoning_content
 *   {"type":"usage","input","output","total","creditsSettled"}  ← summed over all calls
 *   {"type":"done"}  then the OpenAI-compatible  data: [DONE]  sentinel
 *   {"type":"error","error":<code>,"message":...}      ← inference_error mid-stream
 *
 * ── Tool events (only on a surface with a search budget) ───────────────────────────────
 *   {"type":"search_start","query","iteration"}        ← the query, BEFORE the wait
 *   {"type":"search_result","query","count","sources"} ← what came back
 *   {"type":"search_error","query","code","message"}   ← reported, never fatal
 *   {"type":"sources","sources":[{url,title}]}         ← deduped citations for the turn
 *   {"type":"tool_use","searches","iterations","cappedOut"}
 *
 * This mirrors what Anthropic, OpenAI and Gemini all do (verified 2026-09-14): the search
 * runs inside ONE streamed response, and its phases are typed events in the same stream as
 * the text. The shared invariant is that a search is a phase transition the user can SEE —
 * query before results, results before prose — not a silent pause the client must guess at.
 *
 * 🔴 METERING A MULTI-CALL TURN. A tool turn makes up to `maxSearches + 1` upstream calls
 * and each is separately billable, so there is ONE HOLD PER CALL, keyed by the same
 * deterministic `${seed}:${n}` the loop derives its requestId from (holds are idempotent on
 * that id, so a retried turn re-uses them instead of charging twice). A single hold cannot
 * pay for eleven calls: `settle` clamps to its own hold, so the excess would be absorbed
 * silently — an under-bill with nothing to show it. Every hold resolves on every exit path.
 *
 * byok/inhouse are 501 for now.
 *
 * ✅ WIRED 2026-09-14. `ChatWithLLM.tsx` routes every chat turn here; `task: 'image'` and
 * `refine_image_prompt` stay on `/api/chat/generate` because they are not chat turns — the
 * image task writes a file, registers a library item and logs credits before the chat path
 * runs at all, and returns fields (`libraryItemId`, `libraryContentUrl`,
 * `refinedPromptText`) a chat turn cannot produce.
 *
 * 🔴 Getting here took six extractions, because the blocker was never the client. This
 * route forwarded `messages` upstream untouched while the chat client sends its own
 * `{ role, parts[] }` shape with images, PDFs and text attachments — adopting it earlier
 * would have SILENTLY DROPPED every attachment, with a plausible answer still coming back
 * about a picture the model never saw. Each of these lived only in the other route, and
 * each fails QUIETLY when absent:
 *
 *   chatMessageParts     attachments survive — without it every image and PDF is dropped
 *   imageReferral        "make that one bigger" still sees the picture it refers to
 *   chatResponseShape    answer/thinking/reasoningProcessed/modelIdUsed
 *   searchInfo           citations, instead of an answer that reads as unsourced
 *   projectContextTurn   project grounding AND its audit record
 *   autoImageFallback    a picture instead of a blank reply when asked to draw
 *
 * They are EXTRACTED, not copied: two implementations of any of them would disagree
 * invisibly, since both still return an answer.
 *
 * ⚠️ `scripts/chat-stream-reachable.test.mjs` now fails if this route loses its consumer
 * while claiming to have one, and failed correctly the moment the consumer landed. Its
 * detector had to learn that a route can be called through a CONSTANT, not only a string
 * literal — it saw no consumer here at first, which is how a reachability check comes to
 * measure coding style instead of reachability.
 */
router.post('/chat/stream', requireEntitlement('canUse'), async (req, res) => {
  const {
    model, messages, reasoning, conversationId, systemPrompt, projectId,
    /*
     * 🔴 NO DEFAULT TEMPERATURE. Sending one broke every Claude Opus 5 turn in production:
     *
     *   400 "Claude Opus 5 does not support temperature. Remove temperature, top_p, top_k."
     *
     * A plain "hello" failed with "The inference stream failed." — the default of 0.7 was
     * applied to a model that rejects sampling parameters outright. `/api/chat/generate`
     * never had this because it sends NO temperature at all, so the defect arrived with this
     * route and only for the models that refuse it.
     *
     * ⚠️ `undefined` is the correct value here, not a number. It must be OMITTED from the
     * upstream body rather than sent as any value, which is why the payload below builds the
     * field conditionally. A "safe" default is still a value, and a model that refuses the
     * parameter refuses every value of it.
     */
    path: reqPath, requestId, temperature, max_tokens = 4096,
  } = req.body || {};

  // ── Pre-stream validation → normal HTTP errors (we have not switched to SSE yet).
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'Model and a non-empty messages array are required.' });
  }
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' });

  const requestedPath = reqPath != null && String(reqPath).trim() !== '' ? normalizePath(reqPath) : null;
  const surface = requestSurface(req);

  if (requestedPath === 'byok' && !byokEnabled()) {
    return res.status(400).json({
      error: 'byok_unavailable',
      message: 'Bring-your-own-key is managed on your XENO account and is coming soon. Use a premium model for now.',
    });
  }

  let streamDecision;
  if (!byokEnabled()) {
    streamDecision = { path: requestedPath || 'premium' };
  } else {
    try {
      streamDecision = await resolveInferenceRoute(req.db, userId, { surface, requestedPath, model });
    } catch (error) {
      const code = error && error.code;
      if (code === 'byok_disabled') {
        return res.status(400).json({
          error: 'byok_unavailable',
          message: 'Bring-your-own-key is managed on your XENO account and is coming soon. Use a premium model for now.',
        });
      }
      if (code && (String(code).startsWith('byok_') || code === 'inhouse_unavailable')) {
        return res.status(error.http || 409).json({ error: code, message: error.message });
      }
      return res.status(500).json({ error: 'inference_error', message: 'AI generation failed' });
    }
  }

  if (streamDecision.path !== 'premium') {
    if (streamDecision.path === 'byok' && streamDecision.mode === 'local') {
      return res.status(409).json({
        error: 'byok_local_egress',
        message: 'This product is set to call the provider itself. The key never reaches XENO.',
      });
    }
    // Streaming BYOK is not implemented — refuse, do not bill (spec D5).
    return res.status(501).json({
      error: 'invalid_request',
      message: 'Streaming currently supports the premium path only. Use POST /api/ai/chat for byok/inhouse.',
    });
  }
  if (!xenoApiConfigured()) {
    return res.status(503).json({ error: 'inference_error', message: 'The inference service is not configured.' });
  }

  /*
   * ── Project context ──────────────────────────────────────────────────────────────────
   *
   * A project-backed conversation grounds its answer in the project's own documents, and
   * RECORDS which sources were in context. Without this a project question is answered from
   * the model's own knowledge — no sources, no audit record, confidently wrong, and nothing
   * in the trail to show it happened.
   *
   * 🔴 Gate on `projectId` ALONE, and refuse a project with no conversation. That is not
   * taste: `chat_generation_contexts.conversation_id` is NOT NULL, so a project turn has
   * nowhere to record itself without one. The same guard exists on /api/chat/generate, where
   * getting it wrong as `(projectId || conversationId)` once refused EVERY ordinary saved
   * chat — an OR to enter and an AND to stay.
   *
   * ⚠️ This runs BEFORE the messages are built, because it augments the system prompt, and
   * before any SSE frame is written, because it can still answer with a normal status.
   */
  let projectContext = null;
  let projectContextRecordId = null;
  let projectContextRequestHash = null;
  if (projectId) {
    if (!conversationId) {
      return res.status(400).json({ error: 'Project generation requires projectId and conversationId.' });
    }
    try {
      const opened = await openProjectContextTurn({
        db: req.db,
        userId,
        projectId,
        conversationId,
        messages,
        selectedModelId: model,
        assemble: assembleProjectContext,
      });
      projectContext = opened.context;
      projectContextRecordId = opened.recordId;
      projectContextRequestHash = opened.requestHash;
    } catch (contextError) {
      const status = contextError.status || (contextError.code === 'invalid_id' ? 400 : 404);
      return res.status(status).json({
        error: contextError.message,
        code: contextError.code || 'project_context_failed',
      });
    }
  }

  /** The project's instructions ride on the system prompt, exactly as on the other route. */
  const effectiveSystemPrompt = projectContext
    ? [systemPrompt, projectContext.instructions].filter(Boolean).join('\n\n')
    : systemPrompt;

  /*
   * Accept BOTH message shapes.
   *
   * 🔴 This is what made the route unusable by the product. The XENO chat client sends its
   * own `{ role, parts[] }` shape carrying images, PDFs and text attachments; this route
   * forwarded `messages` straight upstream, so pointing the client at it would have silently
   * DROPPED every attachment — not failed, dropped, with a plausible answer still coming
   * back about a picture the model never saw.
   *
   * `toProviderMessages` is the same implementation `/api/chat/generate` uses (extracted,
   * not copied — two copies of this conversion would disagree invisibly). API clients that
   * already send OpenAI-shaped messages are untouched: `looksLikePartsShape` only converts
   * when at least one message actually carries `parts`.
   */
  const finalMessages = looksLikePartsShape(messages)
    ? toProviderMessages(messages, { systemPrompt: effectiveSystemPrompt })
    : (effectiveSystemPrompt
      ? [{ role: 'system', content: effectiveSystemPrompt }, ...messages]
      : messages);

  const reqIdSeed = requestId || req.headers['x-request-id'] || randomUUID();
  const estInputTokens = estimateMessageTokens(finalMessages);

  /*
   * Which surface this turn is, and therefore whether a web_search tool is offered.
   *
   * Same rule as /api/chat/generate: a NAMED mode with no budget keeps its own name and
   * gets no tool, so `code` and `agents` are never handed a tool their capability
   * statement denies. Only an ABSENT field falls back to 'chat'.
   */
  const requestedSurface = typeof req.body?.chatSurface === 'string' ? req.body.chatSurface.trim() : '';
  const chatSurface = requestedSurface || 'chat';
  const toolSurface = Object.hasOwn(TOOL_BUDGETS, chatSurface) && webSearchAvailable()
    ? chatSurface
    : null;

  // ── Phase 1 — hold worst-case BEFORE opening the stream, so an over-budget wallet
  // gets a clean 402 (not a half-open SSE). 403 = frozen; anything else = 500.
  //
  // 🔴 The requestId is `${seed}:0` — the id the LOOP will ask for on its first call, so
  // this pre-placed hold is the one it picks up rather than a second, orphaned reserve.
  let meter;
  try {
    meter = await meterPremiumChatStream(req.db, userId, {
      model, provider: 'xeno', requestId: `${reqIdSeed}:0`,
      estInputTokens, maxTokens: max_tokens, surface: requestSurface(req),
    });
  } catch (error) {
    if (error.code === 'QUOTA_EXCEEDED') return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: error.message, resetsAt: error.resetsAt });
    if (error.http === 402) {
      const bal = await getBalanceV2(req.db, userId).catch(() => null);
      return res.status(402).json({
        error: 'insufficient_credits',
        message: 'Top up credits to use premium models, or switch to your own key (BYOK) or an in-house model.',
        balance: bal ? bal.availableMicro / MICRO_PER_CREDIT : undefined,
      });
    }
    if (error.http === 403) return res.status(403).json({ error: 'inference_error', message: 'Account frozen' });
    return res.status(500).json({ error: 'inference_error', message: 'Metering failed' });
  }

  // ── Switch to SSE. From here EVERY failure is an in-stream error event, and the
  // hold MUST be resolved (settle/void) on every exit path.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Back-pressure–aware SSE writer. If res.write() returns false the socket buffer
  // is full; pause until it drains rather than buffering the entire completion in
  // the socket (a slow client + fast upstream = unbounded memory). The drain wait is
  // RACED against the client leaving/erroring so a vanished client never hangs the
  // relay loop. `send` is async and awaited in the relay so a full client buffer
  // pauses upstreamReader.read().
  const send = async (obj) => {
    if (res.writableEnded) return;
    const ok = res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (ok !== false) return;
    await new Promise((resolve) => {
      const done = () => {
        res.removeListener('drain', done);
        res.removeListener('error', done);
        req.removeListener('close', done);
        resolve();
      };
      res.once('drain', done);
      res.once('error', done);
      req.once('close', done);
    });
  };
  const endStream = () => {
    if (res.writableEnded) return;
    res.write('data: [DONE]\n\n');
    res.end();
  };

  let outputChars = 0;   // for a best-effort output-token estimate if usage never arrives
  let usageObj = null;   // upstream usage chunk (include_usage)
  let clientGone = false;
  let upstreamReader = null;
  const upstreamAbort = new AbortController(); // cancels the underlying fetch on disconnect

  /*
   * ── Metering a MULTI-CALL turn ──────────────────────────────────────────────────────
   *
   * A tool turn is not one upstream call, it is up to `maxSearches + 1` of them, and each
   * is separately billable. `meterPremiumChatStream` settles CLAMPED TO ITS OWN HOLD, so
   * one hold sized for a single call cannot pay for eleven — the excess would be silently
   * absorbed, which is an under-bill, not an error anyone would see.
   *
   * So: one hold per iteration, keyed by the SAME deterministic `${seed}:${n}` the loop
   * already mints for `requestId`. Holds are idempotent on that id, so a retried turn
   * re-uses its holds instead of charging twice.
   *
   * 🔴 EVERY hold must resolve on EVERY exit path — normal end, client disconnect,
   * upstream error, search failure. `meters` is the list; `resolveAllMeters` walks it, and
   * each controller is single-shot so a double call is a no-op rather than a double-settle.
   */
  const meters = [meter];
  const meterFor = async (iteration) => {
    if (iteration < meters.length) return meters[iteration];
    const next = await meterPremiumChatStream(req.db, userId, {
      model, provider: 'xeno', requestId: `${reqIdSeed}:${iteration}`,
      estInputTokens, maxTokens: max_tokens, surface: requestSurface(req),
    });
    meters.push(next);
    return next;
  };

  /** Settle every open hold from what that call actually used, or void it if it did nothing. */
  const resolveAllMeters = async (perCallUsage) => {
    let creditsCharged = 0;
    for (let i = 0; i < meters.length; i += 1) {
      const m = meters[i];
      if (m.settled) continue;
      const used = perCallUsage?.[i];
      if (used && (used.outputTokens > 0 || used.inputTokens > 0)) {
        const res = await m.settle({
          inputTokens: used.inputTokens,
          outputTokens: used.outputTokens,
          hasOutputUsage: used.hasOutputUsage !== false,
        }).catch(() => null);
        creditsCharged += res?.creditsCharged ?? 0;
      } else {
        // No usage recorded for this call: it never ran, or produced nothing. Void rather
        // than charge the reserved worst case for work that did not happen.
        await m.voidHold().catch(() => {});
      }
    }
    return creditsCharged;
  };

  /** Usage per upstream call, index-aligned with `meters`. */
  const callUsage = [];

  // Resolve the credit hold best-effort: charge from tokens seen so far, or void the
  // reserve if nothing usable streamed. Single-shot via meter.settled (never double-
  // settles). Shared by the disconnect handlers, the in-band error path (B1) and the
  // mid-stream catch so every abnormal exit resolves the hold identically.
  const settleBestEffort = async () => {
    /*
     * ⚠️ Walks EVERY hold, not just the first.
     *
     * On a tool turn there may be several open reserves, and an abnormal exit must not
     * leave the later ones hanging — they would lock the user's balance until the 120s
     * expiry with nothing charged. Calls with recorded usage settle from it; the
     * in-flight one settles from the chars seen so far; anything untouched is voided.
     */
    const best = meters.map((_, i) => {
      const recorded = callUsage[i];
      if (recorded) return recorded;
      // The call that was still streaming when the client left: charge what it produced.
      if (i === meters.length - 1 && outputChars > 0) {
        return {
          inputTokens: usageObj?.prompt_tokens ?? estInputTokens,
          outputTokens: usageObj?.completion_tokens ?? Math.ceil(outputChars / 4),
        };
      }
      return null;
    });
    await resolveAllMeters(best);
  };

  // Client disconnect OR response-socket error: abort upstream and resolve the hold.
  // Both funnel here so the reserve is never left open (res 'error' mirrors req 'close').
  const resolveOnDisconnect = () => {
    if (res.writableEnded) return; // normal completion already closed the response
    clientGone = true;
    try { upstreamAbort.abort(); } catch { /* noop */ }
    try { upstreamReader?.cancel?.(); } catch { /* noop */ }
    settleBestEffort().catch(() => {});
  };
  req.on('close', resolveOnDisconnect);
  res.on('error', resolveOnDisconnect);

  /*
   * ── One upstream streamed call, as an async generator ────────────────────────────────
   *
   * Extracted from the old inline relay so the SAME parser serves both the plain path and
   * each iteration of the tool loop. Yields normalized events:
   *
   *   { type:'delta', text }            assistant prose
   *   { type:'reasoning', text }        thinking, when the provider streams it
   *   { type:'tool_calls', toolCalls }  emitted ONCE at the end, fully assembled
   *   { type:'usage', usage }           the final include_usage chunk
   *
   * 🔴 Tool calls arrive as FRAGMENTS and are accumulated by index (see
   * utils/streamingToolCalls.js) — never parsed mid-stream, because a half-arrived
   * arguments string is not malformed, it is incomplete.
   */
  async function* streamOneCall({ messages: callMessages, tools, signal }) {
    const response = await xenoChatCompletionStream({
      model,
      messages: callMessages,
      temperature,
      max_tokens,
      signal,
      extra: {
        // OpenRouter-style reasoning hint (the live catalog is OpenRouter-fronted);
        // the gateway streams thinking back as delta.reasoning when supported.
        ...(reasoning ? { reasoning: { effort: 'medium' } } : {}),
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Upstream stream has no readable body');
    upstreamReader = reader;

    const decoder = new TextDecoder();
    const calls = new ToolCallAccumulator();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done || clientGone) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue; // upstream sentinel; we emit our own
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        /*
         * In-band provider error: a valid-JSON `data: {"error":…}` line with no choices,
         * after which the stream closes NORMALLY. Checked first, before usage/delta, so an
         * error line is never mistaken for content — without it we would fall through the
         * normal exit and SETTLE a truncated generation as a success.
         */
        if (chunk.error) {
          const err = new Error('inference_error');
          err.inBand = true;
          throw err;
        }

        if (chunk.usage) yield { type: 'usage', usage: chunk.usage };

        const delta = chunk.choices?.[0]?.delta || {};
        if (Array.isArray(delta.tool_calls)) calls.push(delta.tool_calls);
        if (typeof delta.content === 'string' && delta.content.length) {
          yield { type: 'delta', text: delta.content };
        }
        const reasoningText = delta.reasoning ?? delta.reasoning_content;
        if (typeof reasoningText === 'string' && reasoningText.length) {
          yield { type: 'reasoning', text: reasoningText };
        }
      }
    }

    // Assembled only once the stream is closed — this is the point where fragments
    // become a value, and the only place arguments are read.
    if (calls.sawAny) yield { type: 'tool_calls', toolCalls: calls.finish() };
  }

  /*
   * ── Drive the turn ───────────────────────────────────────────────────────────────────
   *
   * Two branches over ONE parser. Without a tool surface this is the plain relay it always
   * was: exactly one upstream call, one hold, unchanged. With a tool surface the loop may
   * make several calls, and the search phases become visible events in the same stream —
   * the shape Anthropic, OpenAI and Gemini all converged on.
   */
  const sourcesSeen = [];
  let sawSearch = false;
  /*
   * The full answer, accumulated for the terminal `result` frame.
   *
   * ⚠️ The deltas are what the user WATCHES; this is what the client STORES. They must be
   * built from the same bytes — accumulating here rather than asking the client to stitch
   * deltas means a dropped frame cannot truncate the saved message.
   */
  let assembledText = '';
  let assembledAnnotations = null;

  try {
    if (!toolSurface) {
      for await (const event of streamOneCall({
        messages: finalMessages, tools: [], signal: upstreamAbort.signal,
      })) {
        if (clientGone) break;
        if (event.type === 'delta') {
          outputChars += event.text.length;
          assembledText += event.text;
          await send({ type: 'delta', text: event.text });
        } else if (event.type === 'reasoning') {
          await send({ type: 'reasoning', text: event.text });
        } else if (event.type === 'usage') {
          usageObj = event.usage;
        }
      }
      callUsage[0] = usageFrom(usageObj, estInputTokens, outputChars);
    } else {
      /*
       * 🔴 `iteration` tracks which upstream call we are on, so each gets its OWN hold at
       * the id the loop derives. The generator below is what the loop calls to run a turn;
       * it places the hold BEFORE the call and records that call's usage after it, keeping
       * `meters` and `callUsage` index-aligned.
       */
      let iteration = 0;
      const streamModel = async function* streamModelCall({ messages: loopMessages, tools }) {
        const index = iteration;
        await meterFor(index);
        let callOutputChars = 0;
        let callUsageObj = null;
        try {
          for await (const event of streamOneCall({
            messages: loopMessages, tools, signal: upstreamAbort.signal,
          })) {
            if (event.type === 'delta') callOutputChars += event.text.length;
            else if (event.type === 'usage') callUsageObj = event.usage;
            yield event;
          }
        } finally {
          // `finally`, so a throw mid-call still records what that call produced — the
          // settle path needs it whether the call ended well or badly.
          callUsage[index] = usageFrom(callUsageObj, estInputTokens, callOutputChars);
          iteration += 1;
        }
      };

      for await (const event of streamToolLoop({
        messages: finalMessages,
        surface: toolSurface,
        turnId: reqIdSeed,
        streamModel,
        runSearch: ({ query, depth }) => chatWebContextService.searchAndFetch({
          actorId: userId,
          conversationId: conversationId || null,
          userMessageId: null,
          // Per-turn: two turns asking the same question are two requests, not one.
          turnId: reqIdSeed,
          query,
          count: 6,
          depth,
          signal: upstreamAbort.signal,
        }),
      })) {
        if (clientGone) break;
        switch (event.type) {
          case 'delta':
            outputChars += event.text.length;
            assembledText += event.text;
            await send({ type: 'delta', text: event.text });
            break;
          case 'reasoning':
            await send({ type: 'reasoning', text: event.text });
            break;
          case 'search_start':
            sawSearch = true;
            // The query, BEFORE the wait — this is what turns a silent pause into a
            // visible one, and the reason the loop streams at all.
            await send({ type: 'search_start', query: event.query, iteration: event.iteration });
            break;
          case 'search_result':
            sourcesSeen.push(...event.sources);
            await send({
              type: 'search_result',
              query: event.query,
              count: event.count,
              sources: event.sources,
            });
            break;
          case 'search_error':
            // A failed search is REPORTED, never silent, and never fatal: the model gets
            // the failure as a tool result and can say so truthfully in its answer.
            //
            // 🔴 And it is logged HERE, with the code. Until 2026-09-14 the client got the
            // code and the server kept nothing, so an entire turn of rate-limited searches
            // left no trace on the box — the third silent catch found in one day. The query
            // is user content and is deliberately not logged.
            console.warn('[chat/stream] search failed', {
              requestId: reqIdSeed, iteration: event.iteration, code: event.code,
            });
            await send({
              type: 'search_error',
              query: event.query,
              code: event.code,
              message: 'That search could not be completed.',
            });
            break;
          case 'usage':
            usageObj = addUsage(usageObj, event.usage);
            break;
          case 'complete':
            if (event.sources.length) {
              await send({ type: 'sources', sources: projectSources(event.sources) });
            }
            await send({
              type: 'tool_use',
              searches: event.searches,
              iterations: event.iterations,
              cappedOut: event.cappedOut,
            });
            break;
          default:
            break;
        }
      }
    }
  } catch (error) {
    /*
     * Upstream errored mid-stream, in band or otherwise. Resolve EVERY hold best-effort,
     * then emit a GENERIC error — never the provider's own message, which can carry
     * upstream detail we do not forward.
     */
    await settleBestEffort().catch(() => {});
    /*
     * 🔴 LOG THE REASON. This was `void error` — discarded — and it cost a live diagnosis.
     *
     * Every Claude Opus 5 turn was failing with "The inference stream failed." and the
     * server logs said NOTHING, because the upstream's actual message ("Claude Opus 5 does
     * not support temperature") was thrown away right here. The cause had to be found by
     * reproducing the call by hand inside the container.
     *
     * ⚠️ The CLIENT still gets the generic message — an upstream error can carry provider
     * detail we do not forward. But swallowing it on the server too leaves nobody able to
     * see what broke. Generic outward, specific inward.
     */
    console.error('[chat/stream] upstream failed', {
      model,
      status: error?.status,
      inBand: Boolean(error?.inBand),
      message: error?.message,
    });
    if (!clientGone) {
      const upstream = classifyUpstreamError(error);
      await send(upstream
        ? { type: 'error', error: upstream.body.error, message: upstream.body.message, status: upstream.status }
        : { type: 'error', error: 'inference_error', message: 'The inference stream failed.' });
      endStream();
    }
    return;
  }

  // Client vanished mid-stream — the disconnect handler owns metering; nothing to emit.
  if (clientGone) return;

  /*
   * ── Normal completion — settle EVERY call from its own real usage.
   *
   * One hold per upstream call, each settled against what THAT call used. A single settle
   * would be clamped to a single call's hold, so an 11-call tool turn would silently bill
   * as one — the excess absorbed with nothing to show it. `resolveAllMeters` also voids
   * any hold whose call never produced anything.
   *
   * `usageFrom` keeps the existing rule intact: no usage chunk means charge the RESERVED
   * worst case (`hasOutputUsage: false`, clamped) rather than a chars/4 estimate that
   * under-bills. The char estimate stays best-effort, for the disconnect path only.
   */
  const creditsSettled = await resolveAllMeters(callUsage);

  const totalInput = callUsage.reduce((n, u) => n + (u?.inputTokens || 0), 0) || estInputTokens;
  const totalOutput = callUsage.reduce((n, u) => n + (u?.outputTokens || 0), 0);

  await send({
    type: 'usage',
    input: totalInput,
    output: totalOutput,
    total: totalInput + totalOutput,
    creditsSettled,
    // Present only on a turn that actually searched, so an ordinary chat is unchanged.
    ...(sawSearch ? { upstreamCalls: meters.length } : {}),
  });

  /*
   * ── The chat response fields ─────────────────────────────────────────────────────────
   *
   * 🔴 THIS IS WHAT MADE THE ROUTE UNUSABLE BY THE PRODUCT. Measured 2026-09-14: the chat
   * client reads 13 fields off a turn and this route produced 5, so adopting it meant losing
   * reasoning display, thinking panes, citations and model attribution — silently, since the
   * answer still arrived.
   *
   * Every one now comes from the SAME module `/api/chat/generate` uses. Extracted rather than
   * copied: two implementations of these rules would disagree invisibly, because both still
   * return an answer. A client can read this frame exactly as it reads that route's JSON.
   *
   * ⚠️ Sent as a terminal frame beside the deltas, not instead of them. The deltas are what
   * the user watches; this is the record the client stores.
   */
  /*
   * Close the audit record with a hash of the answer.
   *
   * 🔴 A failure here must NOT fail the turn. The answer has been generated, streamed and
   * BILLED; throwing now would hand the user an error for a turn they already received and
   * paid for. The row simply stays open — which is honest information (a turn that started
   * and did not finish recording), and is exactly why the close is a separate UPDATE rather
   * than part of one write at the end.
   */
  if (projectContextRecordId) {
    await closeProjectContextTurn({
      db: req.db,
      recordId: projectContextRecordId,
      requestHash: projectContextRequestHash,
      responseText: assembledText,
    }).catch((error) => {
      console.error('[chat/stream] project context close failed', {
        recordId: projectContextRecordId,
        message: error?.message,
      });
    });
  }

  const shaped = shapeChatResponse({
    data: { choices: [{ message: { content: assembledText } }] },
    outputText: assembledText,
    selectedModelId: model,
    effectiveReasoningState: Boolean(reasoning),
  });

  // Citations, when the provider grounded the answer. Absent rather than empty — an empty
  // shell renders as a sources header with nothing under it.
  const annotationSearchInfo = searchInfoFromAnnotations({
    choices: [{ message: { annotations: assembledAnnotations } }],
  });

  await send({
    type: 'result',
    ...shaped,
    ...(annotationSearchInfo ? { searchInfo: annotationSearchInfo } : {}),
    // The tool loop's own sources, which are a different thing from provider annotations:
    // these are pages XENO fetched, not pages the model cited.
    ...(sourcesSeen.length ? { toolSources: projectSources(sourcesSeen) } : {}),
    // Project grounding: the record id lets a client link an answer back to the exact
    // sources that were in context when it was produced.
    ...(projectContextRecordId ? { projectContextId: projectContextRecordId } : {}),
    ...(projectContext ? { projectSources: projectContext.manifest.sources } : {}),
    usage: { prompt_tokens: totalInput, completion_tokens: totalOutput, total_tokens: totalInput + totalOutput },
  });
  await send({ type: 'done' });
  endStream();
});

/**
 * POST /api/ai/chat/estimate — pre-generation cost preview (the "cost shown before
 * it runs" trust rule). Returns the WORST-CASE premium credit cost; byok/inhouse = 0.
 */
router.post('/chat/estimate', async (req, res) => {
  const { model, messages = [], max_tokens = 4096, path: reqPath } = req.body;
  if (!model) return res.status(400).json({ error: 'Model is required' });

  const inferencePath = normalizePath(reqPath);
  if (inferencePath !== 'premium') {
    return res.json({ path: inferencePath, metered: false, credits_estimate: 0 });
  }
  const estInputTokens = estimateMessageTokens(messages);
  const micro = estimateChatCostMicro(model, { inputTokens: estInputTokens, maxOutputTokens: max_tokens });
  return res.json({
    path: 'premium',
    metered: true,
    worst_case: true,
    cost_micro: micro,
    credits_estimate: micro / MICRO_PER_CREDIT,
  });
});

/**
 * GET /api/ai/models — static fallback list (the live catalog is GET /api/models).
 * Kept for back-compat; tagged with inference paths for the 3-path UI.
 */
router.get('/models', (req, res) => {
  const raw = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', description: 'Most capable OpenAI model', icon: '🟢' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', description: 'Fast and affordable', icon: '🟢' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', description: 'Best for analysis and coding', icon: '🟠' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic', description: 'Most powerful Claude', icon: '🟠' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', description: 'Long context, multimodal', icon: '🔵' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', description: 'Fast and efficient', icon: '🔵' },
    { id: 'llama-3.1-70b', name: 'Llama 3.1 70B', provider: 'Meta', description: 'Open source, powerful', icon: '🟣' },
    { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', description: 'Advanced reasoning', icon: '🔴' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'DeepSeek', description: 'Reasoning model', icon: '🔴' },
    { id: 'mistral-large', name: 'Mistral Large', provider: 'Mistral', description: 'European excellence', icon: '⚪' },
  ];
  const models = raw.map((m) => ({ ...m, ...catalogPaths(m.id) }));
  res.json({ success: true, models });
});

/**
 * GET /api/ai/local-model-catalog
 * Returns the production local model catalog that Hub should render.
 */
router.get('/local-model-catalog', (req, res) => {
  const catalog = readLocalModelCatalog();
  const models = Array.isArray(catalog.models)
    ? catalog.models.map(serializeLocalModelCatalogModel)
    : [];

  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
  res.json({
    success: true,
    source: 'platform',
    schemaVersion: catalog.schemaVersion ?? 1,
    catalogVersion: catalog.catalogVersion ?? 'unknown',
    updatedAt: catalog.updatedAt ?? null,
    models,
  });
});

export default router;

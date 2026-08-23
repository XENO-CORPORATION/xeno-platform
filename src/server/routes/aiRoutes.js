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
import { xenoChatCompletion, xenoChatCompletionStream, xenoApiConfigured } from '../utils/xenoChat.js';
import { enforceInHouseDailyLimit, limitExceededBody } from '../middleware/inHouseDailyLimit.js';
import requireEntitlement from '../middleware/requireEntitlement.js';
import { byokEnabled, resolveInferenceRoute } from '../services/providerCredentials.js';
import { mintGrant } from '../services/inferenceGrants.js';
import { requestSurface } from '../utils/requestSurface.js';
import { recordInferenceUsage } from '../utils/recordInferenceUsage.js';

const router = express.Router();
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
  const response = await fetch(url, {
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
      decision = await resolveInferenceRoute(req.db, userId, { surface, requestedPath });
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
    return res.status(500).json({ error: 'AI generation failed', model });
  }
});

/**
 * POST /api/ai/chat/stream — token-streaming premium chat (SSE).
 *
 * Same auth + db middleware + rate limit + premium metering as POST /api/ai/chat,
 * but relays upstream OpenAI SSE chunks to the client as normalized events:
 *   {"type":"delta","text":...}                       ← choices[].delta.content
 *   {"type":"reasoning","text":...}                    ← delta.reasoning / reasoning_content
 *   {"type":"usage","input","output","total","creditsSettled"}  ← final usage chunk
 *   {"type":"done"}  then the OpenAI-compatible  data: [DONE]  sentinel
 *   {"type":"error","error":<code>,"message":...}      ← inference_error mid-stream
 *
 * Metering: hold worst-case BEFORE the stream (402 pre-stream if it fails), settle
 * the hold clamped to real usage on the upstream usage chunk, and — on client
 * disconnect or a mid-stream upstream error — settle best-effort from tokens seen
 * so far OR void the hold. The hold is never left open and never double-settled
 * (meterPremiumChatStream's single-shot controller). byok/inhouse are 501 for now.
 */
router.post('/chat/stream', requireEntitlement('canUse'), async (req, res) => {
  const {
    model, messages, reasoning, conversationId, systemPrompt,
    path: reqPath, requestId, temperature = 0.7, max_tokens = 4096,
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
      streamDecision = await resolveInferenceRoute(req.db, userId, { surface, requestedPath });
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

  // conversationId is accepted for client bookkeeping/telemetry; the gateway is stateless.
  void conversationId;
  const finalMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const reqIdSeed = requestId || req.headers['x-request-id'] || randomUUID();
  const estInputTokens = estimateMessageTokens(finalMessages);

  // ── Phase 1 — hold worst-case BEFORE opening the stream, so an over-budget wallet
  // gets a clean 402 (not a half-open SSE). 403 = frozen; anything else = 500.
  let meter;
  try {
    meter = await meterPremiumChatStream(req.db, userId, {
      model, provider: 'xeno', requestId: reqIdSeed,
      estInputTokens, maxTokens: max_tokens, surface: requestSurface(req),
    });
  } catch (error) {
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
  let upstream = null;
  let upstreamReader = null;
  const upstreamAbort = new AbortController(); // cancels the underlying fetch on disconnect

  // Resolve the credit hold best-effort: charge from tokens seen so far, or void the
  // reserve if nothing usable streamed. Single-shot via meter.settled (never double-
  // settles). Shared by the disconnect handlers, the in-band error path (B1) and the
  // mid-stream catch so every abnormal exit resolves the hold identically.
  const settleBestEffort = async () => {
    if (meter.settled) return;
    if (outputChars > 0) {
      await meter.settle({
        inputTokens: usageObj?.prompt_tokens ?? estInputTokens,
        outputTokens: usageObj?.completion_tokens ?? Math.ceil(outputChars / 4),
      });
    } else {
      await meter.voidHold();
    }
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

  // ── Open the upstream stream. A failure to even start → void + error event.
  try {
    upstream = await xenoChatCompletionStream({
      model,
      messages: finalMessages,
      temperature,
      max_tokens,
      signal: upstreamAbort.signal,
      // OpenRouter-style reasoning hint (the live catalog is OpenRouter-fronted);
      // the gateway streams thinking back as delta.reasoning when supported.
      extra: reasoning ? { reasoning: { effort: 'medium' } } : {},
    });
  } catch {
    await meter.voidHold();
    if (!clientGone) {
      await send({ type: 'error', error: 'inference_error', message: 'Upstream inference failed to start.' });
      endStream();
    }
    return;
  }

  // ── Relay loop: parse upstream SSE lines, translate to normalized events.
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // getReader() is INSIDE the try so a null/again-locked body funnels through the
    // catch below (which resolves the hold) instead of throwing past the metering.
    upstreamReader = upstream.body?.getReader();
    if (!upstreamReader) throw new Error('Upstream stream has no readable body');

    for (;;) {
      const { done, value } = await upstreamReader.read();
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

        // In-band provider error: OpenAI/OpenRouter signal a failed/aborted generation
        // with a valid-JSON `data: {"error":{…}}` line (no usage/choices) and then close
        // the stream normally. Without catching it here we would fall through the normal
        // exit and SETTLE + report success for a truncated/failed completion. Resolve the
        // hold from tokens seen (or void), emit a GENERIC error (never forward the
        // provider's message — no upstream detail leak) and end. Checked FIRST, before
        // usage/delta, so an error line is never mistaken for content.
        if (chunk.error) {
          await settleBestEffort();
          if (!clientGone) {
            await send({ type: 'error', error: 'inference_error', message: 'The inference stream failed.' });
            endStream();
          }
          return;
        }

        if (chunk.usage) usageObj = chunk.usage; // include_usage: final chunk

        const delta = chunk.choices?.[0]?.delta || {};
        if (typeof delta.content === 'string' && delta.content.length) {
          outputChars += delta.content.length;
          await send({ type: 'delta', text: delta.content });
        }
        const reasoningText = delta.reasoning ?? delta.reasoning_content;
        if (typeof reasoningText === 'string' && reasoningText.length) {
          await send({ type: 'reasoning', text: reasoningText });
        }
      }
    }
  } catch {
    // Upstream errored mid-stream (or setup threw): settle best-effort, or void.
    await settleBestEffort().catch(() => {});
    if (!clientGone) {
      await send({ type: 'error', error: 'inference_error', message: 'The inference stream failed.' });
      endStream();
    }
    return;
  }

  // Client vanished mid-stream — the disconnect handler owns metering; nothing to emit.
  if (clientGone) return;

  // ── Normal completion — settle from real usage. If the upstream never sent a usage
  // chunk, charge the RESERVED worst case (hasOutputUsage:false, clamped) to match
  // meterPremiumChat rather than a chars/4 estimate that under-bills. The char estimate
  // stays best-effort only for the disconnect/error paths above.
  const hasOutputUsage = usageObj != null
    && (usageObj.completion_tokens != null || usageObj.total_tokens != null);
  const inputTokens = usageObj?.prompt_tokens ?? estInputTokens;
  const outputTokens = usageObj?.completion_tokens
    ?? (usageObj?.total_tokens != null
      ? Math.max(0, usageObj.total_tokens - (usageObj.prompt_tokens || 0))
      : Math.ceil(outputChars / 4));
  const settleRes = await meter.settle({ inputTokens, outputTokens, hasOutputUsage });

  await send({
    type: 'usage',
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
    creditsSettled: settleRes.creditsCharged ?? 0,
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

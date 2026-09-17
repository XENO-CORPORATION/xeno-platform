/**
 * The tool-call loop: the model asks to search, the search runs, the model answers.
 *
 * ## Why this exists
 *
 * Two transcripts on 2026-09-13 showed the same root cause from opposite sides. First the model
 * denied a capability XENO has; then, told it had one, it FABRICATED using it —
 * `*[Running search...]*`, "I've enabled search mode", and an invented technical failure when no
 * results appeared. Both happened because the model had no tool it could actually invoke: chat
 * search existed only as a PRE-TURN step in Research mode, gated on a toggle whose handlers
 * (`toggleXenoSearch`, `toggleSearch`) were declared and called by nothing.
 *
 * This module is the missing piece. The model decides when and what to search, calls the tool,
 * gets real results, and answers from them.
 *
 * ## The constraint that shapes it: every iteration is billed
 *
 * `/api/chat/generate` called upstream exactly once, inside `meterPremiumChat` — a
 * hold → run → settle credit transaction whose `holdId` is
 * `deterministicTxnId(userId, requestId, model)`, idempotent on `requestId` so client retries do
 * not stack holds.
 *
 * 🔴 A loop makes N upstream calls per user turn. Reusing one `requestId` would make the second
 * hold collide with the first — silently under-billing, or failing the turn depending on settle
 * order. So `runToolLoop` mints a DISTINCT requestId per iteration, derived from the turn's own
 * id plus the iteration index: still deterministic, so a client retry of the same turn re-uses
 * the same holds rather than double-charging, but distinct within the turn.
 *
 * With a 10-search budget a single user message can cost ~11 metered inference calls. That is
 * real money, which is why the cap is enforced HERE, server-side, and not by asking the model
 * nicely in a prompt.
 *
 * ## What this deliberately does not do
 *
 * It does not stream. v1 buffers to the final answer, because the existing endpoint returns a
 * single response and making it stream is a separate change to the client contract. The cost is
 * visible: with a large budget the user waits. Recorded rather than hidden.
 */

/** Budgets, by surface. Chat is a quick lookup; Research is the deep multi-source pass. */
export const TOOL_BUDGETS = Object.freeze({
  /*
   * 🔴 3, not 10 (2026-09-17). Every search is a METERED upstream call with the whole growing
   * context re-sent, so the cap is the one server-side bound on what a single message can cost.
   * At 10, a model that got thin results kept re-querying until it hit the wall: "what are you
   * talking about?" became ten searches, twelve model calls and 188 seconds. Anthropic's own
   * guidance for chat is "one or two tool calls" (Research is "five or more"), and its API's
   * `max_uses` defaults to 5 — 3 keeps Chat a quick lookup and leaves depth to `research`.
   */
  chat: Object.freeze({ maxSearches: 3, depth: 'quick' }),
  research: Object.freeze({ maxSearches: 50, depth: 'deep' }),
});

/**
 * The tool surface offered to the model.
 *
 * ⚠️ One tool, deliberately. Every entry here is a promise the server must keep — if the model
 * can name it, the loop must be able to run it. Adding a declaration without an executor is the
 * exact shape of the fabrication defect, one layer down.
 */
export const WEB_SEARCH_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web and read the results. Use this whenever the answer depends on current '
      + 'information, anything after your training cutoff, or facts you should verify rather '
      + 'than recall. Prefer a specific query over a broad one.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific; include the year for anything time-sensitive.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
});

/**
 * A turn that used no tools must cost exactly one upstream call — no loop overhead.
 *
 * 🔴 `Object.hasOwn`, never a truthiness test on the lookup. `TOOL_BUDGETS['constructor']` is a
 * FUNCTION and therefore truthy, so a bracket test hands a tool to any surface name that collides
 * with something on Object.prototype — and `budgetFor` below would then read `maxSearches` off
 * that function as `undefined`, making the cap comparison `searches >= undefined` always false.
 * The one server-side bound on how many metered calls a single user message can cost would
 * silently cease to exist, and nothing would look wrong until the bill.
 */
export const toolsForSurface = (surface) =>
  (Object.hasOwn(TOOL_BUDGETS, surface) ? [WEB_SEARCH_TOOL] : []);

/** The budget for a surface, falling back to the SMALLER one for anything unrecognised. */
export const budgetFor = (surface) =>
  (Object.hasOwn(TOOL_BUDGETS, surface) ? TOOL_BUDGETS[surface] : TOOL_BUDGETS.chat);

/**
 * Parse one tool call's arguments.
 *
 * 🔴 Arguments arrive as a JSON *string* and models do emit malformed ones. A throw here would
 * fail the whole turn for a recoverable mistake, so a bad payload becomes a tool RESULT the
 * model can read and retry against — which is also how it learns the call was wrong.
 */
export function parseToolArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'empty arguments' };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'arguments must be an object' };
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
    if (!query) return { ok: false, error: 'query is required and must be a non-empty string' };
    return { ok: true, query };
  } catch {
    return { ok: false, error: 'arguments were not valid JSON' };
  }
}

/**
 * Run the loop.
 *
 * @param {object}   o
 * @param {object[]} o.messages      conversation so far, OpenAI shape
 * @param {string}   o.surface       'chat' | 'research'
 * @param {string}   o.turnId        stable id for THIS user turn (drives per-iteration requestIds)
 * @param {function} o.callModel     ({ messages, tools, requestId }) => upstream response
 * @param {function} o.runSearch     ({ query, depth }) => { sources: [...] }
 * @param {function} [o.onProgress]  ({ phase, iteration, query }) — observation only
 * @returns {Promise<{ message, iterations, searches, sources, cappedOut }>}
 */
export async function runToolLoop({ messages, surface, turnId, callModel, runSearch, onProgress }) {
  const budget = budgetFor(surface);
  const tools = toolsForSurface(surface);

  const working = [...messages];
  const sources = [];
  let searches = 0;
  let iterations = 0;
  let cappedOut = false;

  // +1: the budget counts SEARCHES, and a final answering call is always allowed on top.
  const maxIterations = budget.maxSearches + 1;

  while (iterations < maxIterations) {
    /*
     * 🔴 A distinct, DETERMINISTIC requestId per iteration.
     *
     * Distinct, or the second hold collides with the first (holdId derives from requestId and is
     * idempotent on it). Deterministic, so retrying the same turn re-uses the same holds instead
     * of charging twice for work already paid for.
     */
    const requestId = `${turnId}:${iterations}`;

    /*
     * Past the cap the tool is withdrawn rather than merely discouraged. A model told "you may
     * not search again" in prose will often try anyway; removing the declaration is structural.
     *
     * 🔴 Withdrawing it IS hitting the cap, and `cappedOut` must say so here.
     *
     * It originally flipped only when the model ASKED past the cap — but once the tool is gone
     * the model has nothing to ask with, so a turn that used the entire budget reported
     * `cappedOut: false`. Caught by the test: 10 searches ran and the result claimed it had not
     * been truncated. That is the caller's only signal that an answer may be incomplete, so a
     * false negative there is worse than no flag at all.
     */
    const { capReached, offerTools } = iterationPlan({ searches, budget, tools });
    if (capReached) cappedOut = true;

    onProgress?.({ phase: 'model', iteration: iterations });
    const response = await callModel({ messages: working, tools: offerTools, requestId });
    iterations += 1;

    const choice = response?.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error('upstream returned no message');

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      return { message, iterations, searches, sources, cappedOut };
    }

    // The assistant's tool-call message must be replayed verbatim before its results, or the
    // provider rejects the next request as an orphaned tool response.
    working.push(message);

    for (const call of toolCalls) {
      const name = call?.function?.name;
      const id = call?.id;

      if (name !== 'web_search') {
        // A tool we never declared. Answer it as a result rather than throwing: the model can
        // recover, and a hard failure here would lose a turn the user already paid for.
        working.push(toolResultMessage(id, { error: `unknown tool: ${name}` }));
        continue;
      }

      if (searches >= budget.maxSearches) {
        cappedOut = true;
        working.push(toolResultMessage(id, budgetExhaustedPayload(searches)));
        continue;
      }

      const args = parseToolArguments(call?.function?.arguments);
      if (!args.ok) {
        working.push(toolResultMessage(id, { error: args.error }));
        continue;
      }

      searches += 1;
      onProgress?.({ phase: 'search', iteration: iterations, query: args.query });

      try {
        const result = await runSearch({ query: args.query, depth: budget.depth });
        const found = Array.isArray(result?.sources) ? result.sources : [];
        sources.push(...found);
        working.push(toolResultMessage(id, searchResultPayload(args.query, found)));
      } catch (error) {
        /*
         * ⚠️ A failed search is a RESULT, not an exception.
         *
         * Throwing would abort a turn the user has already been billed for, and would produce
         * exactly the "technical hiccup" message the original defect invented — except this time
         * with nothing the model could say about it. Handing the failure back lets it tell the
         * truth: the search ran and did not work.
         */
        working.push(toolResultMessage(id, { error: `search failed: ${error?.message || 'unknown error'}` }));
      }
    }
  }

  /*
   * Ran out of iterations with the model still calling tools. Rather than returning nothing,
   * make one final call with no tools offered so the turn ends in an answer.
   */
  cappedOut = true;
  const finalResponse = await callModel({
    messages: [...working, finalAnswerNudge()],
    tools,
    requestId: `${turnId}:final`,
  });
  const finalMessage = finalResponse?.choices?.[0]?.message;
  if (!finalMessage) throw new Error('upstream returned no message on the final call');
  return { message: finalMessage, iterations: iterations + 1, searches, sources, cappedOut };
}

/*
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * STREAMING
 *
 * Same loop, inverted control. `runToolLoop` awaits a whole response per iteration; the
 * streaming form yields EVENTS as they happen, so the client sees the query before the
 * search runs and the prose as it is written.
 *
 * ## The shape, and why it is this shape
 *
 * Checked against how the three major platforms do it (2026-09-14) — they agree, which is
 * a strong signal for a surface users already have expectations about:
 *
 *   Anthropic  server_tool_use (query streams as input_json_delta) -> pause ->
 *              web_search_tool_result -> text with citations
 *   OpenAI     output_item.added(web_search_call) -> .in_progress -> .searching ->
 *              .completed -> output_item.done, citations as separate annotation events
 *   Gemini     text, then groundingChunks + groundingSupports mapping spans to sources
 *
 * The invariant all three encode: a search is a PHASE TRANSITION THE USER CAN SEE, not a
 * black box. Query visible before results, results before prose, citations attached to
 * spans rather than dumped at the end. Our events mirror that, in our own vocabulary:
 *
 *   search_start  { iteration, query }                 <- the query, before the wait
 *   search_result { iteration, query, sources, count } <- what came back
 *   search_error  { iteration, query, code, message }  <- a RESULT, never a thrown turn
 *   delta         { text }                             <- the answer, token by token
 *
 * ## 🔴 Why this is a separate function and not a flag on `runToolLoop`
 *
 * The two differ in CONTROL FLOW, not behaviour: one returns a value, the other yields a
 * sequence. A `streaming: true` parameter would force every branch to do both, which is
 * how two code paths silently stop agreeing. Instead the DECISIONS both paths share —
 * which tools to offer, whether the cap is reached, what a tool result looks like — live
 * in the helpers below and have exactly one implementation each.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * The per-iteration decision, shared by both loops.
 *
 * 🔴 The tool is NEVER withdrawn once it has been used — the cap is enforced through the
 * tool RESULT instead (`budgetExhaustedPayload`), and `cappedOut` flips the moment the
 * budget is spent.
 *
 * It used to be withdrawn at the cap ("removing the declaration is structural"), and that
 * reasoning was right in theory and wrong against the provider we actually run on. Found
 * 2026-09-14 in production: a turn that spent all ten searches ended with an EMPTY answer —
 * `result.text` was nothing but the narration between searches. Reproduced against the
 * live gateway, three attempts each at production max_tokens:
 *
 *   tool history + tools OMITTED                 -> 1 of 3 returned an empty `stop`
 *   tool history + tool kept, budget in result   -> 3 of 3 answered
 *
 * `claude-opus-5` is served through an OpenAI-compatible reseller behind our gateway.
 * When the model, mid-search, decides to call the tool again and the request declared no
 * tools, the reseller's translation emits a single `{delta:{}, finish_reason:"stop"}` —
 * a 6-second generation surfaced as nothing at all. We cannot fix their translator; we
 * can stop sending the one request shape that triggers it. Keeping the tool declared is
 * valid for every OpenAI-shaped provider, so this is not a workaround for one vendor.
 *
 * The budget is still enforced HERE, server-side: an over-budget call costs one metered
 * iteration and gets the exhausted payload, never a search.
 */
export const iterationPlan = ({ searches, budget, tools }) => {
  const capReached = searches >= budget.maxSearches;
  return { capReached, offerTools: tools };
};

/**
 * The message appended before the FINAL call, when the iteration budget is gone too.
 *
 * That call used to send `tools: []`, which is the exact shape above that the gateway
 * turns into an empty answer. Keeping the tool declared and asking, in the transcript the
 * model sees, for an answer now: 3 of 3 answered in the same probe. The nudge is sent to
 * the model only — it is never persisted or shown to the user.
 *
 * @internal Shared by the two loops in this file, like the other message builders; no
 * other module imports it.
 */
export const finalAnswerNudge = () => ({
  role: 'user',
  content: 'The search budget for this turn is used up. Answer now from the results you already have, and say which parts are uncertain.',
});

/**
 * A tool result message, in the one shape both loops send back to the provider.
 *
 * @internal Exported so the buffering and streaming loops in this file share ONE definition
 * of what a tool result looks like, and so tests can assert the shape directly. No other
 * module imports it; the loops are the only callers.
 */
export const toolResultMessage = (toolCallId, payload) => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: JSON.stringify(payload),
});

/**
 * The payload for a successful search — the same projection in both loops.
 *
 * @internal Same reason as above: one definition shared by the two loops in this file.
 */
export const searchResultPayload = (query, sources) => ({
  query,
  sources: sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet ?? s.text ?? '' })),
});

/**
 * The payload when the budget is gone: say so, and tell the model what to do instead.
 *
 * @internal Shared by both loops in this file; not imported elsewhere.
 */
export const budgetExhaustedPayload = (searches) => ({
  error: 'search budget exhausted for this turn',
  searchesUsed: searches,
  instruction: 'Answer now using what you already have, and say which parts are uncertain.',
});

/**
 * Run the loop, yielding events as they happen.
 *
 * @param {object}   o
 * @param {object[]} o.messages     conversation so far, OpenAI shape
 * @param {string}   o.surface      'chat' | 'research'
 * @param {string}   o.turnId       stable id for THIS user turn (drives per-iteration requestIds)
 * @param {function} o.streamModel  ({ messages, tools, requestId }) => AsyncIterable<
 *                                    { type:'delta', text } | { type:'tool_calls', toolCalls } |
 *                                    { type:'usage', usage }>
 * @param {function} o.runSearch    ({ query, depth }) => { sources: [...] }
 * @yields { type:'delta'|'search_start'|'search_result'|'search_error'|'usage'|'complete', … }
 */
export async function* streamToolLoop({ messages, surface, turnId, streamModel, runSearch }) {
  const budget = budgetFor(surface);
  const tools = toolsForSurface(surface);

  const working = [...messages];
  const sources = [];
  let searches = 0;
  let iterations = 0;
  let cappedOut = false;
  let lastUsage = null;

  const maxIterations = budget.maxSearches + 1;

  while (iterations < maxIterations) {
    // Distinct per iteration (holds derive from requestId and are idempotent on it, so a
    // reused id silently collides), deterministic so a retried turn reuses its holds.
    const requestId = `${turnId}:${iterations}`;
    const { capReached, offerTools } = iterationPlan({ searches, budget, tools });
    if (capReached) cappedOut = true;

    let text = '';
    let toolCalls = [];

    for await (const event of streamModel({ messages: working, tools: offerTools, requestId })) {
      if (event.type === 'delta') {
        /*
         * 🔴 Forwarded IMMEDIATELY, including on an iteration that will turn out to be a
         * tool call. Models narrate before searching ("Let me check the current figures")
         * and that text is part of the answer — holding it back until the turn resolves
         * is what made the buffered version feel like a hang.
         */
        text += event.text;
        yield { type: 'delta', text: event.text };
      } else if (event.type === 'tool_calls') {
        toolCalls = event.toolCalls;
      } else if (event.type === 'usage') {
        // Usage accrues ACROSS iterations: each upstream call bills separately, so the
        // caller needs the sum, not the last one.
        lastUsage = addUsage(lastUsage, event.usage);
        yield { type: 'usage', usage: event.usage };
      }
    }

    iterations += 1;

    if (toolCalls.length === 0) {
      yield { type: 'complete', iterations, searches, sources, cappedOut, usage: lastUsage };
      return;
    }

    working.push(assistantToolCallMessage(text, toolCalls));

    for (const call of toolCalls) {
      const name = call?.function?.name;
      const id = call?.id;

      if (name !== 'web_search') {
        working.push(toolResultMessage(id, { error: `unknown tool: ${name}` }));
        continue;
      }

      if (searches >= budget.maxSearches) {
        cappedOut = true;
        working.push(toolResultMessage(id, budgetExhaustedPayload(searches)));
        continue;
      }

      const args = parseToolArguments(call?.function?.arguments);
      if (!args.ok) {
        working.push(toolResultMessage(id, { error: args.error }));
        continue;
      }

      searches += 1;
      // The query goes out BEFORE the search runs — this is the event that turns a silent
      // wait into a visible one, and it is the whole reason for streaming this loop.
      yield { type: 'search_start', iteration: iterations, query: args.query };

      try {
        const result = await runSearch({ query: args.query, depth: budget.depth });
        const found = Array.isArray(result?.sources) ? result.sources : [];
        sources.push(...found);
        working.push(toolResultMessage(id, searchResultPayload(args.query, found)));
        yield {
          type: 'search_result',
          iteration: iterations,
          query: args.query,
          count: found.length,
          sources: found.map((s) => ({ title: s.title, url: s.url })),
        };
      } catch (error) {
        // A failure is a RESULT on both channels: a tool message so the model can speak to
        // it truthfully, and an event so the user sees the search was attempted and failed
        // rather than watching it silently vanish.
        const message = error?.message || 'unknown error';
        working.push(toolResultMessage(id, { error: `search failed: ${message}` }));
        yield {
          type: 'search_error',
          iteration: iterations,
          query: args.query,
          code: error?.code || 'web_context_unavailable',
          message,
        };
      }
    }
  }

  /*
   * Out of iterations with the model still calling tools: one final pass with no tools, so
   * the turn ends in an answer rather than in silence.
   */
  cappedOut = true;
  for await (const event of streamModel({ messages: [...working, finalAnswerNudge()], tools, requestId: `${turnId}:final` })) {
    if (event.type === 'delta') yield { type: 'delta', text: event.text };
    else if (event.type === 'usage') {
      lastUsage = addUsage(lastUsage, event.usage);
      yield { type: 'usage', usage: event.usage };
    }
  }
  yield { type: 'complete', iterations: iterations + 1, searches, sources, cappedOut, usage: lastUsage };
}

/**
 * The assistant's tool-call message, rebuilt for replay.
 *
 * @internal Used by the streaming loop in this file. Exported for tests and for symmetry
 * with the other message builders above; no other module imports it.
 *
 * It must go back to the provider verbatim before its tool results or the next request is
 * rejected for orphaned tool responses — and `content` must be a string even when the model
 * emitted no prose, because a null there is a validation error on several providers.
 */
export const assistantToolCallMessage = (text, toolCalls) => ({
  role: 'assistant',
  content: text || '',
  tool_calls: toolCalls,
});

/**
 * Sum usage across iterations.
 *
 * 🔴 A tool turn makes N upstream calls and EACH reports its own usage. Keeping only the
 * last one under-reports a 10-search turn as if it were a single call — and usage is what
 * the settle is computed from, so that is an under-BILL, not just a wrong number.
 */
export const addUsage = (total, next) => {
  if (!next) return total;
  if (!total) return { ...next };
  const add = (a, b) => (Number(a) || 0) + (Number(b) || 0);
  return {
    ...total,
    prompt_tokens: add(total.prompt_tokens, next.prompt_tokens),
    completion_tokens: add(total.completion_tokens, next.completion_tokens),
    total_tokens: add(total.total_tokens, next.total_tokens),
  };
};

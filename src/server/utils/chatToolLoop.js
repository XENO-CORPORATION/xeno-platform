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
  chat: Object.freeze({ maxSearches: 10, depth: 'quick' }),
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

/** A turn that used no tools must cost exactly one upstream call — no loop overhead. */
export const toolsForSurface = (surface) => (TOOL_BUDGETS[surface] ? [WEB_SEARCH_TOOL] : []);

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
  const budget = TOOL_BUDGETS[surface] ?? TOOL_BUDGETS.chat;
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
    const capReached = searches >= budget.maxSearches;
    if (capReached) cappedOut = true;
    const offerTools = capReached ? [] : tools;

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
        working.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ error: `unknown tool: ${name}` }) });
        continue;
      }

      if (searches >= budget.maxSearches) {
        cappedOut = true;
        working.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({
            error: 'search budget exhausted for this turn',
            searchesUsed: searches,
            instruction: 'Answer now using what you already have, and say which parts are uncertain.',
          }),
        });
        continue;
      }

      const args = parseToolArguments(call?.function?.arguments);
      if (!args.ok) {
        working.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ error: args.error }) });
        continue;
      }

      searches += 1;
      onProgress?.({ phase: 'search', iteration: iterations, query: args.query });

      try {
        const result = await runSearch({ query: args.query, depth: budget.depth });
        const found = Array.isArray(result?.sources) ? result.sources : [];
        sources.push(...found);
        working.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({
            query: args.query,
            sources: found.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet ?? s.text ?? '' })),
          }),
        });
      } catch (error) {
        /*
         * ⚠️ A failed search is a RESULT, not an exception.
         *
         * Throwing would abort a turn the user has already been billed for, and would produce
         * exactly the "technical hiccup" message the original defect invented — except this time
         * with nothing the model could say about it. Handing the failure back lets it tell the
         * truth: the search ran and did not work.
         */
        working.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({ error: `search failed: ${error?.message || 'unknown error'}` }),
        });
      }
    }
  }

  /*
   * Ran out of iterations with the model still calling tools. Rather than returning nothing,
   * make one final call with no tools offered so the turn ends in an answer.
   */
  cappedOut = true;
  const finalResponse = await callModel({
    messages: working,
    tools: [],
    requestId: `${turnId}:final`,
  });
  const finalMessage = finalResponse?.choices?.[0]?.message;
  if (!finalMessage) throw new Error('upstream returned no message on the final call');
  return { message: finalMessage, iterations: iterations + 1, searches, sources, cappedOut };
}

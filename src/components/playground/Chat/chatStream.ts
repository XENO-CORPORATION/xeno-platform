/**
 * Read the chat SSE stream.
 *
 * The server (`POST /api/ai/chat/stream`) emits newline-delimited `data:` frames carrying
 * the normalized events below. This turns that byte stream into typed events, and nothing
 * else — no React, no fetch, no state — so the parsing can be tested without a browser.
 *
 * ## The event vocabulary, and where it comes from
 *
 * Checked against how Anthropic, OpenAI and Gemini stream a hosted search (2026-09-14).
 * They differ in naming and agree on the architecture: the search happens inside ONE
 * streamed response and its phases are typed events beside the text. The rule they all
 * encode is that a search is a phase transition the user can SEE — query before results,
 * results before prose — rather than a silent pause the client has to guess at.
 *
 *   delta          assistant text, as it is written
 *   reasoning      thinking, when the model streams it
 *   search_start   the QUERY, emitted before the search runs
 *   search_result  what came back (count + sources)
 *   search_error   a search that failed — reported, never fatal
 *   sources        the deduped citations for the whole turn
 *   tool_use       how many searches/iterations, and whether the budget ran out
 *   usage          tokens + credits settled
 *   error          the turn failed
 *   done           end of turn
 *
 * ## 🔴 Two parsing traps this exists to get right
 *
 * 1. A `data:` frame can be SPLIT ACROSS CHUNKS. `fetch`'s reader hands back arbitrary
 *    byte boundaries, not lines, so a frame may arrive as `data: {"ty` + `pe":"delta"…}`.
 *    Parsing per chunk drops those frames — visibly, as missing words in the answer. The
 *    buffer here only ever consumes up to the last newline it has actually seen.
 *
 * 2. A multi-byte UTF-8 character can straddle a chunk boundary. `TextDecoder` is created
 *    ONCE and used with `{ stream: true }` so it holds the partial sequence; decoding each
 *    chunk independently turns any emoji or accented character unlucky enough to land on a
 *    boundary into U+FFFD. That is the same class of bug as the base64 chunk issue in
 *    xeno-use's exec stream, one layer up.
 */

/** An image the chat's generate_image tool made — a library asset, never inline bytes. */
export interface ChatGeneratedImage {
  id: string;
  contentUrl: string;
  prompt: string;
  aspectRatio: string;
  model?: string;
  width?: number;
  height?: number;
  /**
   * A WebP of the same bytes, on the live `image_result` frame ONLY — never on the stored message.
   * The library copy is quarantined until its malware scan passes, and this is what the person who
   * asked sees in the meantime.
   */
  previewUrl?: string;
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'search_start'; query: string; iteration: number }
  | { type: 'search_result'; query: string; count: number; sources: Array<{ url: string; title: string }> }
  | { type: 'search_error'; query: string; code: string; message: string }
  // generate_image (2026-09-26): the shape first, so the placeholder is the right size; then the
  // stored library asset, or a failure the turn reports rather than a placeholder that vanishes.
  | { type: 'image_start'; index: number; prompt: string; aspectRatio: string; edit?: boolean }
  | { type: 'image_result'; index: number; image: ChatGeneratedImage; creditsCharged?: number }
  | { type: 'image_error'; index: number; code: string; message: string }
  | { type: 'sources'; sources: Array<{ url: string; title: string }> }
  | { type: 'tool_use'; searches: number; images?: number; iterations: number; cappedOut: boolean }
  | { type: 'usage'; input: number; output: number; total: number; creditsSettled: number; upstreamCalls?: number }
  | { type: 'error'; error: string; message: string }
  | { type: 'done' };

/**
 * Turn a `fetch` response body into typed events.
 *
 * Yields rather than calling back so the consumer controls back-pressure: an `await` in the
 * loop body pauses reading, instead of React state updates queueing up unboundedly behind a
 * fast stream.
 */
export async function* readChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  // ONE decoder for the whole stream — see trap 2 above.
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      // Only consume complete lines; a trailing partial frame stays in the buffer for the
      // next chunk to finish (trap 1).
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return; // the OpenAI-compatible sentinel closes the stream
        let event: ChatStreamEvent;
        try {
          event = JSON.parse(payload) as ChatStreamEvent;
        } catch {
          continue; // a frame we cannot read is skipped, never fatal
        }
        yield event;
        if (event.type === 'done') return;
      }
    }
  } finally {
    // Releasing the lock lets the caller abort without the body staying pinned.
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/**
 * What the UI shows while a turn is running.
 *
 * Kept as a plain reducer so the "what should be on screen right now" question has one
 * answer, testable without rendering anything.
 */
export interface ChatStreamState {
  text: string;
  reasoning: string;
  /** The search currently running, if any — this is what makes a wait legible. */
  activeSearch: string | null;
  searches: Array<{ query: string; count: number; failed?: boolean }>;
  sources: Array<{ url: string; title: string }>;
  cappedOut: boolean;
  error: string | null;
  done: boolean;
  usage: { input: number; output: number; total: number; creditsSettled: number } | null;
}

export const initialChatStreamState = (): ChatStreamState => ({
  text: '',
  reasoning: '',
  activeSearch: null,
  searches: [],
  sources: [],
  cappedOut: false,
  error: null,
  done: false,
  usage: null,
});

/** Fold one event into the visible state. Pure: same input, same output, no side effects. */
export function applyChatStreamEvent(
  state: ChatStreamState,
  event: ChatStreamEvent,
): ChatStreamState {
  switch (event.type) {
    case 'delta':
      return { ...state, text: state.text + event.text };
    case 'reasoning':
      return { ...state, reasoning: state.reasoning + event.text };
    case 'search_start':
      // Shown immediately, and cleared by the matching result/error below. If this were
      // set after the search resolved it would never be visible, which is the whole point.
      return { ...state, activeSearch: event.query };
    case 'search_result':
      return {
        ...state,
        activeSearch: null,
        searches: [...state.searches, { query: event.query, count: event.count }],
        // Deduped by url: the same source legitimately appears across several searches in
        // one turn, and listing it twice reads as a bug.
        sources: mergeSources(state.sources, event.sources),
      };
    case 'search_error':
      return {
        ...state,
        activeSearch: null,
        searches: [...state.searches, { query: event.query, count: 0, failed: true }],
      };
    case 'sources':
      return { ...state, sources: mergeSources(state.sources, event.sources) };
    case 'tool_use':
      return { ...state, cappedOut: event.cappedOut };
    case 'usage':
      return {
        ...state,
        usage: {
          input: event.input,
          output: event.output,
          total: event.total,
          creditsSettled: event.creditsSettled,
        },
      };
    case 'error':
      // Terminal, and it keeps whatever text already arrived: a turn that failed halfway
      // still wrote real words, and discarding them loses work the user was billed for.
      return { ...state, error: event.message || 'The response failed.', activeSearch: null, done: true };
    case 'done':
      return { ...state, done: true, activeSearch: null };
    default:
      return state;
  }
}

/**
 * Which endpoint serves this turn.
 *
 * 🔴 The two routes are NOT interchangeable, and the split is not arbitrary.
 *
 * `/api/ai/chat/stream` serves a CHAT TURN: text, tools, project grounding, citations. It
 * streams tokens and emits a terminal `result` frame carrying the same fields the other
 * route returns, built by the same six shared modules.
 *
 * `/api/chat/generate` keeps the tasks that are NOT chat turns. `task: 'image'` is a
 * self-contained handler — it writes a file to disk, registers a library item and logs
 * credits, then returns before the chat path runs at all. `refine_image_prompt` is a
 * one-shot transformation whose reply is a prompt, not an answer. Neither produces an
 * assistant message, and both return fields (`libraryItemId`, `libraryContentUrl`,
 * `refinedPromptText`) that a chat turn cannot.
 *
 * ⚠️ Routing by task rather than by capability is deliberate. "Does this turn need
 * streaming?" is a judgement that would drift; "is this an image task?" is a fact on the
 * request. A wrong answer here sends an image generation to a route that cannot persist it.
 */
export type ChatTask = 'image' | 'refine_image_prompt' | undefined;

export const CHAT_STREAM_ENDPOINT = '/api/ai/chat/stream';

/**
 * @internal The endpoint `endpointForTask` returns for image tasks. Exported so the routing
 * test can assert WHERE an image task goes by name rather than re-typing the path — a test
 * that hardcodes the string would keep passing if this value changed, which is the one
 * mistake that matters here (an image generation routed to a route that cannot persist it).
 * No `src/` module imports it; the component only ever compares against CHAT_STREAM_ENDPOINT.
 */
export const CHAT_GENERATE_ENDPOINT = '/api/chat/generate';

export const endpointForTask = (task: ChatTask): string =>
  (task === 'image' || task === 'refine_image_prompt'
    ? CHAT_GENERATE_ENDPOINT
    : CHAT_STREAM_ENDPOINT);

/**
 * The streaming route's request shape.
 *
 * ⚠️ It takes `model`, not `selectedModelId`, and `reasoning`, not
 * `effectiveReasoningState` — the names differ because that route predates the chat client
 * and is also an API surface for callers sending OpenAI-shaped requests. Translating here,
 * in one place, is what keeps the component from carrying two payload shapes.
 */
export const streamRequestBody = (payload: Record<string, any>): Record<string, any> => ({
  model: payload.selectedModelId,
  messages: payload.messages,
  reasoning: payload.effectiveReasoningState,
  reasoningEffort: payload.reasoningEffort,
  systemPrompt: payload.systemPrompt,
  conversationId: payload.conversationId,
  projectId: payload.projectId,
  chatSurface: payload.chatSurface,
  supportsVision: payload.supportsVision === true,
  temperature: payload.temperature,
  max_tokens: payload.max_tokens,
});

/**
 * Read `/api/chat/generate` when progress frames were requested.
 *
 * The route answers ONE of two ways, and this hides the difference from the caller:
 *   - plain JSON, when the server did not stream (an older build, or a turn with no tools)
 *   - SSE, where `search_start` frames arrive while the turn runs and the SAME response
 *     object the JSON path would have returned arrives last as a `result` frame
 *
 * 🔴 Returning the identical object in both cases is the whole design. `fetchAiResponse`
 * has ~400 lines of downstream handling keyed off that shape — reasoning, project sources,
 * images, usage — and a second, subtly different payload would fork all of it. Streaming
 * changes WHEN the caller learns things, never WHAT it gets.
 *
 * `onProgress` is fired for the phases that happen before the answer exists; it is the only
 * new information, and a caller that ignores it behaves exactly as before.
 */
export async function readGenerateResponse(
  response: Response,
  onProgress?: (event: ChatStreamEvent) => void,
): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  // The server only streams when it decided to; never assume from the request.
  if (!contentType.includes('text/event-stream') || !response.body) {
    return response.json();
  }

  let result: any = null;
  let failure: { code: string; message: string } | null = null;

  for await (const event of readNamedEvents(response.body)) {
    if (event.name === 'result') {
      result = event.data;
    } else if (event.name === 'error') {
      failure = { code: event.data?.code || 'generation_failed', message: event.data?.message || 'Generation failed.' };
    } else if (event.name === 'search_start') {
      onProgress?.({ type: 'search_start', query: event.data?.query, iteration: event.data?.iteration });
    } else if (event.name === 'delta') {
      /*
       * Assistant text, as it is written.
       *
       * ⚠️ The caller renders these incrementally, but the FINAL text always comes from the
       * `result` frame — never from accumulating deltas. A dropped frame (the server does not
       * block on back-pressure, deliberately, to avoid holding a credit hold open on a slow
       * client) would otherwise silently truncate the stored message. Deltas are for the eye;
       * the result is the record.
       */
      if (event.data?.text) onProgress?.({ type: 'delta', text: event.data.text });
    } else if (event.name === 'reasoning') {
      if (event.data?.text) onProgress?.({ type: 'reasoning', text: event.data.text });
    }
  }

  /*
   * An error frame becomes a thrown Error, so the caller's existing catch handles it — the
   * same path a non-200 already takes. A streamed failure arrives with HTTP 200 (the status
   * was fixed the moment the first frame went out), so without this it would read as success
   * with an empty body.
   */
  if (failure) throw new Error(failure.message);
  if (!result) throw new Error('The response ended before an answer arrived.');
  return result;
}

/**
 * Parse `event:` / `data:` framed SSE.
 *
 * Distinct from `readChatStream` above, which reads the bare `data:`-only shape the
 * inference stream uses. Same two byte-level traps apply and are handled identically: one
 * decoder for the whole stream, and only consume up to the last newline actually seen.
 */
async function* readNamedEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ name: string; data: any }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let name = 'message';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) { name = 'message'; continue; } // a blank line ends the event
        if (line.startsWith('event:')) { name = line.slice(6).trim(); continue; }
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          yield { name, data: JSON.parse(payload) };
        } catch {
          /* an unreadable frame is skipped, never fatal */
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/**
 * Read a turn from `/api/ai/chat/stream`.
 *
 * Returns the SAME object `/api/chat/generate` returns, so the ~400 downstream lines in
 * `fetchAiResponse` are untouched — they are keyed off that shape, and a second, subtly
 * different payload would fork all of it.
 *
 * ⚠️ This route frames differently from the other one: bare `data:` lines carrying a
 * `type`, rather than `event:`-named frames. Two readers, deliberately — guessing the
 * framing from the content is how a parser silently starts dropping a frame kind.
 *
 * 🔴 The final text comes from the `result` frame, never from accumulated deltas. The
 * server does not block on back-pressure (pausing the read would hold a credit hold open on
 * a slow client), so a dropped delta must not be able to truncate the stored message.
 * Deltas are for the eye; the result is the record.
 */
export async function readStreamedTurn(
  response: Response,
  onProgress?: (event: ChatStreamEvent) => void,
): Promise<any> {
  if (!response.body) throw new Error('The response had no body.');

  let result: any = null;
  let failure: string | null = null;

  for await (const event of readChatStream(response.body)) {
    switch (event.type) {
      case 'delta':
      case 'reasoning':
      case 'search_start':
      case 'search_result':
      case 'search_error':
      case 'image_start':
      case 'image_result':
      case 'image_error':
        onProgress?.(event);
        break;
      case 'error':
        failure = event.message || 'The response failed.';
        break;
      default:
        // `result` is not in ChatStreamEvent — it is this route's terminal payload.
        if ((event as any).type === 'result') result = event;
        break;
    }
  }

  /*
   * A streamed failure arrives with HTTP 200 — the status was fixed the moment the first
   * frame went out — so it must become a thrown Error for the caller's existing catch.
   * Without this it reads as success with an empty body.
   */
  if (failure) throw new Error(failure);
  if (!result) throw new Error('The response ended before an answer arrived.');

  // Drop the frame's own discriminator so the caller sees exactly the generate-route shape.
  const { type: _type, ...data } = result;
  return data;
}

/** Merge source lists, keeping first-seen order and one entry per URL. */
function mergeSources(
  existing: Array<{ url: string; title: string }>,
  incoming: Array<{ url: string; title: string }>,
): Array<{ url: string; title: string }> {
  const seen = new Set(existing.map((s) => s.url));
  const merged = [...existing];
  for (const source of incoming) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    merged.push(source);
  }
  return merged;
}

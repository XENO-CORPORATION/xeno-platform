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

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'search_start'; query: string; iteration: number }
  | { type: 'search_result'; query: string; count: number; sources: Array<{ url: string; title: string }> }
  | { type: 'search_error'; query: string; code: string; message: string }
  | { type: 'sources'; sources: Array<{ url: string; title: string }> }
  | { type: 'tool_use'; searches: number; iterations: number; cappedOut: boolean }
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

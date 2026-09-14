/**
 * Accumulate tool calls that arrive SPLIT ACROSS SSE CHUNKS.
 *
 * ## Why this exists
 *
 * A streamed tool call is not delivered as an object. It arrives as fragments:
 *
 *   delta.tool_calls = [{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '' } }]
 *   delta.tool_calls = [{ index: 0, function: { arguments: '{"que' } }]
 *   delta.tool_calls = [{ index: 0, function: { arguments: 'ry":"…"}' } }]
 *
 * Only `index` is present on every fragment — `id` and `name` appear once, usually on
 * the first, and the arguments are a JSON string built up a few characters at a time.
 * So the accumulator keys on INDEX, never on id, and never parses until the stream says
 * the call is complete. Every major provider streams this shape; Anthropic's equivalent
 * is `input_json_delta` carrying `partial_json`, documented at
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool#streaming
 *
 * 🔴 THE TRAP THIS CLASS EXISTS TO REMOVE: `JSON.parse` on a partial fragment throws,
 * and a naive implementation treats that as a malformed call from the model. It is not —
 * it is a complete call that has not finished arriving. Parsing early turns a working
 * search into "the model sent bad arguments", intermittently, depending purely on where
 * the network split the payload. That is why nothing here parses mid-stream: `finish()`
 * is the only place a fragment becomes a value.
 *
 * ⚠️ Two calls can stream INTERLEAVED (parallel tool calls), so fragments for index 0
 * and index 1 alternate. Keying on index is what keeps them apart; appending to "the
 * current call" would splice two JSON documents into one unparseable string.
 *
 * Pure and dependency-free so it can be tested without a socket or a provider.
 */

/** A tool call still being assembled. */
class PartialCall {
  constructor(index) {
    this.index = index;
    this.id = '';
    this.name = '';
    this.argumentChunks = [];
  }

  get arguments() {
    return this.argumentChunks.join('');
  }
}

export class ToolCallAccumulator {
  constructor() {
    /** @type {Map<number, PartialCall>} keyed by INDEX — the only field on every fragment. */
    this.byIndex = new Map();
    this.order = [];
  }

  /** True once any fragment of any tool call has been seen. */
  get sawAny() {
    return this.byIndex.size > 0;
  }

  /**
   * Absorb one `delta.tool_calls` array from a streamed chunk.
   *
   * Fragments are additive: a field that is absent leaves the accumulated value alone,
   * so a later fragment carrying only `arguments` cannot blank out the name set earlier.
   */
  push(fragments) {
    if (!Array.isArray(fragments)) return;
    for (const fragment of fragments) {
      if (!fragment || typeof fragment !== 'object') continue;
      // Index may legitimately be 0, so check presence rather than truthiness.
      const index = Number.isInteger(fragment.index) ? fragment.index : this.order.length;
      let call = this.byIndex.get(index);
      if (!call) {
        call = new PartialCall(index);
        this.byIndex.set(index, call);
        this.order.push(index);
      }
      if (typeof fragment.id === 'string' && fragment.id) call.id = fragment.id;
      const fn = fragment.function;
      if (fn && typeof fn === 'object') {
        if (typeof fn.name === 'string' && fn.name) call.name = fn.name;
        // '' is a real fragment (providers open the arguments with one) — append any
        // string, and only a string, so a null never becomes the text "null".
        if (typeof fn.arguments === 'string') call.argumentChunks.push(fn.arguments);
      }
    }
  }

  /**
   * Close the stream and hand back the completed calls, in arrival order.
   *
   * The arguments come back as the RAW STRING, deliberately: parsing belongs to the
   * caller's existing `parseToolArguments`, which already turns a malformed payload into
   * a tool RESULT the model can recover from rather than a thrown turn. Two parsers
   * would be two different opinions about what "malformed" means.
   */
  finish() {
    return this.order.map((index) => {
      const call = this.byIndex.get(index);
      return {
        id: call.id || `call_${index}`,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      };
    });
  }
}

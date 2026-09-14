/**
 * Stream one upstream completion, and return the object a NON-streaming call would have.
 *
 * ## Why this shape
 *
 * `/api/chat/generate` has ~130 lines of post-processing between the model call and its
 * response — reasoning extraction, project-context hashing, image handling, usage — and all
 * of it reads exactly two fields: `data.choices` and `data.usage` (measured, not assumed).
 *
 * So streaming does not require rewriting that. It requires a call that emits tokens AS THEY
 * ARRIVE and then hands back the same assembled `{ choices, usage }`. Every downstream line
 * keeps working, untouched, and the route gains incremental output.
 *
 * 🔴 This is the alternative to migrating the client onto `/api/ai/chat/stream`, which would
 * have meant porting the image-REFERRAL heuristic and the project-context path too — moving
 * product logic to chase a transport. The transport comes to the logic instead.
 *
 * ## What it handles that a naive reader does not
 *
 * - **Tool calls arrive as fragments** and are accumulated by index (`ToolCallAccumulator`),
 *   never parsed mid-stream: a half-arrived arguments string is incomplete, not malformed.
 * - **A frame can split across chunks**, so the buffer only consumes up to the last newline.
 * - **A multi-byte character can split across chunks**, so ONE decoder with `{stream:true}`
 *   spans the whole response; per-chunk decoding yields U+FFFD on boundary-unlucky emoji.
 * - **An in-band `data: {"error":…}`** closes the stream normally, so it must be caught
 *   explicitly or a failed generation is assembled and reported as a success.
 */
import { ToolCallAccumulator } from './streamingToolCalls.js';

/**
 * @param {object}   o
 * @param {string}   o.url          upstream chat-completions endpoint
 * @param {string}   o.apiKey       bearer token
 * @param {object}   o.payload      the request body (stream flags are added here)
 * @param {function} [o.onDelta]    (text) => void — assistant prose, as it arrives
 * @param {function} [o.onReasoning](text) => void — thinking, when the provider streams it
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{choices:[{message:object,finish_reason:string}],usage:object|null}>}
 */
export async function streamCompletion({ url, apiKey, payload, onDelta, onReasoning, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      ...payload,
      stream: true,
      // Without this the final usage chunk never arrives and the turn bills from an
      // estimate — the meter's `hasOutputUsage: false` path, which charges worst case.
      stream_options: { include_usage: true },
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* non-JSON upstream error */ }
    const error = new Error(parsed.error?.message || `XENO API Error: Status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error('Upstream stream has no readable body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder(); // ONE decoder for the whole stream
  const calls = new ToolCallAccumulator();

  let buffer = '';
  let text = '';
  let reasoning = '';
  let usage = null;
  let finishReason = 'stop';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      // Only complete lines; a trailing partial frame waits for the next chunk.
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || !line.startsWith('data:')) continue;
        const frame = line.slice(5).trim();
        if (frame === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(frame); } catch { continue; }

        /*
         * 🔴 Checked FIRST. An in-band error is a valid-JSON frame with no choices, after
         * which the stream closes NORMALLY — so without this we assemble whatever arrived
         * and report a failed generation as a success.
         */
        if (chunk.error) {
          const error = new Error(chunk.error?.message || 'The inference stream failed.');
          error.inBand = true;
          throw error;
        }

        if (chunk.usage) usage = chunk.usage;

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta || {};
        if (Array.isArray(delta.tool_calls)) calls.push(delta.tool_calls);
        if (typeof delta.content === 'string' && delta.content.length) {
          text += delta.content;
          onDelta?.(delta.content);
        }
        const thinking = delta.reasoning ?? delta.reasoning_content;
        if (typeof thinking === 'string' && thinking.length) {
          reasoning += thinking;
          onReasoning?.(thinking);
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  /*
   * Assemble the non-streaming shape. `content` must be a STRING even when empty — several
   * providers reject a null there when the message is replayed as history, and the tool loop
   * replays this message verbatim before its results.
   */
  const message = { role: 'assistant', content: text || '' };
  if (reasoning) message.reasoning = reasoning;
  const toolCalls = calls.sawAny ? calls.finish() : [];
  if (toolCalls.length) message.tool_calls = toolCalls;

  return {
    choices: [{ message, finish_reason: toolCalls.length ? 'tool_calls' : finishReason }],
    usage,
  };
}

// streamClient — consumes POST /api/ai/chat/stream (Server-Sent Events over fetch).
//
// The endpoint returns an OpenAI-compatible text/event-stream. Each event is a line
// `data: <json>\n\n`; the final line is `data: [DONE]\n\n`. We parse the typed event
// shapes defined in the streaming contract (delta / reasoning / usage / done / error)
// and drive the supplied handlers. Cancellation is via the caller's AbortSignal.

import type { StreamHandlers, StreamRequest, StreamEvent, StreamErrorCode } from './types';

const STREAM_URL = '/api/ai/chat/stream';
const AUTH_TOKEN_KEY = 'xenoos_auth_token';

function authHeaders(): HeadersInit {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const VALID_ERROR_CODES: StreamErrorCode[] = [
  'unauthorized',
  'insufficient_credits',
  'inference_error',
  'invalid_request',
];

function coerceErrorCode(code: unknown): StreamErrorCode {
  return VALID_ERROR_CODES.includes(code as StreamErrorCode)
    ? (code as StreamErrorCode)
    : 'inference_error';
}

/**
 * Open the stream and drive `handlers` until the server sends `done`/`[DONE]`, an
 * error event, or the signal aborts. Resolves when the stream is fully consumed.
 * A non-2xx pre-stream response (e.g. 402/401/400 JSON) is surfaced via onError.
 */
export async function streamChat(
  body: StreamRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(STREAM_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    handlers.onError?.({ error: 'inference_error', message: 'Network error opening the stream.' });
    return;
  }

  // Pre-stream failure → the server answered with a JSON error, not an event stream.
  if (!res.ok) {
    let code: StreamErrorCode = 'inference_error';
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      code = coerceErrorCode(data?.error);
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      if (res.status === 401) code = 'unauthorized';
      else if (res.status === 402) code = 'insufficient_credits';
      else if (res.status === 400) code = 'invalid_request';
    }
    handlers.onError?.({ error: code, message });
    return;
  }

  if (!res.body) {
    handlers.onError?.({ error: 'inference_error', message: 'Empty stream response.' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneEmitted = false;

  const dispatch = (evt: StreamEvent) => {
    switch (evt.type) {
      case 'delta':
        handlers.onDelta?.(evt.text);
        break;
      case 'reasoning':
        handlers.onReasoning?.(evt.text);
        break;
      case 'usage':
        handlers.onUsage?.({
          input: evt.input,
          output: evt.output,
          total: evt.total,
          creditsSettled: evt.creditsSettled,
        });
        break;
      case 'done':
        doneEmitted = true;
        handlers.onDone?.();
        break;
      case 'error':
        handlers.onError?.({ error: coerceErrorCode(evt.error), message: evt.message });
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          if (!doneEmitted) handlers.onDone?.();
          doneEmitted = true;
          return;
        }
        let evt: StreamEvent | null = null;
        try {
          evt = JSON.parse(payload) as StreamEvent;
        } catch {
          continue; // ignore malformed/partial lines
        }
        if (evt && typeof evt.type === 'string') dispatch(evt);
      }
    }
    // Stream closed without an explicit sentinel — treat as done.
    if (!doneEmitted) handlers.onDone?.();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return; // caller stopped the stream
    handlers.onError?.({ error: 'inference_error', message: 'The stream was interrupted.' });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

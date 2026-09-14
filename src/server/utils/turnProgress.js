/**
 * Publish what a turn is DOING while it runs, without changing what it RETURNS.
 *
 * ## The problem this solves, and the constraint it works around
 *
 * `/api/chat/generate` answers with one JSON body, and ~130 lines of post-processing sit
 * between the model call and `res.json` — reasoning extraction, project-context hashing,
 * image handling, usage. All of it assumes a complete text. Converting that route to a
 * token stream is a large change to the most-used path in the product.
 *
 * But the reported defect is narrower than "it does not stream". A tool turn can run ten
 * searches over a minute or more and, until it finishes, the client has NOTHING — so a
 * working turn is indistinguishable from a hang. What fixes that is not token-by-token
 * text; it is seeing WHICH QUERY IS RUNNING. That is the same thing Anthropic, OpenAI and
 * Gemini all surface (a search is a phase transition the user can see), and it can be
 * delivered without touching the response contract at all.
 *
 * ## How
 *
 * Progress is written as SSE frames on the same response, BEFORE the JSON body, and only
 * when the client asked for it by sending `Accept: text/event-stream`. A client that did
 * not ask gets byte-identical behaviour to before — which is what makes this safe to ship
 * ahead of any client change.
 *
 * 🔴 The ordering rule that makes it work: once a body has started, headers are sent and
 * `res.json()` can no longer set a status or content type. So a route that publishes
 * progress MUST also finish in stream mode — `finishTurnWithProgress` does that, sending
 * the same object `res.json` would have as a final `result` frame. Never mix the two: a
 * half-streamed response that then calls `res.json` throws ERR_HTTP_HEADERS_SENT and the
 * client gets a truncated body with no error.
 *
 * ⚠️ Deliberately NOT a general SSE layer. It publishes progress for one route, and the
 * moment a second route needs it the right move is to lift `chatRoutes.js`'s existing
 * stream helper rather than grow this one.
 */

/** Header value a client sends to opt into progress frames. */
export const TURN_PROGRESS_ACCEPT = 'text/event-stream';

/**
 * Is this request asking for progress?
 *
 * Opt-in by `Accept`, because that is what the header is for and it means an old client —
 * or curl, or a test — keeps getting plain JSON with no coordination.
 */
export const wantsTurnProgress = (req) =>
  String(req?.headers?.accept || '').toLowerCase().includes(TURN_PROGRESS_ACCEPT);

/**
 * Open the progress channel on a response, or return null if the client did not ask.
 *
 * Returning null rather than a no-op object is deliberate: the caller's `if (channel)` is
 * then the single place that decides stream-vs-json, and there is no way to half-enter
 * stream mode by calling a method on a dummy.
 */
export function turnProgressChannel(req, res) {
  if (!wantsTurnProgress(req)) return null;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx buffers proxied responses by default, which would hold every frame until the
  // turn ended — the exact silence this exists to remove.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.locals = res.locals || {};
  res.locals.turnProgressOpen = true;
  return {
    /** Emit one progress frame. Best-effort: a dead socket must never fail the turn. */
    publish(event, data) {
      if (res.destroyed || res.writableEnded) return false;
      try {
        return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        return false;
      }
    },
  };
}

/**
 * Publish a loop progress record, if this response is in stream mode.
 *
 * Safe to call unconditionally from inside the tool loop — that is the point. The loop
 * does not need to know whether anyone is listening, and a non-streaming turn pays one
 * property read per event.
 *
 * The loop reports `{ phase: 'model' | 'search', iteration, query? }`; only the search
 * phases are forwarded, because "the model is thinking" is what the whole request already
 * communicates, while "searching X" is the information the user does not otherwise have.
 */
export function publishTurnProgress(res, progress) {
  if (!res?.locals?.turnProgressOpen) return;
  if (progress?.phase !== 'search') return;
  if (res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: search_start\ndata: ${JSON.stringify({
      query: progress.query,
      iteration: progress.iteration,
    })}\n\n`);
  } catch {
    /* a dead socket is not a reason to fail a turn the user paid for */
  }
}

/**
 * Publish one chunk of assistant text as it is generated.
 *
 * 🔴 Forwarded IMMEDIATELY, including on an iteration that will turn out to be a tool call:
 * models narrate before searching ("Let me check the current figures"), and that text is
 * part of the answer. Holding it until the turn resolves is what made a long turn feel dead.
 *
 * ⚠️ Deliberately NOT back-pressure aware. `res.write` returning false means the socket
 * buffer is full, and the honest fix is to await 'drain' — but this is called from inside a
 * metered upstream read, where pausing would hold a credit hold open on a slow client. A
 * dropped frame costs a repaint; a stalled read costs money. The final `result` frame
 * carries the complete text either way, so the client can always reconcile.
 */
export function publishTurnDelta(res, text) {
  if (!res?.locals?.turnProgressOpen) return;
  if (!text || res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
  } catch {
    /* a dead socket must never fail a turn the user is being billed for */
  }
}

/** Publish one chunk of reasoning, when the provider streams thinking separately. */
export function publishTurnReasoning(res, text) {
  if (!res?.locals?.turnProgressOpen) return;
  if (!text || res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: reasoning\ndata: ${JSON.stringify({ text })}\n\n`);
  } catch {
    /* as above */
  }
}

/**
 * Finish a turn that opened a progress channel.
 *
 * Sends exactly the object `res.json(...)` would have sent, as a terminal `result` frame,
 * so the client's two paths agree on the payload and only differ in transport.
 */
export function finishTurnWithProgress(res, payload) {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: result\ndata: ${JSON.stringify(payload)}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch {
    /* nothing further to do — the client is gone */
  }
  res.end();
}

/**
 * Report a failure on a response that already started streaming.
 *
 * 🔴 Once frames have been written the status code is already 200 and cannot be changed,
 * so an error MUST travel in-band. Falling through to `res.status(500).json(...)` here
 * throws ERR_HTTP_HEADERS_SENT and the client sees a truncated stream with no explanation
 * — strictly worse than the error it was trying to report.
 */
export function failTurnWithProgress(res, { code = 'generation_failed', message }) {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch {
    /* client gone */
  }
  res.end();
}

/**
 * Progress frames must never collide with the JSON response.
 *
 * `/api/chat/generate` answers with one JSON body. Search progress is now published as SSE
 * frames on that same response, which introduces exactly one new way to break it, and it is
 * a QUIET one:
 *
 * 🔴 Writing a frame sends the headers. From that moment `res.status(...).json(...)` cannot
 * set a status or a content type — it throws ERR_HTTP_HEADERS_SENT, Express logs it, and the
 * CLIENT gets a truncated body with no error and no status to react to. A turn that failed
 * looks, from the browser, exactly like a turn that is still running.
 *
 * So three things must hold, and none of them is visible by reading the happy path:
 *
 *   1. the channel opens BELOW every early-return validation (or a 400 becomes a hang)
 *   2. the success path finishes in stream mode when the channel is open
 *   3. the catch path reports IN BAND when the channel is open, and reads that fact off
 *      `res.locals` rather than a const scoped inside the `try`
 *
 * The helpers are pure enough to execute against a fake response, so most of this runs the
 * real code rather than matching text. Only the ordering rule (1) is a source assertion —
 * the route is a 900-line handler with a live database and an upstream call, and its
 * ordering is a property of the source, not of a value anything returns.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   move turnProgressChannel above the projectId 400   -> ordering test fails
 *   make publishTurnProgress ignore res.locals         -> opt-in test fails
 *   have the catch call res.status(500).json always    -> catch test fails
 *   drop the `phase === 'search'` filter               -> filter test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  turnProgressChannel,
  publishTurnProgress,
  finishTurnWithProgress,
  failTurnWithProgress,
  wantsTurnProgress,
} from '../src/server/utils/turnProgress.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'src', 'server', 'index.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A response that records everything written, and refuses what a real one would refuse. */
function fakeResponse({ accept } = {}) {
  const res = {
    written: [],
    headers: {},
    statusCode: null,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    locals: {},
    status(code) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      this.statusCode = code; return this;
    },
    setHeader(k, v) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      this.headers[k] = v;
    },
    flushHeaders() { this.headersSent = true; },
    write(chunk) { this.headersSent = true; this.written.push(chunk); return true; },
    json(body) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      this.body = body; this.writableEnded = true; return this;
    },
    end() { this.writableEnded = true; },
  };
  res.req = { headers: accept ? { accept } : {} };
  return res;
}

const frames = (res) => res.written.join('');

// ─── Opt-in ───────────────────────────────────────────────────────────────────────────

test('a client that did not ask gets NO channel and unchanged JSON', () => {
  const res = fakeResponse();
  const channel = turnProgressChannel({ headers: {} }, res);
  assert.equal(channel, null, 'no Accept header means no stream — an old client is untouched');
  assert.equal(res.headersSent, false, 'nothing may be written before the route decides');

  // The route then takes its normal path, which must still work.
  publishTurnProgress(res, { phase: 'search', query: 'q', iteration: 1 });
  assert.equal(res.written.length, 0, 'progress must be inert when no channel is open');
  res.status(200).json({ text: 'ok' });
  assert.deepEqual(res.body, { text: 'ok' });
});

test('Accept: text/event-stream opens the channel', () => {
  assert.equal(wantsTurnProgress({ headers: { accept: 'text/event-stream' } }), true);
  assert.equal(wantsTurnProgress({ headers: { accept: 'application/json' } }), false);
  assert.equal(wantsTurnProgress({ headers: {} }), false, 'absent header is not a stream request');
  // Real browsers send a list.
  assert.equal(
    wantsTurnProgress({ headers: { accept: 'text/event-stream, application/json;q=0.9' } }), true,
    'the header is a LIST — a strict equality check would miss every real client',
  );
});

test('the channel disables proxy buffering', () => {
  const res = fakeResponse();
  turnProgressChannel({ headers: { accept: 'text/event-stream' } }, res);
  assert.equal(
    res.headers['X-Accel-Buffering'], 'no',
    'nginx buffers proxied responses by default, which holds every frame until the turn ends ' +
    '— the exact silence this feature exists to remove',
  );
  assert.match(res.headers['Content-Type'], /text\/event-stream/);
});

// ─── Frames ───────────────────────────────────────────────────────────────────────────

test('🔴 only SEARCH phases are published', () => {
  const res = fakeResponse();
  turnProgressChannel({ headers: { accept: 'text/event-stream' } }, res);
  publishTurnProgress(res, { phase: 'model', iteration: 0 });
  assert.equal(res.written.length, 0,
    '"the model is thinking" is what the pending request already says; publishing it is noise');

  publishTurnProgress(res, { phase: 'search', iteration: 1, query: 'current xeno pricing' });
  assert.match(frames(res), /event: search_start/);
  assert.match(frames(res), /current xeno pricing/,
    'the QUERY is the information the user does not otherwise have — it is what makes a wait legible');
});

test('the terminal frame carries the SAME object res.json would have sent', () => {
  const res = fakeResponse();
  turnProgressChannel({ headers: { accept: 'text/event-stream' } }, res);
  const payload = { text: 'answer', searchInfo: { sources: [{ url: 'https://a.test' }] }, toolUse: { searches: 2 } };
  finishTurnWithProgress(res, payload);

  const result = frames(res).match(/event: result\ndata: (.+)\n/);
  assert.ok(result, 'a result frame must be sent');
  assert.deepEqual(
    JSON.parse(result[1]), payload,
    'the two transports must not disagree on the payload, or the client grows two parsers ' +
    'and one of them rots',
  );
  assert.match(frames(res), /data: \[DONE\]/, 'the stream must close with the sentinel');
  assert.equal(res.writableEnded, true);
});

test('🔴 a failure after frames have gone out is reported IN BAND', () => {
  const res = fakeResponse();
  turnProgressChannel({ headers: { accept: 'text/event-stream' } }, res);
  publishTurnProgress(res, { phase: 'search', iteration: 1, query: 'q' });

  // The real catch block would try res.status(500).json(...) — prove that now throws.
  assert.throws(() => res.status(500), /ERR_HTTP_HEADERS_SENT/,
    'once frames are written the status is already 200 and cannot be changed');

  failTurnWithProgress(res, { code: 'generation_failed', message: 'Failed to generate.' });
  assert.match(frames(res), /event: error/);
  assert.match(frames(res), /generation_failed/);
  assert.equal(res.writableEnded, true, 'a reported failure must close the stream');
});

test('a dead socket never throws into the turn', () => {
  const res = fakeResponse();
  turnProgressChannel({ headers: { accept: 'text/event-stream' } }, res);
  res.write = () => { throw new Error('EPIPE'); };
  // A client that closed the tab must not fail a turn that is still being billed.
  assert.doesNotThrow(() => publishTurnProgress(res, { phase: 'search', query: 'q', iteration: 1 }));
  assert.doesNotThrow(() => finishTurnWithProgress(res, { text: 'x' }));
  assert.doesNotThrow(() => failTurnWithProgress(res, { message: 'x' }));
});

// ─── The ordering rule, read out of the route ─────────────────────────────────────────

test('🔴 the channel opens BELOW every early-return validation', () => {
  const code = stripComments(SERVER);
  const openAt = code.indexOf('const progress = turnProgressChannel(req, res)');
  assert.ok(openAt > 0, 'the generate route must open a progress channel');

  /*
   * Each of these answers with a status BEFORE any generation happens. If the channel were
   * opened first, every one of them would throw ERR_HTTP_HEADERS_SENT and the client would
   * see a truncated stream instead of a 400 — a validation error presenting as a hang.
   */
  const mustPrecede = [
    "return res.status(400).json({ error: 'Project generation requires projectId and conversationId.' })",
    "return res.status(503).json({ error: 'Premium inference unavailable'",
    "return res.status(400).json({ error: 'Invalid request: messages array",
  ];
  for (const guard of mustPrecede) {
    const at = code.indexOf(guard);
    assert.ok(at > 0, `the guard must still exist: ${guard.slice(0, 60)}…`);
    assert.ok(
      at < openAt,
      `this refusal is emitted AFTER the progress channel opens, so res.status() throws and ` +
      `the client gets a truncated stream with no status: ${guard.slice(0, 60)}…`,
    );
  }
});

test('🔴 the catch reads res.locals, not a const scoped inside the try', () => {
  const code = stripComments(SERVER);
  const catchAt = code.indexOf("catch (error) {\n        console.error('Error in /api/chat/generate route:'");
  assert.ok(catchAt > 0, 'the generate catch block must exist');
  const block = code.slice(catchAt, catchAt + 900);

  assert.match(
    block, /res\.locals\?\.turnProgressOpen/,
    'the catch must read the response, not `progress`: that const is declared inside the try, ' +
    'so a throw from ABOVE its declaration leaves it undefined and the check silently fails ' +
    'open into res.status(500).json() — which then throws ERR_HTTP_HEADERS_SENT',
  );
  assert.match(block, /failTurnWithProgress/, 'a streamed turn must report its failure in band');
  assert.match(block, /res\.status\(500\)\.json/, 'a non-streamed turn must still answer 500 JSON');
});

test('the success path finishes in stream mode when the channel is open', () => {
  const code = stripComments(SERVER);
  assert.match(
    code, /if \(progress\) return finishTurnWithProgress\(res, finalResponse\);\s*\n\s*return res\.json\(finalResponse\);/,
    'both exits must send finalResponse — one as a frame, one as JSON. Calling res.json on a ' +
    'streamed response throws and truncates the answer the user already paid for.',
  );
});

/**
 * The streaming route must not invent sampling parameters.
 *
 * ## The live regression this pins, found 2026-09-14 by a user typing "hello"
 *
 * `/api/ai/chat/stream` defaulted `temperature = 0.7`. Claude Opus 5 refuses the parameter
 * outright:
 *
 *   400 unsupported_sampling_parameter
 *   "Claude Opus 5 does not support temperature. Remove temperature, top_p, and top_k."
 *
 * So EVERY turn on that model failed, and the user saw "The inference stream failed." on a
 * plain greeting. `/api/chat/generate` never had the defect because it sends no temperature
 * at all — the bug arrived with this route, and only for models that refuse the parameter.
 *
 * 🔴 `undefined` is the correct value, not a "safe" number. The field must be OMITTED from
 * the upstream body; a model that refuses the parameter refuses every value of it.
 * `JSON.stringify` drops undefined properties, which is what makes omission work — verified,
 * not assumed, because that is the whole mechanism.
 *
 * ⚠️ A caller that explicitly sends a temperature still gets it. This is about not INVENTING
 * one, not about refusing a deliberate choice: the route is also an API surface, and an
 * OpenAI-shaped client asking for 0.2 means it.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   restore `temperature = 0.7`   -> the default test fails
 *   restore `void error`          -> the logging test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const STREAM = (() => {
  const code = stripComments(ROUTE);
  const at = code.indexOf("router.post('/chat/stream'");
  assert.ok(at > 0, 'the streaming route must exist');
  return code.slice(at);
})();

test('🔴 the streaming route does NOT default a temperature', () => {
  const destructure = STREAM.slice(0, STREAM.indexOf('} = req.body'));
  assert.doesNotMatch(
    destructure, /temperature\s*=\s*[\d.]/,
    'a default temperature breaks every Claude Opus 5 turn with a 400 the user sees as ' +
    '"The inference stream failed." on a plain hello. The parameter must be OMITTED, not ' +
    'set to a safe-looking number — a model that refuses it refuses every value.',
  );
  assert.match(
    destructure, /\btemperature\b/,
    'it must still be READ, so an API caller that deliberately sends one gets it',
  );
});

test('an undefined temperature is omitted from the upstream body', () => {
  /*
   * The mechanism the fix relies on, executed rather than assumed: JSON.stringify drops
   * properties whose value is undefined. If that were not true, omitting the default would
   * send `"temperature": null` and the 400 would persist in a new disguise.
   */
  const body = JSON.parse(JSON.stringify({
    model: 'claude-opus-5', messages: [], temperature: undefined, max_tokens: 4096, stream: true,
  }));
  assert.equal('temperature' in body, false, 'the key must not reach the provider at all');
  assert.equal(body.max_tokens, 4096, 'and the rest of the body must be unaffected');
});

test('🔴 an upstream failure is LOGGED with its reason', () => {
  /*
   * This was `void error` — discarded. Every Opus 5 turn failed and the server logs said
   * NOTHING, so the cause had to be found by reproducing the call by hand inside the
   * container. Generic outward, specific inward: the client still gets the generic message,
   * because upstream errors can carry provider detail we do not forward.
   */
  const at = STREAM.indexOf('await settleBestEffort().catch(() => {});');
  assert.ok(at > 0, 'the mid-stream catch must exist');
  const block = STREAM.slice(at, at + 700);

  assert.doesNotMatch(
    block, /void error;/,
    'discarding the error leaves nobody able to see what broke — it cost a live diagnosis',
  );
  assert.match(block, /console\.error\('\[chat\/stream\] upstream failed'/, 'the reason must be logged');
  assert.match(block, /message: error\?\.message/, 'including the upstream message itself');
  assert.match(
    block, /message: 'The inference stream failed\.'/,
    'while the CLIENT still receives the generic message — upstream detail is not forwarded',
  );
});

test('the client is never sent the provider’s own error text', () => {
  const at = STREAM.indexOf("await send({ type: 'error'");
  assert.ok(at > 0);
  const sendCall = STREAM.slice(at, STREAM.indexOf('}', at) + 1);
  assert.doesNotMatch(
    sendCall, /error\?\.message|error\.message/,
    'forwarding the provider message leaks upstream detail to the browser',
  );
});

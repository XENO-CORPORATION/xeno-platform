/**
 * The `parts[]` → OpenAI conversion, extracted and pinned.
 *
 * ## Why this module exists, and why these tests came first
 *
 * This conversion lived inline in `/api/chat/generate` and NOWHERE ELSE. That is precisely
 * why `/api/ai/chat/stream` — a complete, metered, streaming endpoint — could not be used by
 * the product: it forwards `messages` upstream untouched, so pointing the chat client at it
 * would have silently dropped every image, PDF and text attachment. Not crashed. Dropped.
 *
 * 🔴 Extracting logic out of a working, live route is the dangerous half of making the
 * second one reachable. The route has no unit tests and runs against a database and an
 * upstream model, so "it still works" cannot be observed cheaply. These tests pin the
 * BEHAVIOUR first, so the extraction is checkable rather than hopeful — each rule below was
 * read out of the original inline code, not invented.
 *
 * Every rule here is load-bearing in a way that fails QUIETLY if broken:
 *   - an assistant turn replayed with its "Thinking Process:" scaffolding teaches the model
 *     to emit more of it — the answer still arrives, just worse
 *   - an image attached to an ASSISTANT message is rejected or mishandled by providers
 *   - a PDF that is not converted to a data URI simply never reaches the model
 *   - a single text part sent as a one-element array behaves differently on some providers
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   clean user text as well as assistant text   -> the "user words are never rewritten" test fails
 *   attach assistant images                     -> the assistant-image test fails
 *   always send content as an array             -> the string-content test fails
 *   drop the legacy `msg.text` branch           -> the legacy test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toProviderMessages,
  cleanAssistantText,
  cleanTextContent,
  looksLikePartsShape,
} from '../src/server/utils/chatMessageParts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const userText = (text) => ({ role: 'user', parts: [{ type: 'text', text }] });

// ─── Text ─────────────────────────────────────────────────────────────────────────────

test('🔴 a single text part is sent as a STRING, not a one-element array', () => {
  const out = toProviderMessages([userText('hello')]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }],
    'providers prefer a bare string for simple turns, and some treat a one-element array ' +
    'differently — this is the shape the live route has always sent');
});

test('🔴 USER text is never rewritten', () => {
  // The scaffolding markers are only meaningful in an ASSISTANT turn. A user who literally
  // types "Final Answer: 42" must reach the model with those words intact.
  const out = toProviderMessages([userText('Final Answer: 42')]);
  assert.equal(out[0].content, 'Final Answer: 42',
    'cleaning user text would silently edit what the person actually said');
});

test('🔴 ASSISTANT history is cleaned of reasoning scaffolding', () => {
  const out = toProviderMessages([
    { role: 'model', parts: [{ type: 'text', text: 'Thinking Process: weighing options\nFinal Answer: Paris' }] },
  ]);
  assert.equal(out[0].role, 'assistant', "the client's 'model' role maps to 'assistant'");
  assert.equal(out[0].content, 'Paris',
    'replaying scaffolding as history teaches the model to emit more of it — the answer ' +
    'still arrives, it just gets worse, which is why nothing surfaces this');
});

test('an assistant turn with thinking but NO final answer is dropped', () => {
  const out = toProviderMessages([
    { role: 'model', parts: [{ type: 'text', text: 'Thinking Process: still working' }] },
  ]);
  assert.deepEqual(out, [],
    'scaffolding with no conclusion is not history worth replaying');
});

test('a message that converts to nothing is dropped, not sent empty', () => {
  const out = toProviderMessages([{ role: 'user', parts: [{ type: 'text', text: '   ' }] }, userText('real')]);
  assert.deepEqual(out, [{ role: 'user', content: 'real' }],
    'an empty content array is a provider validation error');
});

// ─── Attachments ──────────────────────────────────────────────────────────────────────

test('🔴 a user image becomes an image_url data URI', () => {
  const out = toProviderMessages([{
    role: 'user',
    parts: [{ type: 'text', text: 'what is this' }, { type: 'image', media_type: 'image/png', data: 'AAAA' }],
  }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].content, [
    { type: 'text', text: 'what is this' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ], 'this is the single reason the streaming route could not be used — it forwards ' +
     'messages untouched, so the image would have vanished with no error');
});

test('🔴 an ASSISTANT image is NOT attached', () => {
  const out = toProviderMessages([
    { role: 'model', parts: [
      { type: 'text', text: 'here it is' },
      { type: 'image', media_type: 'image/png', data: 'AAAA' },
    ] },
  ]);
  assert.equal(out[0].content, 'here it is',
    'an image on an assistant turn is history of something the model PRODUCED, not an ' +
    'input; providers reject or mishandle it. The caller re-attaches it to the current ' +
    'user turn when the user refers to it.');
});

test('a PDF rides as an image_url data URI', () => {
  const out = toProviderMessages([{
    role: 'user',
    parts: [{ type: 'file', name: 'spec.pdf', media_type: 'application/pdf', data_type: 'base64', data: 'JVBER' }],
  }]);
  assert.deepEqual(out[0].content, [
    { type: 'image_url', image_url: { url: 'data:application/pdf;base64,JVBER' } },
  ], 'that is what the OpenRouter-fronted catalog accepts — it is not a mistake');
});

test('a text file becomes LABELLED text', () => {
  const out = toProviderMessages([{
    role: 'user',
    parts: [{ type: 'file', name: 'notes.md', media_type: 'text/markdown', data_type: 'text', data: 'line one' }],
  }]);
  assert.match(out[0].content, /Content of file "notes\.md"/,
    'the model must know it is reading a FILE rather than the user\'s own words');
  assert.match(out[0].content, /line one/);
});

test('an unreadable attachment is NAMED, never silently dropped', () => {
  const out = toProviderMessages([{
    role: 'user',
    parts: [
      { type: 'text', text: 'look at this' },
      { type: 'file', name: 'archive.zip', media_type: 'application/zip', data_type: 'base64', data: 'UEsD' },
    ],
  }]);
  const joined = JSON.stringify(out[0].content);
  assert.match(joined, /\[Attached file: archive\.zip/,
    'the model should know something was attached that it cannot read — silence makes it ' +
    'answer as though nothing was sent');
});

// ─── Compatibility ────────────────────────────────────────────────────────────────────

test('the legacy `msg.text` shape still converts', () => {
  const out = toProviderMessages([
    { role: 'user', text: 'older stored message' },
    { role: 'model', text: 'Final Answer: cleaned too' },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'older stored message' },
    { role: 'assistant', content: 'cleaned too' },
  ], 'conversations stored before parts[] must keep working');
});

test('a system prompt is prepended when given, absent when not', () => {
  assert.deepEqual(toProviderMessages([userText('hi')], { systemPrompt: 'You are XENO.' }), [
    { role: 'system', content: 'You are XENO.' },
    { role: 'user', content: 'hi' },
  ]);
  assert.equal(toProviderMessages([userText('hi')])[0].role, 'user', 'no prompt, no system turn');
  assert.equal(
    toProviderMessages([userText('hi')], { systemPrompt: '   ' })[0].role, 'user',
    'a blank prompt must not become an empty system message',
  );
});

test('malformed input does not throw', () => {
  // The route is reached by real clients and stored history; a bad row must not 500.
  assert.deepEqual(toProviderMessages(null), []);
  assert.deepEqual(toProviderMessages([null, undefined, {}, { role: 'user' }]), []);
  assert.deepEqual(toProviderMessages([{ role: 'user', parts: [null, { type: 'image' }] }]), []);
});

test('the shape detector distinguishes the two message formats', () => {
  assert.equal(looksLikePartsShape([userText('x')]), true);
  assert.equal(looksLikePartsShape([{ role: 'user', content: 'x' }]), false,
    'already-OpenAI messages must not be re-converted');
  assert.equal(looksLikePartsShape(null), false);
});

test('the text cleaners are exported and behave', () => {
  assert.equal(cleanTextContent('a\n\n\n\nb'), 'a\n\nb', 'excess blank lines collapse');
  assert.equal(cleanTextContent(''), '');
  assert.equal(cleanTextContent(null), '');
  assert.equal(cleanAssistantText('no markers here').answer, 'no markers here',
    'text with no scaffolding passes through unchanged');
});

// ─── Both routes use ONE implementation ───────────────────────────────────────────────

test('🔴 the streaming route converts parts[], so attachments survive it', () => {
  /*
   * THE BLOCKER THIS CLOSES. /api/ai/chat/stream forwarded `messages` upstream untouched,
   * so pointing the chat client at it would have dropped every image, PDF and text file —
   * silently, with a plausible answer still coming back about a picture the model never saw.
   *
   * Asserted on SOURCE because the route is an SSE handler with a live database, a credit
   * hold and an upstream call. What matters is that it calls the SHARED converter and does
   * it before the messages are used, which is a property of the code, not of a return value.
   */
  const route = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');
  const stripped = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(
    stripped, /import \{[^}]*toProviderMessages[^}]*\} from '\.\.\/utils\/chatMessageParts\.js'/,
    'the streaming route must IMPORT the shared converter — a second copy of these rules ' +
    'would disagree with /api/chat/generate invisibly, since both still return an answer',
  );
  /*
   * ⚠️ Matches the CONVERSION, not the exact prompt variable.
   *
   * The first version pinned `{ systemPrompt }` literally and broke when project context
   * landed and the argument became `{ systemPrompt: effectiveSystemPrompt }` — the project's
   * instructions have to ride on that prompt. The conversion was untouched; only the name
   * changed. A gate that pins an identifier fails on a rename and says nothing about whether
   * the behaviour survived, which is the opposite of useful.
   */
  assert.match(
    stripped, /const finalMessages = looksLikePartsShape\(messages\)\s*\?\s*toProviderMessages\(messages, \{ systemPrompt[^}]*\}\)/,
    'finalMessages must be CONVERTED when the client sends parts[] — this is the single ' +
    'reason the route was unusable by the product',
  );
  /*
   * And an OpenAI-shaped caller must still pass through untouched.
   *
   * ⚠️ Matches the SHAPE, not the identifier — same lesson as above. This pinned
   * `systemPrompt` by name and broke when project context renamed it to
   * `effectiveSystemPrompt`; the passthrough itself never changed. What matters is that the
   * false branch spreads `...messages` rather than converting them.
   */
  assert.match(
    stripped, /:\s*\(\w+\s*\?\s*\[\{ role: 'system', content: \w+ \}, \.\.\.messages\]\s*:\s*messages\)/,
    'API clients already sending OpenAI messages must not be re-converted',
  );
});

test('🔴 /api/chat/generate uses the SAME converter, not a copy', () => {
  const server = readFileSync(join(ROOT, 'src', 'server', 'index.js'), 'utf8');
  const stripped = server.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(stripped, /import \{ toProviderMessages \} from '\.\/utils\/chatMessageParts\.js'/);
  assert.match(stripped, /apiMessages\.push\(\.\.\.toProviderMessages\(messages\)\)/);

  /*
   * ⚠️ And the inline版 must be GONE, not merely bypassed. A leftover copy is the thing
   * that goes stale — it keeps compiling, keeps looking authoritative, and diverges the
   * moment one of the two is edited. `parseResponseBackend` was its entry point.
   */
  assert.doesNotMatch(
    stripped, /const parseResponseBackend = /,
    'the extracted function must not also remain here — two copies of rules that have ' +
    'MOVED is exactly how they drift apart',
  );
  assert.doesNotMatch(
    stripped, /contentParts\.push\(\{\s*type: 'image_url'/,
    'the inline parts[] conversion must be gone, not left beside the module',
  );
});

/**
 * tiktoken WASM encodings are not GC'd. Caching one encoder per modelId
 * (dqbd/tiktoken#35) irrecoverably crashes Node after ~188 allocations —
 * nginx then 502s Cloudflare HTML onto /api/tokenize/messages.
 *
 * Source-only. A revert to encodingCache.set(modelId, …) fails this gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = readFileSync(join(ROOT, 'src', 'server', 'routes', 'tokenizerRoutes.js'), 'utf8');
const CHAT = readFileSync(
  join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx'),
  'utf8',
);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function extractFrom(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return '';
  const from = src.slice(start);
  const brace = from.indexOf('{');
  if (brace === -1) return from.slice(0, 4000);
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = brace; i < from.length; i++) {
    const c = from[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return from.slice(0, i + 1);
    }
  }
  return from.slice(0, 4000);
}

test('the cache is keyed by family, never by the raw modelId', () => {
  const src = codeOnly(ROUTES);
  assert.doesNotMatch(
    src,
    /encodingCache\.set\(\s*modelId/,
    'cache is keyed by modelId — that is the tiktoken#35 crash',
  );
  const set = extractFrom(src, 'function getEncodingForFamily');
  assert.match(set, /encodingCache\.set\(\s*family/, 'getEncodingForFamily must cache by family');
  const family = extractFrom(src, 'function encodingFamilyFor');
  assert.match(family, /gpt-4/, 'gpt-4 family is missing');
  assert.match(family, /gpt-3\.5/, 'gpt-3.5 family is missing');
  assert.match(family, /ENCODING_FAMILY\.CL100K/, 'cl100k_base family is missing');
  assert.match(src, /CL100K:\s*['"]cl100k_base['"]/, 'CL100K is not cl100k_base');
});

test('encoding_for_model is only called with the two literal family names', () => {
  const src = codeOnly(ROUTES);
  const calls = [...src.matchAll(/encoding_for_model\(([^)]+)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 2, 'encoding_for_model is never called');
  for (const arg of calls) {
    assert.match(
      arg,
      /^['"]gpt-4['"]$|^['"]gpt-3\.5-turbo['"]$/,
      `encoding_for_model(${arg}) is not a family literal — that allocates per modelId`,
    );
  }
  assert.doesNotMatch(
    src,
    /encoding_for_model\(\s*modelId/,
    'encoding_for_model(modelId) is the leak',
  );
});

test('an encode failure evicts, frees the stale instance, and retries once', () => {
  const src = codeOnly(ROUTES);
  const encode = extractFrom(src, 'function encodeText');
  const recreate = extractFrom(src, 'function recreateEncoding');
  assert.match(encode, /recreateEncoding/, 'encodeText never recovers a dead encoding');
  assert.match(recreate, /encodingCache\.delete/, 'recreateEncoding never evicts the stale entry');
  assert.match(recreate, /\.free\(\)/, 'recreateEncoding never free()s — WASM stays allocated');
  assert.doesNotMatch(
    encode,
    /\.free\(\)/,
    'encodeText free()s the live encoding — tiktoken#69 (null pointer on reuse)',
  );
});

test('payloads over MAX_TOKENIZE_CHARS are 413, not loaded into WASM', () => {
  const src = codeOnly(ROUTES);
  assert.match(src, /MAX_TOKENIZE_CHARS\s*=\s*200_000/, 'the size cap is missing or changed');
  const reject = extractFrom(src, 'function rejectIfTooLarge');
  assert.match(reject, /status\(413\)/, 'oversize must be 413, not 500');
  assert.match(reject, /tokenize_payload_too_large/, 'oversize must name its code');
  const count = extractFrom(src, "router.post('/count'");
  const messages = extractFrom(src, "router.post('/messages'");
  assert.match(count, /rejectIfTooLarge/, 'POST /count never checks size');
  assert.match(messages, /rejectIfTooLarge/, 'POST /messages never checks size');
});

test('ChatWithLLM token-count effect hits /messages once, not twice', () => {
  const start = CHAT.indexOf('// --- Real token count via API (debounced) ---');
  assert.ok(start !== -1, 'token-count effect marker is missing');
  const slice = CHAT.slice(start, start + 2500);
  const calls = [...slice.matchAll(/countMessageTokens\s*\(/g)];
  assert.equal(
    calls.length,
    1,
    `token-count effect calls countMessageTokens ${calls.length} times — a second hit after 502 is the 1 Hz storm`,
  );
});

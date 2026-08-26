/**
 * Cloudflare 502 pages are HTML. response.json() throws SyntaxError
 * ("Unexpected token '<'") and the UI reports a parse failure instead of 502.
 *
 * These three clients must read text first, then JSON.parse, and name
 * Non-JSON so a revert to response.json() fails this gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function assertTextThenJson(src, label) {
  assert.match(src, /\.text\(\)/, `${label} never reads the body as text`);
  assert.match(src, /JSON\.parse\(/, `${label} never JSON.parse()s the text body`);
  assert.match(
    src,
    /Non-JSON/,
    `${label} must name Non-JSON so Cloudflare HTML cannot look like a parse bug`,
  );
  assert.doesNotMatch(
    src,
    /\.json\(\)/,
    `${label} still calls .json() — a 502 HTML page becomes SyntaxError`,
  );
}

test('chatService handleResponse cannot SyntaxError on Cloudflare HTML', () => {
  const src = codeOnly(readFileSync(join(ROOT, 'src', 'services', 'chatService.ts'), 'utf8'));
  const start = src.indexOf('const handleResponse = async');
  const end = src.indexOf('export const isPersistedConversationId') !== -1
    ? src.indexOf('export const chatService')
    : src.indexOf('export const chatService');
  assert.ok(start !== -1 && end !== -1 && end > start, 'handleResponse is missing');
  assertTextThenJson(src.slice(start, end), 'handleResponse');
});

test('accountService apiFetch cannot SyntaxError on Cloudflare HTML', () => {
  const src = codeOnly(readFileSync(join(ROOT, 'src', 'services', 'accountService.ts'), 'utf8'));
  const start = src.indexOf('const apiFetch = async');
  const end = src.indexOf('export const getAccountOverview');
  assert.ok(start !== -1 && end !== -1 && end > start, 'apiFetch is missing');
  assertTextThenJson(src.slice(start, end), 'apiFetch');
});

test('tokenizerService cannot SyntaxError on Cloudflare HTML', () => {
  const src = codeOnly(readFileSync(join(ROOT, 'src', 'services', 'tokenizerService.ts'), 'utf8'));
  const start = src.indexOf('async function parseTokenizerJson');
  assert.ok(start !== -1, 'parseTokenizerJson is missing');
  const slice = src.slice(start, start + 800);
  assertTextThenJson(slice, 'parseTokenizerJson');
  assert.doesNotMatch(
    src,
    /response\.json\(\)/,
    'tokenizerService still has a response.json() path',
  );
});

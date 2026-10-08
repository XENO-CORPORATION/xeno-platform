// The global error handler must not log a body-parser rejection by its stack: a JSON syntax
// error quotes the text it could not parse, so a malformed refresh token would reach the log
// in fragments. The helper is tested directly, and a source gate proves index.js calls it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeRequestError } from '../utils/requestErrorLog.js';

// Shaped like the error body-parser raises for a malformed JSON body: the message quotes the text.
const FRAGMENT = 'RT_FAKE_01';
const parseError = Object.assign(
  new SyntaxError(`Unexpected token 'R', "${FRAGMENT}" is not valid JSON`),
  { type: 'entity.parse.failed', status: 400, statusCode: 400 },
);

test('a body-parser rejection is logged by kind and status, never by its message or stack', () => {
  const logged = describeRequestError(parseError);
  assert.equal(logged.includes(FRAGMENT), false, 'the request body reached the log');
  assert.equal(logged.includes('entity.parse.failed'), true, 'the kind is lost');
  assert.equal(logged.includes('400'), true, 'the status is lost');
});

test('every other error keeps its stack, as the handler always logged it', () => {
  const other = new Error('database unreachable');
  assert.equal(describeRequestError(other), other.stack);
});

test('an error with no stack falls back to its message', () => {
  assert.equal(describeRequestError(Object.assign(new Error('plain'), { stack: undefined })), 'plain');
});

test('index.js logs the global error handler through describeRequestError, not err.stack', () => {
  const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');
  const start = source.indexOf('GLOBAL ERROR HANDLER');
  const end = source.indexOf('GRACEFUL SHUTDOWN');
  assert.ok(start > 0 && end > start, 'the global error handler section was not found');
  const handler = source.slice(start, end);
  assert.match(handler, /console\.error\('\[Global Error Handler\]', describeRequestError\(err\)\)/);
  assert.doesNotMatch(handler, /err\.stack/, 'the handler still logs a stack');
});

/**
 * The chat-sandbox object-store namespace is confined, and the artifacts namespace still works.
 *
 * chat_sandbox files reuse artifactStorage's R2/fs backend under `chat-sandboxes/<uuid>/<path>`
 * (CHAT-CODE-EXECUTION-SPEC.md §6). The key gate is security-relevant: it is the only thing stopping
 * one sandbox from addressing another sandbox, the artifacts namespace, or a path outside its dir.
 *
 * Source/pure, no network. Mutation-checked: remove the SANDBOX_KEY_PATTERN branch in
 * artifactStorage.assertKey and the "a sandbox key is accepted" case fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { _internal } from '../src/server/services/artifactStorage.js';

const { assertKey } = _internal;
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const ok = (k) => assert.doesNotThrow(() => assertKey(k), `expected accepted: ${k}`);
const bad = (k) => assert.throws(() => assertKey(k), `expected refused: ${k}`);

test('a chat-sandbox key (with subdirs and spaces) is accepted', () => {
  ok(`chat-sandboxes/${UUID}/out.txt`);
  ok(`chat-sandboxes/${UUID}/nested/dir/result.json`);
  ok(`chat-sandboxes/${UUID}/My Report.csv`);
});

test('the artifacts namespace still works (no regression)', () => {
  ok('artifacts/abc-123/r1/thing.bin');
});

test('a sandbox key cannot traverse, double-slash, or leave its uuid dir', () => {
  bad(`chat-sandboxes/${UUID}/../${UUID}/steal.txt`);
  bad(`chat-sandboxes/${UUID}//x.txt`);
  bad(`chat-sandboxes/${UUID}/a/../../escape.txt`);
});

test('keys outside any namespace are refused', () => {
  bad('chat-sandboxes/not-a-uuid/x.txt');
  bad('chat-sandboxes//x.txt');
  bad('secrets/leak.txt');
  bad(`../chat-sandboxes/${UUID}/x.txt`);
  bad('');
});

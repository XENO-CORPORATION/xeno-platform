/**
 * `chat_messages.turn` is client-written, so the server validates and BOUNDS it — and refuses
 * rather than trims. These pin the validator and its reachability from both insert routes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeTurnRecord, turnCodeAssetIds, TURN_LIMITS, TURN_SCHEMA } from '../src/server/utils/chatTurnRecord.js';

const good = () => ({
  schema: TURN_SCHEMA,
  startedAt: 1000,
  endedAt: 5000,
  thinkingMs: 1200,
  steps: [
    { id: 'search-1', kind: 'search', query: 'xeno hub', startedAt: 1100, endedAt: 2000, count: 2, sources: [{ url: 'https://xenostudio.ai/product/hub', title: 'Hub' }] },
    { id: 'search-2', kind: 'search', query: 'again', startedAt: 2100, endedAt: 2600, error: 'That search could not be completed.' },
  ],
});

test('absent is fine; a valid record comes back canonical', () => {
  assert.deepEqual(normalizeTurnRecord(undefined), { ok: true, turn: null });
  assert.deepEqual(normalizeTurnRecord(null), { ok: true, turn: null });
  const r = normalizeTurnRecord({ ...good(), extra: 'dropped' });
  assert.equal(r.ok, true);
  assert.equal(r.turn.extra, undefined, 'unknown keys never reach the row');
  assert.equal(r.turn.steps.length, 2);
  assert.equal(r.turn.steps[0].sources[0].url, 'https://xenostudio.ai/product/hub');
});

test('the wrong schema, a bad clock, an unknown step kind, an http source — each is refused, not trimmed', () => {
  assert.equal(normalizeTurnRecord({ ...good(), schema: 'nope' }).ok, false);
  assert.equal(normalizeTurnRecord({ ...good(), endedAt: 10 }).ok, false, 'endedAt before startedAt');
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...good().steps[0], kind: 'shell' }] }).ok, false);
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...good().steps[0], sources: [{ url: 'http://x.example/' }] }] }).ok, false);
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...good().steps[0], id: 'a' }, { ...good().steps[1], id: 'a' }] }).ok, false, 'duplicate ids');
  assert.equal(normalizeTurnRecord('a string').ok, false);
});

test('the lists are capped — a client cannot store an unbounded blob under a presentational column', () => {
  const many = { ...good(), steps: Array.from({ length: TURN_LIMITS.steps + 1 }, (_, i) => ({ id: `s${i}`, kind: 'search', query: 'q', startedAt: 1 + i })) };
  assert.equal(normalizeTurnRecord(many).ok, false);
  const wide = { ...good(), steps: [{ id: 's', kind: 'search', query: 'q', startedAt: 1, sources: Array.from({ length: TURN_LIMITS.sourcesPerStep + 1 }, (_, i) => ({ url: `https://x.example/${i}` })) }] };
  assert.equal(normalizeTurnRecord(wide).ok, false);
  const long = { ...good(), steps: [{ id: 's', kind: 'search', query: 'q'.repeat(TURN_LIMITS.text + 1), startedAt: 1 }] };
  assert.equal(normalizeTurnRecord(long).ok, false);
});

test('both insert routes validate the record before the row, and store it in the same column', () => {
  const routes = readFileSync(new URL('../src/server/routes/chatRoutes.js', import.meta.url), 'utf8');
  assert.equal((routes.match(/normalizeTurnRecord\(/g) || []).length, 2, 'single message + batch');
  assert.match(routes, /code: 'invalid_turn'/);
  assert.equal((routes.match(/message_index, turn\b/g) || []).length, 2, 'both INSERTs name the column');
  assert.match(routes, /ADD COLUMN IF NOT EXISTS turn JSONB/, 'a fresh database has the column too');
  const migration = readFileSync(new URL('../src/server/database/migrations/20260917120000-chat-message-turn.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS turn JSONB/);
});

const goodCode = () => ({
  id: 'code-1', kind: 'code', language: 'python', code: 'print(1)', startedAt: 1100, endedAt: 2000,
  status: 'success', exitCode: 0, stdout: 'ok', stderr: '',
  files: [{ path: 'out.csv', assetId: '11111111-2222-3333-4444-555555555555' }],
});

test('a code step is validated, bounded and read back — a run the person watched, never the bytes', () => {
  const r = normalizeTurnRecord({ ...good(), steps: [goodCode()] });
  assert.equal(r.ok, true);
  assert.equal(r.turn.steps[0].kind, 'code');
  assert.equal(r.turn.steps[0].language, 'python');
  assert.equal(r.turn.steps[0].exitCode, 0);
  assert.equal(r.turn.steps[0].files[0].assetId, '11111111-2222-3333-4444-555555555555');
  // the produced files are library asset ids the retention sweep can find
  assert.deepEqual([...turnCodeAssetIds(r.turn)], ['11111111-2222-3333-4444-555555555555']);
  // a killed run with a null exit is legal
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), status: 'killed', exitCode: null }] }).ok, true);
});

test('a bad code step is refused, not trimmed — language, size, exit range, status and asset id are all checked', () => {
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), language: 'brainfuck' }] }).ok, false, 'unknown language');
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), code: 'x'.repeat(8001) }] }).ok, false, 'code over cap');
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), exitCode: 99999 }] }).ok, false, 'exit out of range');
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), status: 'exploded' }] }).ok, false, 'unknown status');
  assert.equal(normalizeTurnRecord({ ...good(), steps: [{ ...goodCode(), files: [{ path: 'x', assetId: 'not-a-uuid' }] }] }).ok, false, 'file asset must be a library id');
  const wideFiles = { ...goodCode(), files: Array.from({ length: 33 }, (_, i) => ({ path: `f${i}` })) };
  assert.equal(normalizeTurnRecord({ ...good(), steps: [wideFiles] }).ok, false, 'files list is capped');
});

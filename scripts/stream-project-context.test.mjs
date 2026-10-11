/**
 * Project context on the streaming route: grounding, and the audit record.
 *
 * ## What this protects
 *
 * A project-backed conversation grounds its answer in the project's own documents and RECORDS
 * which sources were in context. A route that skips it answers project questions from the
 * model's own knowledge — no sources, no record, confidently wrong, and nothing in the trail
 * to show it happened. The turn still answers, which is why nothing would surface the loss.
 *
 * ## 🔴 The guard shape that caused a live outage on the sibling route
 *
 * `/api/chat/generate` once opened its project branch as `if (projectId || conversationId)`
 * with an inner `if (!projectId || !conversationId)` — OR to enter, AND to stay. Every
 * ordinary saved chat carries a conversationId and no projectId, so EVERY one was refused
 * with a 400. Measured live at the time: 3 requests, 3 refusals, zero successes.
 *
 * The streaming route must not reproduce it. Gate on `projectId` alone; refuse a project with
 * no conversation, because `chat_generation_contexts.conversation_id` is NOT NULL and there
 * is literally nowhere to record such a turn.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   restore `(projectId || conversationId)`        -> the ordinary-chat test fails
 *   drop the conversation-less refusal             -> the refusal test fails
 *   make the audit close throw instead of logging  -> the billed-turn test fails
 *   drop projectContextId from the result frame    -> the linkage test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProjectContextTurn, closeProjectContextTurn } from '../src/server/utils/projectContextTurn.js';
import { buildUntrustedProjectDataMessage } from '../src/server/services/chatProjectPrompt.js';
import { toProviderMessages, looksLikePartsShape } from '../src/server/utils/chatMessageParts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const STREAM = (() => {
  const code = stripComments(ROUTE);
  const at = code.indexOf("router.post('/chat/stream'");
  assert.ok(at > 0, 'the streaming route must exist');
  return code.slice(at);
})();

/** A fake pg pool that records what it was asked to do. */
function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };
}

const messages = [{ role: 'user', parts: [{ type: 'text', text: 'what does the spec say' }] }];
const assemble = async () => ({
  instructions: 'Use the project sources.',
  manifest: { sources: [{ id: 's1', title: 'Spec' }] },
});

// ─── The guard, read out of the route ─────────────────────────────────────────────────

test('🔴 an ordinary saved chat is NOT treated as a project turn', () => {
  const at = STREAM.indexOf('if (projectId) {');
  assert.ok(
    at > 0,
    'the project branch must gate on projectId ALONE. `(projectId || conversationId)` refuses ' +
    'every ordinary saved chat — the client sends a conversationId for all of them — which is ' +
    'exactly the 400 that took /api/chat/generate down.',
  );
  const branch = STREAM.slice(at, at + 400);
  assert.match(
    branch, /if \(!conversationId\) \{/,
    'inside the branch, the refusal is for a MISSING CONVERSATION, not a re-test of the project',
  );
});

test('a project with no conversation is refused, and says why', () => {
  const at = STREAM.indexOf('if (projectId) {');
  const branch = STREAM.slice(at, at + 400);
  assert.match(branch, /status\(400\)/, 'it must refuse, not proceed');
  assert.match(
    branch, /Project generation requires projectId and conversationId/,
    'chat_generation_contexts.conversation_id is NOT NULL — a project turn has nowhere to ' +
    'record itself without one, so this refusal trades a 400 for a 500',
  );
});

test('the refusal happens BEFORE any SSE frame is written', () => {
  const guardAt = STREAM.indexOf('if (projectId) {');
  const sseAt = STREAM.indexOf("res.setHeader('Content-Type', 'text/event-stream");
  assert.ok(guardAt > 0 && sseAt > 0, 'both the guard and the SSE switch must exist');
  assert.ok(
    guardAt < sseAt,
    'once a frame is written the status is 200 and res.status() throws — a validation error ' +
    'would reach the client as a truncated stream with no status at all',
  );
});

// ─── The module, executed ─────────────────────────────────────────────────────────────

test('opening a turn records the context and returns its id', async () => {
  const db = fakeDb();
  const opened = await openProjectContextTurn({
    db, userId: 'u1', projectId: 'p1', conversationId: 'c1',
    messages, selectedModelId: 'openai/gpt-5.5', assemble,
  });

  assert.ok(opened.recordId, 'a record id is what links an answer back to its sources');
  assert.ok(opened.requestHash, 'the hash pins the exact inputs');
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO chat_generation_contexts/);
  assert.equal(db.calls[0].params[1], 'c1', 'the conversation is recorded');
  assert.equal(db.calls[0].params[2], 'p1', 'the project is recorded');
});

test('🔴 the request hash covers the whole turn, not just the query', async () => {
  const db = fakeDb();
  const base = { db, userId: 'u1', projectId: 'p1', conversationId: 'c1', selectedModelId: 'm', assemble };
  const a = await openProjectContextTurn({ ...base, messages });
  const b = await openProjectContextTurn({
    ...base,
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'what does the spec say' }] },
      { role: 'model', parts: [{ type: 'text', text: 'earlier reply' }] },
    ],
  });
  assert.notEqual(
    a.requestHash, b.requestHash,
    'two different conversations that happen to end with the same question must not produce ' +
    'the same hash — the close keys on it',
  );
});

test('🔴 the close can only complete its own row, and only once', async () => {
  const db = fakeDb();
  await closeProjectContextTurn({ db, recordId: 'r1', requestHash: 'h1', responseText: 'the answer' });
  const sql = db.calls[0].sql;
  assert.match(sql, /UPDATE chat_generation_contexts SET response_hash/);
  assert.match(
    sql, /WHERE id=\$1 AND request_hash=\$3 AND response_hash IS NULL/,
    'without the NULL check a retry silently rewrites the recorded answer for a turn that ' +
    'already settled — precisely what an audit trail exists to make impossible',
  );
});

test('🔴 a failed audit close does not fail a turn the user was already billed for', () => {
  const at = STREAM.indexOf('closeProjectContextTurn({');
  assert.ok(at > 0, 'the streaming route must close the record it opened');
  const block = STREAM.slice(at, at + 500);
  assert.match(
    block, /\.catch\(/,
    'the answer has been generated, streamed and BILLED by this point. Throwing here hands ' +
    'the user an error for a turn they already received and paid for; the row stays open, ' +
    'which is honest information rather than corruption.',
  );
});

test('the result frame carries the linkage back to the sources', () => {
  assert.match(
    STREAM, /projectContextId: projectContextRecordId/,
    'without the id a client cannot link an answer to the sources that produced it',
  );
  assert.match(
    STREAM, /projectSources: projectContext\.manifest\.sources/,
    'the sources themselves are what the UI renders under a project answer',
  );
});

test('retrieved project data reaches streamed model messages before token estimation', () => {
  const start = STREAM.indexOf('const finalMessages =');
  const end = STREAM.indexOf('const reqIdSeed', start);
  assert.ok(start > 0 && end > start);
  const build = new Function('messages', 'effectiveSystemPrompt', 'projectContext',
    'looksLikePartsShape', 'toProviderMessages', 'buildUntrustedProjectDataMessage',
    STREAM.slice(start, end) + '\nreturn finalMessages;');
  const projectContext = { contentBlocks: [{ content: 'PROJECT_FILE_SENTINEL: the release date is October 20.' }] };
  for (const input of [messages, [{ role: 'user', content: 'what does the spec say' }]]) {
    const before = JSON.stringify(input);
    const result = build(input, 'Use project sources.', projectContext,
      looksLikePartsShape, toProviderMessages, buildUntrustedProjectDataMessage);
    assert.equal(result[0].role, 'system');
    assert.deepEqual(result[1], buildUntrustedProjectDataMessage(projectContext.contentBlocks),
      'use the canonical untrusted-data wrapper, matching non-streamed turns');
    assert.match(JSON.stringify(result[1]), /PROJECT_FILE_SENTINEL/);
    assert.equal(JSON.stringify(input), before, 'message injection must not mutate request history');
  }
  assert.ok(end < STREAM.indexOf('estimateMessageTokens(finalMessages)', end));
});

test('project grounding validates persisted conversation ownership before retrieving files', async () => {
  const source = readFileSync(join(ROOT, 'src/server/services/chatProjectContext.js'), 'utf8');
  const start = source.indexOf('  const conversation =');
  const end = source.indexOf('  const project =', start);
  assert.ok(start > 0 && end > start);
  const guard = new Function('db', 'conversationId', 'projectId',
    'return (async () => {' + source.slice(start, end) + '})();');
  const db = (projectId) => ({ query: async () => ({ rows: [{ project_id: projectId }] }) });
  await guard(db('p1'), 'c1', 'p1');
  await assert.rejects(guard(db('p2'), 'c1', 'p1'), { code: 'project_conversation_mismatch' });
  await assert.rejects(guard({ query: async () => ({ rows: [] }) }, 'c1', 'p1'), { code: 'project_conversation_mismatch' });
  assert.ok(end < source.indexOf('await retrieveAuthorizedAssetChunks'));
});

test('project instructions carry persisted project identity even with no matching files', () => {
  const source = readFileSync(join(ROOT, 'src/server/services/chatProjectContext.js'), 'utf8');
  const start = source.indexOf('  return {');
  assert.ok(start > 0);
  const result = new Function('project', 'conversationId', 'contentBlocks', 'manifest',
    source.slice(start, source.lastIndexOf('}')))(
      { id: 'p1', name: 'Aetherwyn', description: 'Build the world', custom_instructions: '', instructions_revision: 1 },
      'c1', [], {});
  assert.match(result.instructions, /Aetherwyn/);
  assert.match(result.instructions, /Build the world/);
  assert.match(result.instructions, /"project_id":"p1"/);
});

test('project read tools exclude denied conversations, files and schedules', async () => {
  const source = readFileSync(join(ROOT, 'src/server/services/chatProjectKnowledge.js'), 'utf8');
  const body = source.slice(source.indexOf('export async function readProjectKnowledge')).replace('export ', '');
  const read = new Function('check', 'activePath', 'requireResourceRelation', 'retrieveAuthorizedAssetChunks', 'listTasks', 'activity', 'resolvePrincipal', 'PROJECT_READ_TOOL',
    body + '\nreturn readProjectKnowledge;')(
      async (_db, request) => ({ allowed: !request.object.endsWith(':denied') }),
      () => [], async () => {}, async () => ({ chunks: [], diagnostic: {} }),
      async () => [], async () => ({}), async () => ({ id: 'u1', usable: true, kind: 'human' }), {});
  const seen = [];
  const db = { query: async (sql, params) => {
    seen.push({ sql, params });
    return sql.startsWith('SELECT project_id')
      ? { rows: [{ project_id: 'p1' }] }
      : { rows: [{ id: 'allowed', name: 'visible' }, { id: 'denied', name: 'PRIVATE_SENTINEL' }] };
  } };
  for (const section of ['conversations', 'files', 'schedules']) {
    const result = await read({ db, principal: { type: 'user', id: 'u1' }, projectId: 'p1', conversationId: 'c1', args: { section } });
    assert.deepEqual(result.items.map((item) => item.id), ['allowed']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
    assert.ok(seen.some((call) => call.params.includes('p1')));
  }
  await assert.rejects(read({ db: { query: async () => ({ rows: [{ project_id: 'p2' }] }) }, principal: { type: 'user', id: 'u1' }, projectId: 'p1', conversationId: 'c1', args: { section: 'files' } }), /project_conversation_mismatch/);
});

test('project instructions reach the model via the system prompt', () => {
  assert.match(
    STREAM, /effectiveSystemPrompt/,
    'assembling context and then not sending it is the failure that looks most like success',
  );
  assert.match(STREAM, /projectContext\.instructions/);
});

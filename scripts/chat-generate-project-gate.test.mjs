/**
 * A plain saved chat must be able to generate.
 *
 * ## The defect this pins, measured live
 *
 * `/api/chat/generate` opened its project branch as:
 *
 *     if (projectId || conversationId) {
 *         if (!projectId || !conversationId) return 400 'Project generation requires ...'
 *
 * OR to enter, AND to stay. So **every** request carrying a `conversationId` without a
 * `projectId` was refused — and that is the ordinary case: `ChatWithLLM.tsx` sends
 * `conversationId` for every persisted conversation and `projectId` only for the
 * project-backed ones. A user typing "hello" in a saved chat got
 * `Error: Project generation requires projectId and conversationId.`
 *
 * Introduced by 499b527 (2026-08-29, "make projects persistent and semantically grounded").
 * On the running container after the 11:20 restart: 3 requests to this route, 3× 400,
 * zero 200s. 8 of 10 `chat_conversations` rows have `project_id IS NULL`; 2 distinct users.
 *
 * ## What must stay true
 *
 * 1. A bare `conversationId` reaches generation — no 400, no project context assembled.
 * 2. A `projectId` without a `conversationId` is STILL refused. Project context is recorded
 *    into `chat_generation_contexts`, whose `conversation_id` is `UUID NOT NULL`, so there is
 *    literally nowhere to put it. Relaxing this half would trade a 400 for a 500.
 * 3. The project path is still entered when a project IS named.
 *
 * Source-only, like the sibling chat gates: the handler is 2,000 lines inside an Express app
 * with a live database and an upstream inference call, so the branch is extracted and its
 * CONDITIONS are evaluated as real JavaScript rather than pattern-matched.
 *
 * Mutation-checked 2026-09-13, each failing ALONE with a green control:
 *   restore `(projectId || conversationId)` / `(!projectId || !conversationId)` → test 1 fails
 *   drop the `!conversationId` refusal                                          → test 2 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The budgets decide which surfaces have a tool — imported, never restated, so this gate
// cannot drift from what the server actually offers.
import { TOOL_BUDGETS } from '../src/server/utils/chatToolLoop.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'src', 'server', 'index.js'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx'), 'utf8');
const MIGRATION = readFileSync(
  join(ROOT, 'src', 'server', 'database', 'migrations', '20260829120000-chat-projects-core.sql'),
  'utf8',
);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The two conditions that decide the project branch, read out of the real source.
 *
 * Anchored on the project-context call — the thing the branch exists to make — rather than on
 * the error string, so moving or rewording the message cannot make this gate silently pass.
 *
 * ⚠️ UPDATED 2026-09-14. The anchor was `assembleProjectContext({`, a direct call. That work
 * moved into `utils/projectContextTurn.js` and the assembler is now passed to it as an
 * argument, so the old anchor vanished and this gate failed 4 tests.
 *
 * 🔴 It was a STALE ANCHOR, not a regression — the guard it protects (`if (projectId)` and the
 * conversation-less refusal) is untouched, verified in the source before changing anything
 * here. Worth stating plainly: when an extraction breaks a gate, the question is always
 * whether the BEHAVIOUR moved or only the text the gate reads. Changing the gate first, and
 * checking after, is how a real regression gets papered over.
 */
function readGate() {
  const code = stripComments(SERVER);
  const anchor = code.indexOf('openProjectContextTurn({');
  assert.notEqual(anchor, -1, 'the project-context call must exist in src/server/index.js');

  // walk back to the nearest `if (` that opens the branch containing that call
  const before = code.slice(0, anchor);
  const enterAt = before.lastIndexOf('\n        if (');
  assert.notEqual(enterAt, -1, 'the project branch must be a top-level `if` in the handler');
  const enterLine = code.slice(enterAt, code.indexOf('{', enterAt) + 1);
  const enter = enterLine.slice(enterLine.indexOf('(') + 1, enterLine.lastIndexOf(')')).trim();

  const refuseAt = code.indexOf('if (', enterAt + enterLine.length);
  const refuseLine = code.slice(refuseAt, code.indexOf('{', refuseAt) + 1);
  const refuse = refuseLine.slice(refuseLine.indexOf('(') + 1, refuseLine.lastIndexOf(')')).trim();
  const refuseBody = code.slice(refuseAt, code.indexOf('}', refuseAt));

  return {
    enters: new Function('projectId', 'conversationId', `return Boolean(${enter});`),
    refuses: new Function('projectId', 'conversationId', `return Boolean(${refuse});`),
    refuseIs400: /res\.status\(400\)/.test(refuseBody),
    source: `${enter} | ${refuse}`,
  };
}

const UUID = '2f0919bb-98ac-4c54-91e7-4f37fd3bd8ee';

test('a saved chat with no project reaches generation', () => {
  const gate = readGate();
  // the shape of the live 400: a real conversation, no project
  assert.equal(gate.enters(undefined, UUID), false, `a bare conversationId must not enter the project branch (${gate.source})`);
});

test('a project without a conversation is still refused', () => {
  const gate = readGate();
  assert.equal(gate.enters(UUID, undefined), true, 'a projectId must enter the project branch');
  assert.equal(gate.refuses(UUID, undefined), true, 'a projectId with no conversationId must be refused');
  assert.equal(gate.refuseIs400, true, 'the refusal must be a 400, not a thrown 500');
});

test('a project-backed conversation still assembles project context', () => {
  const gate = readGate();
  assert.equal(gate.enters(UUID, UUID), true);
  assert.equal(gate.refuses(UUID, UUID), false, 'a complete pair must not be refused');
});

test('a conversation-less, project-less request is untouched by this branch', () => {
  const gate = readGate();
  assert.equal(gate.enters(undefined, undefined), false);
});

test('the client really does send conversationId without projectId', () => {
  // the reason test 1 matters: if the client always paired them, the old guard would have been
  // harmless. It does not — projectId comes from a project-scoped generation only.
  const payload = CLIENT.slice(CLIENT.indexOf('const payload = {'), CLIENT.indexOf('const payload = {') + 900);
  assert.match(payload, /conversationId:/, 'the client sends conversationId');
  assert.match(payload, /projectId:\s*generationProjectId/, 'the client sends projectId separately');
  assert.doesNotMatch(
    payload,
    /projectId:\s*generationProjectId\s*\?\?\s*conversationId/,
    'projectId must not be back-filled from the conversation',
  );
});

test('the refusal for a conversation-less project is a real schema constraint, not taste', () => {
  const ddl = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS chat_generation_contexts'));
  assert.match(
    ddl.slice(0, ddl.indexOf(');')),
    /conversation_id UUID NOT NULL/,
    'chat_generation_contexts.conversation_id is NOT NULL — a project generation has nowhere to record itself without one',
  );
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * The tool surface: which mode is handed `web_search`.
 *
 * 🔴 FOUND LIVE, AFTER DEPLOY (2026-09-13). The first version resolved the surface as:
 *
 *     const chatSurface = Object.hasOwn(TOOL_BUDGETS, requestedSurface) ? requestedSurface : 'chat';
 *
 * which collapses two different inputs. A MISSING field should default to 'chat' — an older
 * client, or another caller, gets the ordinary surface. But a NAMED mode without a budget was
 * *also* rewritten to 'chat', so `code` and `agents` were handed the tool while their capability
 * statement says "You have no tool you can invoke in this mode, and no web access."
 *
 * That is the fabrication defect inverted. Then: the prompt promised a tool that did not exist,
 * and the model narrated using it. Here: the tool exists in a mode whose prompt denies it, so the
 * model holds something that searches while being told it cannot — and either half can win.
 * A contradiction between the tool list and the prompt is the bug in whichever direction it points.
 *
 * Mutation-checked 2026-09-13, with a green control:
 *   restore `Object.hasOwn(...) ? requestedSurface : 'chat'` -> 'a named mode…' fails
 *   restore `TOOL_BUDGETS[chatSurface] ? …` at the call site -> 'a prototype name…' fails
 */

/** Resolve the surface exactly as the endpoint does, read from the real source. */
function readSurfaceResolution() {
  const code = stripComments(SERVER);
  const line = code.match(/const chatSurface = ([^;]+);/);
  assert.ok(line, 'the endpoint must resolve a chatSurface');
  const requested = code.match(/const requestedSurface = ([^;]+);/);
  assert.ok(requested, 'the endpoint must read chatSurface off the body');
  return (body) => {
    const req = { body };
    // eslint-disable-next-line no-new-func
    const fn = new Function('req', 'TOOL_BUDGETS', `
      const requestedSurface = ${requested[1]};
      const chatSurface = ${line[1]};
      return chatSurface;
    `);
    return fn(req, TOOL_BUDGETS);
  };
}

/** Whether the endpoint would OFFER the tool for a resolved surface, read from the real source. */
function readToolSurfaceGate() {
  const code = stripComments(SERVER);
  const line = code.match(/const toolSurface = ([^;]+);/);
  assert.ok(line, 'the endpoint must decide a toolSurface');
  // eslint-disable-next-line no-new-func
  const fn = new Function('chatSurface', 'TOOL_BUDGETS', `return ${line[1]};`);
  return (surface) => fn(surface, TOOL_BUDGETS);
}

test('a named mode with no budget is NOT silently rewritten to chat', () => {
  const resolve = readSurfaceResolution();
  const offers = readToolSurfaceGate();
  for (const mode of ['code', 'agents']) {
    assert.equal(
      resolve({ chatSurface: mode }), mode,
      `"${mode}" must stay itself — rewriting it to 'chat' hands it web_search while its ` +
      'capability statement says it has no tool, which is the fabrication defect inverted',
    );
    assert.equal(
      offers(resolve({ chatSurface: mode })), null,
      `"${mode}" must be offered no tool`,
    );
  }
});

test('an ABSENT surface still defaults to chat — old clients keep working', () => {
  const resolve = readSurfaceResolution();
  const offers = readToolSurfaceGate();
  for (const body of [{}, { chatSurface: '' }, { chatSurface: '   ' }, { chatSurface: 42 }]) {
    assert.equal(
      resolve(body), 'chat',
      `a missing or non-string surface (${JSON.stringify(body)}) must default to chat, not refuse`,
    );
  }
  assert.equal(offers('chat'), 'chat', 'the default surface still gets the tool');
  assert.equal(offers('research'), 'research', 'Research still gets the tool');
});

test('a prototype name reaches the tool gate and is refused there', () => {
  /*
   * Because a named mode now passes through unchanged, the call-site lookup is the ONLY gate.
   * `TOOL_BUDGETS['constructor']` is a truthy function, so a bracket test would offer the tool
   * AND hand the loop a budget with no `maxSearches` — erasing the server-side spend cap.
   */
  const resolve = readSurfaceResolution();
  const offers = readToolSurfaceGate();
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(
      offers(resolve({ chatSurface: name })), null,
      `"${name}" is not a surface — offering it a tool also erases the search cap`,
    );
  }
});

/**
 * The tool loop, EXECUTED — not pattern-matched.
 *
 * `runToolLoop` is pure: the model call and the search are injected. So every property below is
 * verified by running the real loop against fakes, which is the only way to prove the things
 * that actually cost money — the iteration cap, and a distinct requestId per billed call.
 *
 * ## What these pin, and why each one is here
 *
 * Two transcripts on 2026-09-13 showed the model denying a capability XENO has, then — once told
 * it had one — FABRICATING its use: "*[Running search...]*", "I've enabled search mode", and an
 * invented technical failure. The loop is the fix. These tests exist so the fix cannot rot into
 * the same shape:
 *
 *   - a tool the model can name but the server cannot run (the fabrication, one layer down)
 *   - an unbounded loop (the credit risk: ~11 metered calls for one Chat message at budget 10)
 *   - colliding holds (silent under-billing, because holdId derives from requestId)
 *   - a thrown error mid-turn (aborts a turn the user already paid for)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runToolLoop,
  parseToolArguments,
  toolsForSurface,
  budgetFor,
  TOOL_BUDGETS,
  WEB_SEARCH_TOOL,
} from '../src/server/utils/chatToolLoop.js';

/** An upstream response carrying one web_search call. */
const searchCall = (query, id = 'call_1') => ({
  choices: [{
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query }) } }],
    },
  }],
});

/** An upstream response that just answers. */
const answer = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });

const sources = (n = 1) => ({
  sources: Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://e.test/${i}`, snippet: 's' })),
});

test('a turn that uses no tools costs exactly one upstream call', async () => {
  // The no-regression case: today every chat turn is one call, and it must stay one call.
  let calls = 0;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'hello' }],
    surface: 'chat',
    turnId: 't1',
    callModel: async () => { calls += 1; return answer('hi'); },
    runSearch: async () => { throw new Error('must not be called'); },
  });
  assert.equal(calls, 1, 'no tool call must mean no extra upstream round-trip');
  assert.equal(result.searches, 0);
  assert.equal(result.message.content, 'hi');
  assert.equal(result.cappedOut, false);
});

test('the model searches, gets results, and answers from them', async () => {
  const queries = [];
  let call = 0;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'latest survival games' }],
    surface: 'chat',
    turnId: 't2',
    callModel: async ({ messages }) => {
      call += 1;
      if (call === 1) return searchCall('latest survival games 2026');
      // The second call must SEE the tool result, or the loop is not actually feeding it back.
      const toolMsg = messages.find((m) => m.role === 'tool');
      assert.ok(toolMsg, 'the tool result must be appended before the next model call');
      assert.match(toolMsg.content, /https:\/\/e\.test/, 'the result must carry real sources');
      const assistantMsg = messages.find((m) => m.role === 'assistant' && m.tool_calls);
      assert.ok(assistantMsg, 'the assistant tool-call message must be replayed verbatim, or the ' +
        'provider rejects an orphaned tool response');
      return answer('Here are the newest ones…');
    },
    runSearch: async ({ query }) => { queries.push(query); return sources(2); },
  });
  assert.deepEqual(queries, ['latest survival games 2026']);
  assert.equal(result.searches, 1);
  assert.equal(result.sources.length, 2, 'sources must be collected for citation');
  assert.equal(result.message.content, 'Here are the newest ones…');
});

test('🔴 the search budget is enforced by the SERVER, not by asking the model', async () => {
  // A model that keeps calling the tool forever is the credit risk. The cap must hold against
  // one that ignores every instruction to stop.
  let searchesRun = 0;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'chat',
    turnId: 't3',
    callModel: async ({ tools }) => (
      // Keep asking to search for as long as the tool is offered; answer only when it is gone.
      tools.length > 0 ? searchCall(`q${searchesRun}`, `c${searchesRun}`) : answer('done')
    ),
    runSearch: async () => { searchesRun += 1; return sources(); },
  });
  assert.equal(
    searchesRun, TOOL_BUDGETS.chat.maxSearches,
    `an unbounded model must still stop at ${TOOL_BUDGETS.chat.maxSearches} searches`,
  );
  assert.equal(result.cappedOut, true, 'hitting the cap must be reported, not hidden');
  assert.equal(result.message.content, 'done', 'the turn must still end in an answer');
});

test('🔴 past the cap the tool is WITHDRAWN, not merely discouraged', async () => {
  // A model told "please stop" in prose often tries anyway. Removing the declaration is structural.
  const offered = [];
  await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'chat',
    turnId: 't4',
    callModel: async ({ tools }) => {
      offered.push(tools.length);
      return tools.length > 0 ? searchCall('q', `c${offered.length}`) : answer('done');
    },
    runSearch: async () => sources(),
  });
  assert.ok(offered.length > 1, 'the loop must have iterated');
  assert.equal(offered.at(-1), 0, 'the final call must offer no tools at all');
});

test('🔴 every billed call gets a DISTINCT requestId — holds must not collide', async () => {
  /*
   * holdId = deterministicTxnId(userId, requestId, model), idempotent on requestId so client
   * retries do not stack holds. Reuse one across a loop and the second hold silently collides
   * with the first — under-billing, or failing the turn depending on settle order.
   */
  const seen = [];
  let call = 0;
  await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'chat',
    turnId: 'turn-abc',
    callModel: async ({ requestId }) => {
      seen.push(requestId);
      call += 1;
      return call <= 3 ? searchCall(`q${call}`, `c${call}`) : answer('done');
    },
    runSearch: async () => sources(),
  });
  assert.ok(seen.length >= 4, 'the loop must have made several billed calls');
  assert.equal(new Set(seen).size, seen.length, `requestIds must all differ, got ${seen.join(', ')}`);
  assert.ok(seen.every((id) => id.startsWith('turn-abc')), 'each must be derived from the turn id');
});

test('the same turn replayed produces the same requestIds — a retry must not double-charge', async () => {
  // Deterministic, not random: re-running the same turn must reuse the same holds.
  const run = async () => {
    const seen = [];
    let call = 0;
    await runToolLoop({
      messages: [{ role: 'user', content: 'go' }],
      surface: 'chat',
      turnId: 'stable-turn',
      callModel: async ({ requestId }) => {
        seen.push(requestId);
        call += 1;
        return call <= 2 ? searchCall('q', `c${call}`) : answer('done');
      },
      runSearch: async () => sources(),
    });
    return seen;
  };
  assert.deepEqual(await run(), await run(), 'requestIds must be reproducible for the same turn');
});

test('🔴 a failed search is a RESULT, never a thrown turn', async () => {
  // Throwing would abort a turn the user has already been billed for — and would reproduce the
  // "technical hiccup" the original defect invented, with nothing the model could say about it.
  let sawError = false;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'chat',
    turnId: 't5',
    callModel: async ({ messages }) => {
      const toolMsg = messages.find((m) => m.role === 'tool');
      if (!toolMsg) return searchCall('q');
      sawError = /search failed/.test(toolMsg.content);
      return answer('I tried to search and it failed.');
    },
    runSearch: async () => { throw new Error('upstream 503'); },
  });
  assert.equal(sawError, true, 'the model must be told the search failed, in a tool result');
  assert.match(result.message.content, /failed/);
});

test('malformed tool arguments come back as a result the model can retry against', () => {
  assert.deepEqual(parseToolArguments(''), { ok: false, error: 'empty arguments' });
  assert.deepEqual(parseToolArguments('{oops'), { ok: false, error: 'arguments were not valid JSON' });
  assert.deepEqual(parseToolArguments('{}'), { ok: false, error: 'query is required and must be a non-empty string' });
  assert.deepEqual(parseToolArguments('{"query":"  "}'), { ok: false, error: 'query is required and must be a non-empty string' });
  assert.deepEqual(parseToolArguments('{"query":" hi "}'), { ok: true, query: 'hi' });
});

test('an undeclared tool is answered, not thrown', async () => {
  let told = '';
  await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'chat',
    turnId: 't6',
    callModel: async ({ messages }) => {
      const toolMsg = messages.find((m) => m.role === 'tool');
      if (!toolMsg) {
        return { choices: [{ message: { role: 'assistant', tool_calls: [
          { id: 'x', type: 'function', function: { name: 'delete_everything', arguments: '{}' } },
        ] } }] };
      }
      told = toolMsg.content;
      return answer('ok');
    },
    runSearch: async () => sources(),
  });
  assert.match(told, /unknown tool: delete_everything/);
});

test('Research gets the deeper budget and the deep search depth', async () => {
  assert.ok(
    TOOL_BUDGETS.research.maxSearches > TOOL_BUDGETS.chat.maxSearches,
    'Research must allow more searches than Chat, or the two tiers are one tier with two names',
  );
  let usedDepth = null;
  await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'research',
    turnId: 't7',
    callModel: async ({ messages }) => (
      messages.some((m) => m.role === 'tool') ? answer('done') : searchCall('q')
    ),
    runSearch: async ({ depth }) => { usedDepth = depth; return sources(); },
  });
  assert.equal(usedDepth, 'deep', 'Research must select the deep budget server-side');
});

test('the declared tool is one the loop can actually run', () => {
  // Declaring a tool with no executor is the fabrication defect one layer down.
  assert.equal(WEB_SEARCH_TOOL.function.name, 'web_search');
  assert.deepEqual(toolsForSurface('chat'), [WEB_SEARCH_TOOL]);
  assert.deepEqual(toolsForSurface('research'), [WEB_SEARCH_TOOL]);
  assert.deepEqual(toolsForSurface('code'), [], 'a surface with no budget offers no tools');
});

test('a prototype-named surface gets NO tool and cannot erase the spend cap', () => {
  /*
   * 🔴 Found live, after deploy, 2026-09-13.
   *
   * `toolsForSurface` tested `TOOL_BUDGETS[surface]` for truthiness. `TOOL_BUDGETS.constructor`
   * is a FUNCTION — truthy — so a request carrying `chatSurface: "constructor"` was handed the
   * tool, and the loop then read its budget off that function: `maxSearches` undefined, making
   * `searches >= budget.maxSearches` always FALSE.
   *
   * That comparison is the only server-side bound on how many metered upstream calls one user
   * message can cost. It would not have thrown, logged, or looked wrong anywhere — the turn
   * would simply keep searching for as long as the model kept asking.
   */
  for (const name of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(
      toolsForSurface(name), [],
      `"${name}" is not a surface — a bracket-truthiness test hands it the tool`,
    );
    assert.equal(
      budgetFor(name), TOOL_BUDGETS.chat,
      `"${name}" must fall back to the SMALLER budget, not to something off Object.prototype`,
    );
  }

  // And the cap must be a real number for every value the loop can be handed.
  for (const name of ['chat', 'research', 'code', '', 'constructor', 'bogus']) {
    assert.equal(
      typeof budgetFor(name).maxSearches, 'number',
      `budgetFor("${name}").maxSearches must be a number, or the cap comparison is vacuous`,
    );
  }
});

test('an unknown surface is capped, even driven by a model that never stops', async () => {
  // The property above, proven end to end rather than by inspection: hand the loop the
  // prototype name directly and confirm the turn still terminates at Chat's budget.
  let calls = 0;
  const loop = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    surface: 'constructor',
    turnId: 't-proto',
    callModel: async () => { calls += 1; return searchCall(`q${calls}`); },
    runSearch: async () => sources(),
  });
  assert.ok(
    loop.searches <= TOOL_BUDGETS.chat.maxSearches,
    `an unrecognised surface ran ${loop.searches} searches against Chat's cap of ` +
    `${TOOL_BUDGETS.chat.maxSearches} — the budget fell back to something without a cap`,
  );
});

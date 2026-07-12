/**
 * FR-007 — verify /api/ai/chat forwards OpenAI `tools`/`tool_choice` to the
 * upstream XENO API and returns tool_calls. The metering/DB path can't run
 * without Postgres, so this exercises the actual passthrough point
 * (xenoChatCompletion) with a mocked fetch — that's where tools are forwarded.
 *
 * Run: XENO_API_KEY=test node src/server/tests/ai-tools-passthrough.test.mjs
 */
import assert from 'node:assert/strict';

process.env.XENO_API_KEY = process.env.XENO_API_KEY || 'test-key';
const { xenoChatCompletion } = await import('../utils/xenoChat.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const TOOLS = [{ type: 'function', function: { name: 'click_element', parameters: { type: 'object', properties: {} } } }];

// Mock the upstream OpenAI-compatible endpoint.
let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, body: JSON.parse(init.body) };
  return {
    ok: true,
    json: async () => ({
      model: 'gpt-5.2',
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'click_element', arguments: '{}' } }] } }],
      usage: { total_tokens: 10 },
    }),
  };
};

const result = await xenoChatCompletion({
  model: 'openai/gpt-5.2',
  messages: [{ role: 'user', content: 'click the button' }],
  temperature: 0.7,
  max_tokens: 4096,
  extra: { tools: TOOLS, tool_choice: 'auto' },
});

ok(captured !== null, 'upstream was called');
ok(Array.isArray(captured.body.tools) && captured.body.tools.length === 1, 'tools forwarded to upstream body');
ok(captured.body.tool_choice === 'auto', 'tool_choice forwarded');
ok(captured.body.model === 'gpt-5.2', 'model id normalized (company/ prefix stripped)');
ok(result.choices?.[0]?.message?.tool_calls?.[0]?.id === 'c1', 'tool_calls returned to caller');

// A request WITHOUT tools must not inject a tools field (older clients).
captured = null;
await xenoChatCompletion({ model: 'gpt-5.2', messages: [{ role: 'user', content: 'hi' }], extra: {} });
ok(captured.body.tools === undefined, 'no tools field when none requested (backward compatible)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

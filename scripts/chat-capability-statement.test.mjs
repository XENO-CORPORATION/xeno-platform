/**
 * The model is told what XENO can do — and Research is actually the deeper pass.
 *
 * ## The defect, from a real transcript (2026-09-13)
 *
 * Asked "can you search online?" in Chat mode, the model answered:
 *
 *   "In this conversation I don't have web search or browsing available — I can only draw on
 *    what I learned during training, which has a cutoff date…"
 *
 * 🔴 Wrong about this product, and the model had no way to know. Two separate causes:
 *
 *   1. NOTHING TOLD IT. `buildChatSystemPrompt` returned the user's saved prompt, or the empty
 *      string — which is the default. So in Chat mode the system prompt was empty and the model
 *      answered from its own training defaults, under-claiming a feature XENO ships.
 *
 *   2. IT WAS ALSO TRUE, BECAUSE THE STATE WAS IMPOSED. `handleEmptyStateModeChange` ran
 *      `setIsXenoSearchEnabled(modeUsesXenoSearch(mode))`, which force-CLEARED search on every
 *      switch to Chat/Code/Agents. A user who turned search on lost it by changing tabs, and
 *      Chat could never search at all — while the whole pipeline sat built and working.
 *
 * ## And a third thing found while fixing it
 *
 * 🔴 `isXenoDeepMode` was declared, threaded through the client, sent to the server and
 * VALIDATED there — and set by nothing. Permanently false, so Research ran the identical quick
 * search as Chat: two tiers that were one tier with two names. The budgets it selects are real
 * and deployed (`src/server/services/chatWebContext.js`): quick 25s/2 attempts/3 concurrent,
 * deep 90s/3 attempts/4 concurrent. Sixth "built, tested, unreachable" case in this repo.
 *
 * ## The model this encodes, checked against Anthropic 2026-09-13
 *
 * Search and Research are SCALE, not on/off, and they LAYER:
 *   web search — "one or two tool calls", a quick lookup, a persistent setting
 *   Research   — "five or more tool calls over 1-3 minutes" across "multiple sources"
 *   and: "You must have web search turned on for research to function."
 *
 * So Research both enables search and raises the depth — which is why the handler does both.
 * An earlier draft of the capability text said "switch to Research to search", which would have
 * been the original defect in another form: describing the product as more restrictive than it is.
 *
 * Mutation-checked 2026-09-13, each failing alone with a green control:
 *   drop the capability statement from buildChatSystemPrompt   -> test 1 fails
 *   restore setIsXenoSearchEnabled(modeUsesXenoSearch(mode))   -> test 3 fails
 *   drop setIsXenoDeepMode from the mode handler               -> test 4 fails
 *   tell the model it has no web access in any mode            -> test 2 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'chatModeConfig.ts'), 'utf8');
const CHAT = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx'), 'utf8');
const BUDGETS = readFileSync(join(ROOT, 'src', 'server', 'services', 'chatWebContext.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODES = ['chat', 'research', 'code', 'agents'];

test('every mode sends a capability statement, unconditionally', () => {
  const code = stripComments(CONFIG);
  const fn = code.match(/export const buildChatSystemPrompt[\s\S]*?\n\};/);
  assert.ok(fn, 'buildChatSystemPrompt must exist');
  assert.match(
    fn[0], /buildCapabilityStatement\(mode\)/,
    'the prompt must always include the capability statement. Returning only the user\'s saved ' +
    'prompt means an empty system prompt by default — which is how the model came to say XENO ' +
    'has no web search.',
  );
  // It must not be behind a condition that can drop it.
  assert.doesNotMatch(
    fn[0], /if\s*\([^)]*\)\s*return (basePrompt|saved|'')/,
    'no early return may bypass the capability statement',
  );
});

test('no mode tells the model the web is unreachable', () => {
  const code = stripComments(CONFIG);
  const block = code.match(/const SEARCH_CAPABILITY[\s\S]*?\n\};/);
  assert.ok(block, 'SEARCH_CAPABILITY must exist');
  for (const mode of MODES) {
    assert.match(block[0], new RegExp(`${mode}:`), `SEARCH_CAPABILITY must cover ${mode}`);
  }
  /*
   * ⚠️ A PROHIBITION is not an ASSERTION, and the first version of this check could not tell
   * them apart. It matched "never claim you have no access to the web" — an instruction NOT to
   * say the thing — and reported it as the defect. The phrase being present is meaningless;
   * what matters is whether it is negated.
   *
   * So: find each denial phrase and look at what precedes it. Only an unnegated one is a fault.
   */
  const DENIAL = /(no (web |internet )?access|cannot (search|browse)|unable to (search|browse))/gi;
  const asserted = [...block[0].matchAll(DENIAL)].filter((m) => {
    const before = block[0].slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    return !/(never|not|don't|do not|avoid|rather than)\s[^.]*$/.test(before);
  });
  assert.deepEqual(
    asserted.map((m) => m[0]), [],
    'a mode that cannot search must say where the user CAN search, never that the web is out of ' +
    'reach — that flat denial is the reported defect. (A phrase prefixed by "never claim…" is an ' +
    'instruction against it and is fine.)',
  );
  assert.match(block[0], /Research/, 'the deeper pass must be named so the model can point at it');
});

test('switching modes never silently clears the user search choice', () => {
  const code = stripComments(CHAT);
  const handler = code.match(/const handleEmptyStateModeChange[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(handler, 'handleEmptyStateModeChange must exist');
  assert.doesNotMatch(
    handler[0], /setIsXenoSearchEnabled\(modeUsesXenoSearch\(mode\)\)/,
    'this form force-CLEARS search for chat/code/agents, so a user who enabled it loses it by ' +
    'changing tabs and Chat can never search. Research must turn it ON without turning it off ' +
    'anywhere else.',
  );
  assert.match(
    handler[0], /if \(modeUsesXenoSearch\(mode\)\) setIsXenoSearchEnabled\(true\)/,
    'Research must still guarantee search is on',
  );
});

test('Research selects the DEEP budget — the flag has a driver', () => {
  const code = stripComments(CHAT);
  const handler = code.match(/const handleEmptyStateModeChange[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(handler, 'handleEmptyStateModeChange must exist');
  assert.match(
    handler[0], /setIsXenoDeepMode\(modeUsesXenoSearch\(mode\)\)/,
    'isXenoDeepMode was declared, sent to the server and validated there while NOTHING set it — ' +
    'so Research ran the same quick search as Chat. Research must select deep, and leaving it ' +
    'must drop back to quick.',
  );

  // Prove it reaches the request, not just the state.
  assert.match(
    code, /depth: isXenoDeepMode \? 'deep' : 'quick'/,
    'the flag must still be what selects the request depth',
  );
});

test('the two depths are really different server-side', () => {
  // If quick and deep had the same budget, binding Research to deep would be theatre.
  const block = BUDGETS.match(/const RESEARCH_BUDGETS[\s\S]*?\n\}\);/);
  assert.ok(block, 'RESEARCH_BUDGETS must exist');
  const quick = block[0].match(/quick: [^}]*operationMs: ([\d_]+)/);
  const deep = block[0].match(/deep: [^}]*operationMs: ([\d_]+)/);
  assert.ok(quick && deep, 'both depths must define an operation budget');
  const ms = (m) => Number(m[1].replace(/_/g, ''));
  assert.ok(
    ms(deep) > ms(quick),
    `deep (${ms(deep)}ms) must allow more time than quick (${ms(quick)}ms), or the tiers are ` +
    'one tier with two names',
  );
});

test('the identity names the product, not the underlying model', () => {
  const code = stripComments(CONFIG);
  assert.match(code, /export const XENO_IDENTITY/, 'the identity constant must exist');
  assert.match(code, /You are XENO/, 'the model must answer as XENO');
  assert.match(
    code, /not about the capabilities of the model you run on/i,
    'the same question reaches Claude, GPT and Gemini — the answer must describe THIS product, ' +
    'which is the whole reason the transcript was wrong.',
  );
});

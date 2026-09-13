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

test('no mode teaches the model to narrate a tool it cannot invoke', () => {
  const code = stripComments(CONFIG);
  const block = code.match(/const SEARCH_CAPABILITY[\s\S]*?\n\};/);
  assert.ok(block, 'SEARCH_CAPABILITY must exist');
  for (const mode of MODES) {
    assert.match(block[0], new RegExp(`${mode}:`), `SEARCH_CAPABILITY must cover ${mode}`);
  }
  /*
   * 🔴 REWRITTEN 2026-09-13, because the first version asserted the wrong thing.
   *
   * It forbade any mode from saying it cannot search, on the theory that such a denial was
   * always the defect. That encoded a belief about the product — "search is reachable from
   * everywhere" — which the code disproves: `toggleXenoSearch` and `toggleSearch` are both
   * defined in ChatWithLLM.tsx and CALLED BY NOTHING, so there is no search control in the
   * composer and Chat genuinely cannot search today.
   *
   * A gate that forbids a true statement pushes the prompt toward a false one. And it did: the
   * text it approved told users to find a control that does not exist, after which the model
   * fabricated `*[Running search...]*` and then invented a technical failure to explain why no
   * results appeared.
   *
   * ⚠️ So the invariant is NOT "never say you cannot search". It is:
   *   - never narrate running a tool (that is the fabrication), and
   *   - always name the route that DOES work, so a refusal is not a dead end.
   *
   * When the tool loop lands (docs/CHAT-TOOL-CALLING-PLAN.md) the Chat text changes again — and
   * it must change only AFTER the tool is reachable, which is what the final checklist item in
   * that plan is for.
   */
  const FABRICATION = /(\[?(running|performing|executing) (a )?search|let me search|i'?ll search now|i have (enabled|activated) search)/gi;
  const fabricated = [...block[0].matchAll(FABRICATION)].filter((m) => {
    const before = block[0].slice(Math.max(0, m.index - 70), m.index).toLowerCase();
    return !/(never|not|don'?t|do not|avoid|must not)\s[^.]*$/.test(before);
  });
  assert.deepEqual(
    fabricated.map((m) => m[0]), [],
    'the prompt must never model narrating a search. The reported defect was the model emitting ' +
    '"*[Running search...]*" and then inventing a failure, for a tool it could not invoke.',
  );

  // Every mode must point at a route that actually works, so "I can't" is never a dead end.
  for (const mode of MODES) {
    const line = block[0].match(new RegExp(`${mode}: \\[([\\s\\S]*?)\\]`))?.[1] ?? '';
    assert.match(
      line, /Research/,
      `the ${mode} statement must name the route that does work (Research), so a refusal gives ` +
      'the user somewhere to go instead of ending the conversation.',
    );
  }
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

test('the prompt cannot promise a control that is not rendered', () => {
  /*
   * 🔴 THE GATE THAT WOULD HAVE CAUGHT THE FABRICATION.
   *
   * The prompt told users to turn search on with "the search control beside the composer".
   * `toggleXenoSearch` and `toggleSearch` are both defined in ChatWithLLM.tsx and called by
   * NOTHING — there is no such control. So the user could not comply, and the model, believing
   * it had a capability, emitted "*[Running search...]*" and then invented a technical failure.
   *
   * ⚠️ The capability docblock already said "Do not add a capability to this text before it is
   * wired." It was added anyway, in the same edit that wrote the warning. A warning beside the
   * thing does not enforce the thing — only a check does.
   *
   * So: if the prompt points at a toggle, that toggle must have a caller. This is deliberately
   * about REACHABILITY, not existence: a handler nothing invokes is exactly as useless to a user
   * as a handler that was never written.
   */
  const config = stripComments(CONFIG);
  const chatSource = stripComments(CHAT);

  const promisesAToggle = /search control|toggle|turn it on|enable search/i.test(config);
  if (!promisesAToggle) return; // nothing claimed, nothing to verify

  for (const handler of ['toggleXenoSearch', 'toggleSearch']) {
    const declared = new RegExp(`const ${handler}\\s*=`).test(chatSource);
    if (!declared) continue;
    // A caller is any mention that is not the declaration itself.
    const mentions = (chatSource.match(new RegExp(handler, 'g')) || []).length;
    assert.ok(
      mentions > 1,
      `the capability statement points users at a search control, but ${handler} is declared and ` +
      'never called — so no such control is rendered and the instruction cannot be followed. ' +
      'Either wire the control or stop promising it. (This is the exact 2026-09-13 defect: the ' +
      'model then fabricated "*[Running search...]*" and invented a failure.)',
    );
  }
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

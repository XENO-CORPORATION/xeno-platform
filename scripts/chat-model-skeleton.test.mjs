/**
 * Loading shows a SKELETON, never a plausible stand-in value.
 *
 * ## The defect (reported 2026-09-17, /isg)
 *
 * While the model catalogue loaded, the picker rendered the hard-coded fallback's real-looking
 * name ("GPT-5.6 Terra") — so for the first few hundred milliseconds of every load the UI
 * asserted a model nobody had chosen, and a quick send went to it. The tray said
 * "Loading models..." in prose. ChatGPT, Claude and Linear shimmer an empty pill and empty
 * rows here; none paints a default value. A skeleton has the content's shape and none of its
 * meaning, which is the whole point: nothing is claimed until something is known.
 *
 * Each gate below was verified to FAIL when its line is reverted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const SELECTOR = stripComments(read('src/components/playground/Chat/ChatModelSelector.tsx'));
const CHAT = stripComments(read('src/components/playground/Chat/ChatWithLLM.tsx'));
const CSS = read('src/components/playground/Chat/chat-theme.css');

test('the picker trigger never shows the fallback model name while the catalogue loads', () => {
  const trigger = SELECTOR.slice(SELECTOR.indexOf('data-chat-model-trigger'), SELECTOR.indexOf('{!isInlineTray && ('));
  assert.match(trigger, /isLoading \? \(\s*<span className="chat-skeleton[^"]*" data-chat-model-skeleton/, 'a skeleton pill while loading');
  assert.match(trigger, /\) : \(\s*<span className="truncate">\{selectedModel\.name\}<\/span>/, 'the name only once loaded');
  assert.match(trigger, /aria-busy=\{isLoading \|\| undefined\}/, 'assistive tech is told the control is loading');
  assert.doesNotMatch(trigger, /<span className="truncate">\{selectedModel\.name\}<\/span>\s*<ChevronDown/, 'the unconditional name render is the defect');
});

test('the tray and the inline rail render skeleton rows, not a "Loading models..." sentence', () => {
  assert.doesNotMatch(SELECTOR, /Loading models\.\.\./, 'prose is not a skeleton');
  const skeletons = SELECTOR.match(/data-chat-model-skeleton aria-busy="true"/g) ?? [];
  assert.equal(skeletons.length, 2, 'both the tray and the inline rail carry a skeleton block');
  assert.match(SELECTOR, /No models available\.<\/span>/, 'the genuinely-empty state stays a sentence — that one IS information');
});

test('the top-bar current-model button follows the same rule', () => {
  const button = CHAT.slice(CHAT.indexOf('data-chat-current-model'), CHAT.indexOf('{isMultiInterface && (', CHAT.indexOf('data-chat-current-model')));
  assert.match(button, /isModelsLoading \? \(\s*<span className="chat-skeleton[^"]*" data-chat-model-skeleton/);
  assert.match(button, /aria-busy=\{isModelsLoading \|\| undefined\}/);
  assert.doesNotMatch(button, /title=\{`Current model: \$\{selectedModel\.name\}`\}/, 'the tooltip must not name the fallback while loading');
});

test('nothing can be sent to the fallback model while the catalogue loads', () => {
  const generate = CHAT.slice(CHAT.indexOf('const handleGenerate = async ('), CHAT.indexOf('const handleGenerate = async (') + 1200);
  assert.match(generate, /if \(isModelsLoading\) return;/, 'handleGenerate is the one choke point — Enter, the button and voice all pass through it');
  const send = CHAT.slice(CHAT.indexOf('data-composer-send-button'), CHAT.indexOf('data-composer-send-button') + 1600);
  assert.match(send, /disabled=\{[^}]*\|\| isModelsLoading\}/, 'the affordance matches the guard');
});

test('the skeleton is a real primitive: chat tokens, a shimmer, and stillness under reduced motion', () => {
  const block = CSS.slice(CSS.indexOf('.chat-skeleton {'));
  assert.match(block, /background: var\(--chat-control\);/, 'surface from the chat tokens, no hex');
  assert.match(block, /color: transparent !important;/, 'the placeholder text is for layout only');
  assert.match(block, /animation: chat-skeleton-sweep/, 'it shimmers');
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\.chat-skeleton::after \{\s*animation: none;/, 'and stops when asked to');
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, 'no hex literal — DESIGN_SYSTEM: every visual value resolves to a token');
});

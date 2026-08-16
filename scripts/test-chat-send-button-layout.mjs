import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * This test went red in 3d27aef ("composer polish") and stayed red long enough to be baselined. It
 * failed on its FIRST line — it sliced the composer out of the source at `{isLoading ?`, a marker
 * that pass removed — so none of the assertions below it had run since. Three of them turned out to
 * describe a chat that deliberately no longer exists; they are restated here against what the
 * composer now is, at the same strictness. The reasons are in CHAT-ELEMENTS-SPEC.md §9.
 *
 * The scope is now the `<ChatEmptyState>` element, which is a component boundary rather than an
 * implementation detail — the previous marker was a conditional that any refactor could delete
 * without noticing it was load-bearing for a test.
 */
const source = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

const controlsStart = source.indexOf('<ChatEmptyState');
assert.notEqual(controlsStart, -1, 'Composer action controls should exist');
const controlsEnd = source.indexOf('</ChatEmptyState>', controlsStart);
assert.notEqual(controlsEnd, -1, 'Composer region should be closed');

const controls = source.slice(controlsStart, controlsEnd);
const microphoneIndex = controls.indexOf('data-voice-primary');
const sendButtonIndex = controls.indexOf('data-composer-send-button');

assert.notEqual(microphoneIndex, -1, 'Voice input button should remain available');
assert.notEqual(sendButtonIndex, -1, 'Send button should have a stable test hook');
assert(microphoneIndex < sendButtonIndex, 'Send button should appear to the right of the microphone');
assert.match(controls, /disabled=\{!\(inputValue\.trim\(\) \|\| attachedFiles\.length > 0\) \|\| isContextLimitReached\}/, 'Send button should stay visible but disabled without text or an attachment');
assert.match(controls, /aria-label="Send message"/, 'Icon-only send button should have an accessible label');
assert.match(controls, /motion-safe:animate-send-button-enter/, 'Send button should use a motion-safe entrance animation');

/*
 * Restated #1. This asserted `border-white/10 bg-[#161618] text-zinc-600` — literal hex and a Tailwind
 * palette name. Those cannot follow the theme: the chat has a light mode and a continuous brightness
 * slider, and `#161618` is the same dark chip at every stop. The disabled state is still pinned
 * exactly, in the tokens that do follow.
 */
assert.match(controls, /cursor-not-allowed border border-\[var\(--chat-border\)\] bg-\[var\(--chat-control\)\] text-\[var\(--chat-muted\)\]/, 'Empty composer should show the muted send state, in tokens');
const sendButton = controls.slice(sendButtonIndex, controls.indexOf('</button>', sendButtonIndex));
assert.doesNotMatch(sendButton, /#[0-9a-fA-F]{6}|text-zinc-|border-white\//, 'Send button should carry no hard-coded colour — it has to survive light mode and every brightness stop');

/*
 * Restated #2. This asserted the raw path `M12 19V5M5 12l7-7 7 7` and a literal `<svg width="16"`.
 * The arrow was hand-drawn at stroke 2 with round caps while every other glyph in the composer came
 * from the element set at 1.75 with butt caps, and it could not animate because there was nothing to
 * animate against. It is the set's ArrowUp now, still at 16.
 */
assert.match(sendButton, /<ArrowUp size=\{16\} \/>/, 'Send glyph should be the element set’s ArrowUp at 16px');

/*
 * Restated #3, and this one now asserts the OPPOSITE of what it used to. It read
 * `messages.length === 0 ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl'` under the name "Send button
 * should be optically smaller than the microphone". The composer-polish pass made Stop, Mic and Send
 * one box on purpose, through a single shared constant — a guarantee a sibling test already counts
 * the uses of. Send being smaller is not a property the chat wants any more; Send matching its
 * neighbours is.
 */
assert.match(sendButton, /\$\{composerActionButtonSizeClass\}/, 'Send button should take the shared composer action size');
const micButton = controls.slice(microphoneIndex, controls.indexOf('</button>', microphoneIndex));
assert.match(micButton, /\$\{composerActionButtonSizeClass\}/, 'Microphone should take the same shared size — the three composer actions are one box');

const tailwindConfig = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8');
assert.match(tailwindConfig, /'send-button-enter': 'send-button-enter 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both'/, 'Send animation should use the approved 240ms easing');
assert.match(tailwindConfig, /'send-button-enter': \{[\s\S]*?transform: 'translateX\(6px\) scale\(0\.76\)'/, 'Send animation should slide from the right and scale from 76%');

console.log('Chat composer send button layout checks passed.');

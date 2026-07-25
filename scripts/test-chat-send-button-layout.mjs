import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

const controlsStart = source.indexOf('{isLoading ?');
const controlsEnd = source.indexOf('</ChatEmptyState>', controlsStart);
assert.notEqual(controlsStart, -1, 'Composer action controls should exist');

const controls = source.slice(controlsStart, controlsEnd);
const microphoneIndex = controls.indexOf('data-voice-primary');
const sendButtonIndex = controls.indexOf('data-composer-send-button');

assert.notEqual(microphoneIndex, -1, 'Voice input button should remain available');
assert.notEqual(sendButtonIndex, -1, 'Send button should have a stable test hook');
assert(microphoneIndex < sendButtonIndex, 'Send button should appear to the right of the microphone');
assert.match(controls, /disabled=\{!\(inputValue\.trim\(\) \|\| attachedFiles\.length > 0\) \|\| isContextLimitReached\}/, 'Send button should stay visible but disabled without text or an attachment');
assert.match(controls, /cursor-not-allowed border border-white\/10 bg-\[#161618\] text-zinc-600/, 'Empty composer should show the muted send state');
assert.match(controls, /aria-label="Send message"/, 'Icon-only send button should have an accessible label');
assert.match(controls, /M12 19V5M5 12l7-7 7 7/, 'Send icon should point upward');
assert.match(controls, /messages\.length === 0 \? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl'/, 'Send button should be optically smaller than the microphone');
assert.match(controls, /<svg width="16" height="16"/, 'Send icon should match the smaller button');
assert.match(controls, /motion-safe:animate-send-button-enter/, 'Send button should use a motion-safe entrance animation');

const tailwindConfig = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8');
assert.match(tailwindConfig, /'send-button-enter': 'send-button-enter 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both'/, 'Send animation should use the approved 240ms easing');
assert.match(tailwindConfig, /'send-button-enter': \{[\s\S]*?transform: 'translateX\(6px\) scale\(0\.76\)'/, 'Send animation should slide from the right and scale from 76%');

console.log('Chat composer send button layout checks passed.');

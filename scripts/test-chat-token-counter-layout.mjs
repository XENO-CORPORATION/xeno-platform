import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

const controlsStart = source.indexOf('{/* Controls Row */}');
const controlsEnd = source.indexOf('{isLoading ?', controlsStart);
assert.notEqual(controlsStart, -1, 'Composer controls row should exist');
assert.notEqual(controlsEnd, -1, 'Composer send controls should exist');

const controlsRow = source.slice(controlsStart, controlsEnd);
const counterIndex = controlsRow.indexOf('data-token-context-counter');
const reasoningIndex = controlsRow.indexOf('{/* Reasoning toggle */}');
const modelSelectorIndex = controlsRow.indexOf('<ChatModelSelector');

assert.notEqual(counterIndex, -1, 'Desktop token counter should have a stable test hook');
assert(counterIndex < reasoningIndex, 'Token counter should be in the left composer controls');
assert(counterIndex < modelSelectorIndex, 'Token counter should be left of the model selector');
assert.match(controlsRow, /!isMobile/, 'Mobile should keep using its separate header counter');
assert.match(controlsRow, /compactConversation\(selectedModel\)/, 'Compress behavior should remain available');

console.log('Chat composer token counter layout checks passed.');

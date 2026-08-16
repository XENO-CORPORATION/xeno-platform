import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * Red since 3d27aef ("composer polish"), for the same reason as its send-button sibling: it ended
 * its slice at `{isLoading ?`, a conditional that pass removed, so it failed before computing the
 * region and none of its five assertions had run since.
 *
 * The row is scoped by `chat-input-controls` — the class the row is built on — through to
 * `data-composer-send-button`, the hook that opens the right-hand group. Both are things the
 * composer IS, rather than a conditional that happened to sit at the seam.
 */
const source = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

const controlsStart = source.indexOf('chat-input-controls');
assert.notEqual(controlsStart, -1, 'Composer controls row should exist');
const controlsEnd = source.indexOf('data-composer-send-button', controlsStart);
assert.notEqual(controlsEnd, -1, 'Composer send controls should exist');

const controlsRow = source.slice(controlsStart, controlsEnd);
const counterIndex = controlsRow.indexOf('data-token-context-counter');
const reasoningIndex = controlsRow.indexOf('{/* Reasoning toggle */}');
const voiceIndex = controlsRow.indexOf('data-voice-primary');

assert.notEqual(counterIndex, -1, 'Desktop token counter should have a stable test hook');
assert.notEqual(reasoningIndex, -1, 'Reasoning toggle should remain in the controls row');
assert(counterIndex < reasoningIndex, 'Token counter should be in the left composer controls');
assert.match(controlsRow, /!isMobile/, 'Mobile should keep using its separate header counter');
assert.match(controlsRow, /compactConversation\(selectedModel\)/, 'Compress behavior should remain available');

/*
 * Restated. This asserted `counterIndex < modelSelectorIndex` — "Token counter should be left of the
 * model selector" — and the model selector is not in this row any more. The composer-polish pass
 * handed it to `<ChatEmptyState>` as a render prop, so it draws above the box and the "+" control
 * reveals it along with the mode tabs. Comparing two positions in a row that only contains one of
 * them would have quietly compared against -1.
 *
 * Both halves are pinned instead of the one comparison: the selector is gone from the row, and it is
 * where it went. The counter's place is now stated against the voice control, which is the right-hand
 * group's first member and did not move.
 */
assert.equal(controlsRow.indexOf('<ChatModelSelector'), -1, 'Model selector no longer lives in the controls row');
assert.match(source, /modelSelector=\{\(\{ isInlineTray, onOpenChange \}\) => \(\s*<ChatModelSelector/, 'Model selector should be handed to ChatEmptyState, which draws it above the box');
assert.notEqual(voiceIndex, -1, 'Voice control should remain in the controls row');
assert(counterIndex < voiceIndex, 'Token counter should sit left of the composer action group');

console.log('Chat composer token counter layout checks passed.');

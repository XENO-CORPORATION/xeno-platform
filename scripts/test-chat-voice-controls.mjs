import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

assert.match(source, /type VoiceInputMode = 'tap' \| 'hold'/, 'Voice input modes should be explicit');
assert.match(source, /xeno-chat-voice-input-mode/, 'Voice input mode should persist locally');
assert.match(source, /data-composer-send-button/, 'Send button should remain identifiable');
assert.match(source, /disabled=\{!\(inputValue\.trim\(\) \|\| attachedFiles\.length > 0\) \|\| isContextLimitReached\}/, 'Send button should stay visible but disabled without sendable content');
assert.match(source, /motion-safe:animate-send-button-enter/, 'Send button should animate when it becomes active');
assert.match(source, /data-voice-mode-trigger/, 'Voice mode chevron should have a stable trigger');
assert.match(source, /data-voice-mode-popover/, 'Voice mode settings should render in a connected popover');
// `flex h-7 w-7` was the chevron's own box until it became an IconButton; `size="sm"` is the same
// 28px said in the size scale. What still has to be asserted here is the POSITIONING, because that
// is what keeps the chevron out of the row's flow — it went missing once, and Send moved.
assert.match(source, /className="absolute right-full mr-1"/, 'Chevron should sit to the left of the microphone without moving Send');
// It opened BELOW (`right-0 top-full mt-1.5`) until 3d27aef moved it above the controls — a
// deliberate change in the composer-polish pass, not an adoption one, and this line simply never
// followed it. Pinned to where it actually opens so the check still catches an accidental move.
assert.match(source, /absolute -right-10 bottom-full z-40 mb-1\.5 w-40/, 'Voice options should open as a compact popover above the composer controls');
const voicePopoverStart = source.indexOf('data-voice-mode-popover');
const voicePopoverEnd = source.indexOf('</div>', voicePopoverStart);
assert.doesNotMatch(source.slice(voicePopoverStart, voicePopoverEnd), /blue/, 'Voice options should preserve XENO\'s monochromatic palette');
assert.match(source, /data-voice-hold-switch/, 'Hold-to-record control should expose a stable switch hook');
assert.match(source, /relative inline-flex h-4 w-7 shrink-0 items-center rounded-md border p-\[2px\]/, 'Hold-to-record track should center a squared thumb with even inset');
/*
 * Restated in form, not in strength. This read `h-2.5 w-2.5 rounded-[3px]` as one contiguous string,
 * and 3d27aef split the thumb: `rounded-[3px]` stayed on the base span while the size moved into the
 * branches, because the thumb GROWS when the switch is on. The old line could not see either half.
 * All three facts are pinned separately now, which is more than it checked before.
 */
assert.match(source, /block rounded-\[3px\] transition-\[transform,background-color,width,height\]/, 'Hold-to-record thumb should be squared, and should transition its size as well as its position');
assert.match(source, /'h-2\.5 w-2\.5 translate-x-0/, 'Resting thumb should be 10px');
assert.match(source, /'h-3 w-3 translate-x-\[10px\]/, 'Active thumb should grow to 12px as it travels');
assert.match(source, /bg-\[var\(--chat-text\)\]/, 'Active track should use theme text for contrast on Light and Dark');
/*
 * This asserted a 14px travel and the pass moved it to 12, so the line was stale — but taking it
 * seriously found a bug rather than a number to update. The track is 28px with a 1px border and 2px
 * of padding, so the thumb's runway is 22px; at 12px wide it can travel 10. Both 14 (with the old
 * 10px thumb) and 12 (with the new 12px one) overhang the inner edge by 2px, so the thumb rested 3px
 * from the left and landed 1px from the right — measured, not derived. The travel is 10px now and
 * the inset matches at both ends.
 *
 * The sibling assertion above already pins the number; this one pins what the number is FOR.
 */
assert.match(source, /translate-x-\[10px\] -translate-y-1\/2 bg-\[var\(--chat-elevated\)\]/, 'Active thumb should ease to the right on elevated surface, stopping at the same inset it rests on');
assert.match(source, /bg-\[var\(--chat-canvas\)\]/, 'Inactive track should use canvas fill for contrast with the thumb');
assert.match(source, /translate-x-0 -translate-y-1\/2 bg-\[var\(--chat-text\)\]/, 'Inactive thumb should use theme text so it stays visible on Light and Dark');
assert.match(source, /ease-\[cubic-bezier\(0\.16,1,0\.3,1\)\]/, 'Toggle motion should use XENO soft-ease curve');
assert.match(source, /duration-300/, 'Toggle motion should ease over 300ms instead of snapping');
assert.match(source, /text-\[11px\] font-medium text-\[var\(--chat-text\)\]/, 'Hold-to-record label should use theme text');
assert.match(source, /role="switch"/, 'Hold-to-record setting should use switch semantics');
assert.match(source, /aria-checked=\{voiceInputMode === 'hold'\}/, 'Switch state should expose the selected voice mode');
assert.match(source, /onPointerDown=\{handleVoicePointerDown\}/, 'Hold-to-record should start on pointer down');
assert.match(source, /onPointerUp=\{handleVoicePointerUp\}/, 'Hold-to-record should stop on pointer release');
assert.match(source, /onPointerCancel=\{handleVoicePointerUp\}/, 'Hold-to-record should stop on pointer cancel');
assert.match(source, /const pendingVoiceSubmissionRef = useRef\(false\)/, 'Voice send should track whether final transcription must be submitted');
assert.match(source, /const handleGenerate = async \(inputOverride\?: string\)/, 'Message submission should accept a final voice transcript override');
assert.match(source, /const userTextToSend = \(inputOverride \?\? inputValue\)\.trim\(\)/, 'Final voice transcript should be used for the outgoing message');
assert.match(source, /if \(pendingVoiceSubmissionRef\.current\)/, 'Voice recognition completion should submit a pending voice message');
assert.match(source, /const handleVoiceSend = \(\) =>/, 'Send should coordinate an active voice recording before submission');
assert.match(source, /onClick=\{handleVoiceSend\}/, 'Send button should wait for active dictation to finish');

const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
assert.match(styles, /:has\(\[data-voice-primary\]:hover\) \[data-voice-mode-trigger\]/, 'Chevron should reveal from microphone hover only');

console.log('Chat voice controls behavior checks passed.');

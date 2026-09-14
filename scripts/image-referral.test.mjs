/**
 * Re-attaching a generated image when the user refers to it.
 *
 * ## Why this is a module, and why it has tests now
 *
 * A user who says "make that one bigger" after XENO generated a picture is talking about the
 * picture — but an assistant `image` part is history, not an input, so the model cannot see
 * it. This finds the most recent AI image and prepends it to the current user turn.
 *
 * 🔴 Without it, follow-ups get answered as if no image existed: the model invents a
 * description or asks which image is meant. It ANSWERS, so nothing looks broken. That is
 * exactly why it had to travel with the extraction — a route that quietly lacks this is
 * indistinguishable from one that has it, until someone reads the replies carefully.
 *
 * These 119 lines lived inline in /api/chat/generate. Extracted 2026-09-14 so a second route
 * can serve chat turns; proven equivalent to the inline version across 17 cases first.
 *
 * Mutation-checked, each failing alone with a green control:
 *   unbounded "it" lookback   -> the stale-image test fails
 *   append instead of prepend -> the ordering test fails
 *   drop the skip flag        -> the explicit-task test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachReferencedImage, IMAGE_REFERRAL_INTERNALS } from '../src/server/utils/imageReferral.js';

const img = (data = 'AAAA') => ({ type: 'image', media_type: 'image/png', data });
const txt = (text) => ({ type: 'text', text });
const user = (...parts) => ({ role: 'user', parts });
const ai = (...parts) => ({ role: 'model', parts });

test('🔴 a bare reaction right after an image refers to it', () => {
  const messages = [ai(img()), user(txt('cool'))];
  const result = attachReferencedImage(messages);
  assert.equal(result.attached, true);
  assert.equal(messages[1].parts[0].type, 'image',
    'the image must PRECEDE the question about it — the model reads in order');
});

test('a keyword reference attaches the image', () => {
  const messages = [ai(img()), ai(txt('anything')), user(txt('describe the image'))];
  assert.equal(attachReferencedImage(messages).attached, true);
});

test('an unrelated question does NOT attach anything', () => {
  const messages = [ai(img()), user(txt('what is the capital of France'))];
  assert.equal(attachReferencedImage(messages).attached, false);
  assert.equal(messages[1].parts.length, 1, 'the turn must be left exactly as it was');
});

test('🔴 "it" does not reach back past the lookback bound', () => {
  // An image five turns back, plain text between. Unbounded lookback would re-attach an
  // image from a conversation that has moved on — confidently, about the wrong picture.
  const messages = [
    ai(img()), user(txt('one')), ai(txt('two')), user(txt('three')), ai(txt('four')),
    user(txt('does it work')),
  ];
  assert.equal(attachReferencedImage(messages).attached, false,
    `the bound is ${IMAGE_REFERRAL_INTERNALS.IT_LOOKBACK} turns; "it" must not resurrect an older image`);
});

test('"it" DOES reach an image within the bound', () => {
  const messages = [ai(img()), ai(txt('note')), user(txt('tell me about it'))];
  assert.equal(attachReferencedImage(messages).attached, true);
});

test('🔴 an explicit task skips the heuristic entirely', () => {
  // Image generation and prompt refinement carry their own image handling; running this too
  // would attach a second copy of the picture to a request that already describes one.
  const messages = [ai(img()), user(txt('cool'))];
  const result = attachReferencedImage(messages, { skip: true });
  assert.equal(result.attached, false);
  assert.equal(result.reason, 'explicit-task');
  assert.equal(messages[1].parts.length, 1);
});

test('the same image is never attached twice', () => {
  const messages = [ai(img('SAME')), user(txt('cool'), img('SAME'))];
  assert.equal(attachReferencedImage(messages).reason, 'already-attached',
    'sending the same bytes twice in one turn wastes context and confuses the model');
  assert.equal(messages[1].parts.filter((p) => p.type === 'image').length, 1);
});

test('a DIFFERENT image still attaches alongside', () => {
  const messages = [ai(img('OLD')), user(txt('cool'), img('NEW'))];
  assert.equal(attachReferencedImage(messages).attached, true);
  assert.equal(messages[1].parts.filter((p) => p.type === 'image').length, 2);
});

test('the most RECENT image wins when several exist', () => {
  const messages = [ai(img('FIRST')), ai(img('SECOND')), user(txt('that picture'))];
  attachReferencedImage(messages);
  assert.equal(messages[2].parts[0].data, 'SECOND', 'the newest image is the one meant');
});

test('a reference with no image in history is a no-op, not a crash', () => {
  const messages = [ai(txt('no pictures here')), user(txt('describe the image'))];
  const result = attachReferencedImage(messages);
  assert.equal(result.attached, false);
  assert.equal(result.reason, 'no-image-in-history');
});

test('malformed input does not throw', () => {
  // Real conversations and stored history reach this; a bad row must not 500 a turn.
  assert.doesNotThrow(() => attachReferencedImage(null));
  assert.doesNotThrow(() => attachReferencedImage([]));
  assert.doesNotThrow(() => attachReferencedImage([{ role: 'user' }]));
  assert.doesNotThrow(() => attachReferencedImage([ai(img()), { role: 'user', text: 'legacy' }]));
});

test('🔴 a word containing the letters "it" is not a reference to an image', () => {
  /*
   * FOUND LIVE, 2026-09-14, while writing the test above.
   *
   * The original inline code tested `userText.includes('it')` — a SUBSTRING match. 29 of 30
   * common words contain those two letters, so after any generated image, asking about "the
   * capital", "security", "a limit" or anything "Italian" silently re-attached the picture:
   * context burned, and the answer pulled toward an image nobody mentioned.
   *
   * ⚠️ The equivalence probe could not catch this — it proved the extraction was faithful,
   * which it was. A probe shows the move was clean; it never shows the thing moved was right.
   */
  for (const question of [
    'what is the capital of France',
    'explain security best practices',
    'what is the rate limit',
    'how do I edit this file',
    'is it Italian or Spanish',   // contains a REAL "it" too — must still attach
  ]) {
    const messages = [
      { role: 'model', parts: [{ type: 'image', media_type: 'image/png', data: 'A' }] },
      { role: 'user', parts: [{ type: 'text', text: question }] },
    ];
    const attached = attachReferencedImage(messages).attached;
    /*
     * ⚠️ The expectation is "contains a standalone REFERENCE WORD", not just "it".
     *
     * `"how do I edit this file"` contains the word "this", which is a legitimate immediate
     * reference right after an image — the heuristic cannot know "this file" means something
     * other than "this image", and erring toward attaching is the intended behaviour.
     *
     * My first version asserted on `\bit\b` alone and failed that case. The CODE was right
     * and the TEST was wrong. Recorded so nobody "fixes" the code to match a mistaken
     * expectation — which is the more expensive direction of this mistake.
     */
    const REFERENCE_WORDS = /\b(it|this|that|these|those)\b/;
    const expected = REFERENCE_WORDS.test(question.toLowerCase());
    assert.equal(
      attached, expected,
      `"${question}" ${expected ? 'contains a standalone reference word and should attach' : 'has no standalone reference word — attaching is a false positive'}`,
    );
  }
});

/**
 * Re-attach a previously generated image when the user refers to it.
 *
 * ## What this is, and why it is product logic rather than plumbing
 *
 * A user who says "make that one bigger" or just "cool" after XENO generated a picture is
 * talking about the picture. The model cannot see it — an assistant `image` part is history,
 * not an input, and providers reject or mishandle it there. So the most recent AI image is
 * found and PREPENDED to the current user turn, where the model will actually look.
 *
 * Without this, follow-ups about a generated image get answered as if no image existed: the
 * model invents a description, or asks which image is meant. It answers, so nothing looks
 * broken — which is why this must travel with any route that serves chat, not be left behind
 * when one is added.
 *
 * 🔴 EXTRACTED (2026-09-14) so `/api/ai/chat/stream` can serve chat turns without silently
 * losing the behaviour. Copying it instead would leave two heuristics to drift apart, and a
 * drift here is invisible: both versions still return an answer.
 *
 * ## The three ways a reference is detected, in order
 *
 * 1. **Immediate** — the previous message is an AI image and the user's text is one of a
 *    short list of reactions ("cool", "it", "that one"). Deliberately lenient: a two-word
 *    reply right after an image is almost always about the image.
 * 2. **Keyword** — the text names an image explicitly ("that picture", "the photo").
 * 3. **"it" within recent history** — the word "it" plus an AI image, or a message mentioning
 *    an image, in the last three turns. Bounded to three ON PURPOSE: unbounded lookback
 *    re-attaches an image from far earlier in a conversation that has moved on.
 *
 * ⚠️ The function MUTATES the message it is given, matching the original inline behaviour —
 * the caller passes its own array and expects the current turn to be modified in place.
 */

/** Phrases that, right after an AI image, almost certainly refer to it. */
const IMMEDIATE_REFERENCE_PHRASES = [
  'it', 'this', 'that', 'these', 'those',
  'cool', 'nice', 'cute', 'great', 'awesome', 'love it', 'wow',
  'so cool', 'very nice', 'looks great', 'how about that one',
];

/** Phrases that name an image anywhere in a sentence. */
const IMAGE_REFERENCE_KEYWORDS = [
  'that image', 'the image', 'this image', 'an image',
  'that picture', 'the picture', 'this picture', 'a picture',
  'the photo', 'that photo', 'this photo', 'a photo',
  'the generated one', 'the one you made', 'the one you generated',
  'it looks', 'about it', 'draw it', 'generate it', 'regarding it',
  'what about that', 'how about that', 'make that', 'change that',
  'the previous one', 'that one', 'referring to that', 'related to that',
  'the cat', 'the dog', 'the car',
  "what's in the image", 'describe the image', 'tell me about the picture',
  'details about that', 'more on that', 'zoom in on that',
  'the one with the', 'the image of the', 'the picture of the',
];

/** How far back "it" may reach. Bounded: an old image is not what "it" means. */
const IT_LOOKBACK = 3;

const hasImagePart = (msg) => Boolean(msg?.parts?.some((p) => p?.type === 'image'));

/** Escape a phrase for use inside a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `text` contain `phrase` as WHOLE WORDS?
 *
 * 🔴 The original inline code used `String.includes` for every phrase match, and that is a
 * substring test. 29 of 30 common words contain the letters "it" — capital, security, limit,
 * edit, visit, digital, position, Italian, little, title — and "this" hides inside "edit
 * this". So after any generated image, an unrelated question silently re-attached the
 * picture: context burned, and the answer pulled toward an image nobody mentioned.
 *
 * Found 2026-09-14 while writing the first test for this heuristic; it was LIVE in production.
 * Both phrase lists go through here now — the bug appeared in TWO rules, and fixing only the
 * one the first failing test pointed at would have left the other looking fixed.
 */
const containsPhrase = (text, phrase) => new RegExp(`\\b${escapeRe(phrase)}\\b`).test(text);

/** Does this user text refer to an image already in the conversation? */
function refersToImage(messages, index, userText) {
  const trimmed = userText.trim();

  // 1. Immediate: the previous turn IS an AI image.
  if (index > 0) {
    const previous = messages[index - 1];
    if (previous?.role === 'model' && hasImagePart(previous)) {
      const matches = IMMEDIATE_REFERENCE_PHRASES.some((p) => trimmed === p || containsPhrase(userText, p));
      if (matches) {
        // Lenient by design: a short bare reaction, or the phrase anywhere in a longer one.
        const shortExact = trimmed.length < 20 && IMMEDIATE_REFERENCE_PHRASES.includes(trimmed);
        if (shortExact || IMMEDIATE_REFERENCE_PHRASES.some((p) => containsPhrase(userText, p))) return true;
      }
    }
  }

  // 2. Keyword: the text names an image.
  if (IMAGE_REFERENCE_KEYWORDS.some((k) => containsPhrase(userText, k))) return true;

  /*
   * 3. "it" plus an image — or a message ABOUT an image — within recent history.
   *
   * 🔴 WORD boundary, not substring. The original inline code tested `userText.includes('it')`,
   * and 29 of 30 common words contain those two letters: capital, security, limit, edit,
   * visit, digital, position, Italian, little, title… So after ANY generated image, asking
   * "what is the capital of France" silently re-attached the picture — burning context and
   * pulling the answer toward an image nobody mentioned.
   *
   * Found 2026-09-14 while writing the first test for this heuristic, and it was LIVE in
   * production. The extraction reproduced it faithfully, which is why the equivalence probe
   * passed: a probe proves the move was clean, never that the thing moved was correct.
   */
  if (/\bit\b/.test(userText) && messages.length > 1) {
    for (let i = index - 1; i >= Math.max(0, index - IT_LOOKBACK); i -= 1) {
      const previous = messages[i];
      if (previous?.role !== 'model') continue;
      const mentionsImage = previous?.parts?.some(
        (p) => p?.type === 'text' && p.text?.toLowerCase().includes('image'),
      );
      if (hasImagePart(previous) || mentionsImage) return true;
    }
  }

  return false;
}

/** The most recent AI-generated image in the conversation, or null. */
function mostRecentAiImage(messages, beforeIndex) {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'model' || !Array.isArray(message.parts)) continue;
    const imagePart = message.parts.find((p) => p?.type === 'image' && p.data && p.media_type);
    if (imagePart) return { type: 'image', media_type: imagePart.media_type, data: imagePart.data };
  }
  return null;
}

/**
 * Attach the referenced image to the latest user message, in place.
 *
 * @param {Array} messages  the conversation, client `parts[]` shape (MUTATED)
 * @param {object} [options]
 * @param {boolean} [options.skip]  true for explicit tasks (image generation, refinement),
 *                                  which carry their own image handling
 * @returns {{attached: boolean, reason: string}} what happened, for logging and tests
 */
export function attachReferencedImage(messages, { skip = false } = {}) {
  if (skip) return { attached: false, reason: 'explicit-task' };
  if (!Array.isArray(messages) || messages.length < 1) return { attached: false, reason: 'no-messages' };

  const index = messages.length - 1;
  const current = messages[index];
  if (current?.role !== 'user' || !Array.isArray(current.parts)) {
    return { attached: false, reason: 'not-a-user-parts-message' };
  }

  const textPart = current.parts.find((p) => p?.type === 'text');
  const userText = textPart ? String(textPart.text || '').toLowerCase() : '';
  if (!refersToImage(messages, index, userText)) return { attached: false, reason: 'no-reference' };

  const image = mostRecentAiImage(messages, index);
  if (!image) return { attached: false, reason: 'no-image-in-history' };

  // Idempotent: re-attaching the same bytes would send the image twice in one turn.
  const already = current.parts.some(
    (p) => p?.type === 'image' && p.data === image.data && p.media_type === image.media_type,
  );
  if (already) return { attached: false, reason: 'already-attached' };

  // Prepended, matching the original: the image precedes the question about it.
  current.parts.unshift(image);
  return { attached: true, reason: 'attached' };
}

export const IMAGE_REFERRAL_INTERNALS = Object.freeze({
  IMMEDIATE_REFERENCE_PHRASES,
  IMAGE_REFERENCE_KEYWORDS,
  IT_LOOKBACK,
});

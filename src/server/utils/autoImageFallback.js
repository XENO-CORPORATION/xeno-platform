/**
 * Generate a picture when the model answers an image request with nothing.
 *
 * ## What this is
 *
 * Ask a text model to "draw a cyberpunk cafe" and it often returns EMPTY content — it knows
 * it cannot draw, and some models say nothing rather than refuse. The user sees a blank
 * reply. This catches that: empty text plus an image-sounding prompt, so generate the image
 * and answer with it.
 *
 * 🔴 EXTRACTED (2026-09-14) so `/api/ai/chat/stream` behaves the same way. It lived only in
 * `/api/chat/generate`, and a chat route without it returns the blank reply — which reads as
 * the product being broken, not as a model limitation.
 *
 * ⚠️ NOT the `task: 'image'` pipeline. That one is an explicit request, and it writes the
 * result to disk, registers a library item and logs credits. This is a FALLBACK: the image
 * rides back in the response, nothing is persisted, and it fires only when the model has
 * already produced nothing. The two are deliberately separate.
 *
 * ## Two properties worth keeping
 *
 * - **It only runs on EMPTY output.** A model that answered in words has answered; generating
 *   a picture over the top of that would replace a real response with a guess about intent.
 * - **A generation failure is swallowed, not thrown.** The turn already has a (blank) answer
 *   and the user has been billed for it; failing the whole request to report that a bonus
 *   image did not work trades a poor answer for no answer.
 */

/** Words that suggest the user wanted a picture. */
const IMAGE_PROMPT_PATTERN = /(create|generate|draw|paint|sketch|render|make|illustrate|image|photo|picture|drawing|illustration|art|portrait|painting|wallpaper|watercolor|cafe|cyberpunk|anime)/i;

/** The text of the last user turn, from either message shape. */
function lastUserPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = [...list].reverse().find((m) => m?.role === 'user');
  if (typeof lastUser?.content === 'string') return lastUser.content;
  if (Array.isArray(lastUser?.parts)) return lastUser.parts.find((p) => p?.type === 'text')?.text || '';
  return '';
}

/**
 * @param {object} o
 * @param {string} o.outputText   the model's text — the fallback runs only when this is empty
 * @param {Array}  o.messages     the turn, to read the user's prompt from
 * @param {object} o.imageClient  the image gateway; absent means the fallback is unavailable
 * @returns {Promise<{imageData: string, outputText: string} | null>} null when it did not fire
 */
export async function autoImageFallback({ outputText, messages, imageClient }) {
  // A model that answered in words has answered.
  if (outputText && outputText.trim() !== '') return null;
  if (!imageClient) return null;

  const prompt = lastUserPrompt(messages);
  if (!prompt || !IMAGE_PROMPT_PATTERN.test(prompt)) return null;

  try {
    const response = await imageClient.image.generate({
      model: 'gpt-image-2',
      prompt,
      width: 1024,
      height: 1024,
      n: 1,
      response_format: 'b64_json',
    });
    const item = response?.data?.[0];
    if (!item) return null;
    // Providers disagree on the field name, and some return a data: URL instead.
    const base64 = item.b64_json
      || item.base64
      || (typeof item.url === 'string' && item.url.startsWith('data:') ? item.url.split(',')[1] : null);
    if (!base64) return null;
    return { imageData: base64, outputText: `Generated image with GPT Image 2: "${prompt}"` };
  } catch {
    // Swallowed on purpose — see the docblock. A failed bonus image must not fail the turn.
    return null;
  }
}

export const AUTO_IMAGE_INTERNALS = Object.freeze({ IMAGE_PROMPT_PATTERN });

/**
 * Convert the chat client's `parts[]` messages into OpenAI-shaped messages.
 *
 * ## Why this is a module and not a copy
 *
 * The XENO chat client sends `{ role, parts: [{type:'text'|'image'|'file', …}] }` — its own
 * shape, carrying attachments and model-generated image history. Every upstream provider
 * wants OpenAI's `{ role, content: string | ContentPart[] }`.
 *
 * That conversion lived inline in `/api/chat/generate` and nowhere else, which is exactly
 * why `/api/ai/chat/stream` — a complete, metered streaming endpoint — could not be used by
 * the product: pointing the client at it would have silently dropped every image, PDF and
 * text attachment, because it forwards `messages` upstream untouched.
 *
 * 🔴 The alternative was to copy these rules into the second route. Two copies of a
 * conversion is how the two routes come to disagree about what an attachment IS — and the
 * disagreement is invisible, because both still return a plausible answer. So: one
 * implementation, two callers.
 *
 * ## The rules, each of which is load-bearing
 *
 * - **Assistant text is CLEANED, user text is not.** A stored assistant turn may contain
 *   "Thinking Process:" / "Final Answer:" scaffolding; replaying that verbatim teaches the
 *   model to emit more of it. `cleanAssistantText` strips it.
 * - **Images attach to USER messages only.** An `image` part on an assistant message is
 *   history of something the model produced, not an input, and providers reject or
 *   mishandle it. The caller's image-referral heuristic is what re-attaches a past image to
 *   the current user turn when the user refers to it.
 * - **A PDF rides as an `image_url` data URI.** That is what the OpenRouter-fronted catalog
 *   accepts; it is not a mistake.
 * - **A text file becomes labelled text**, so the model knows it is reading a file rather
 *   than the user's own words.
 * - **An unprocessable attachment becomes a placeholder line** rather than vanishing: the
 *   model should know something was attached that it cannot read.
 * - **Single text part → string content.** Providers prefer a bare string for simple turns,
 *   and some behave differently with a one-element array.
 * - **Legacy `msg.text` still works** — older stored conversations have no `parts`.
 */

/** Collapse runs of blank lines and strip wrapping markdown emphasis. */
export const cleanTextContent = (text) => (
  text
    ? text.replace(/\n{3,}/g, '\n\n').replace(/^\s*([*_]{1,2})\s*|\s*([*_]{1,2})\s*$/g, '').trim()
    : ''
);

/**
 * Strip reasoning scaffolding from a stored assistant turn.
 *
 * Prefers the "Final Answer:" marker. A turn with "Thinking Process:" and NO final answer is
 * dropped entirely — it is scaffolding with no conclusion, and feeding it back as history
 * models the behaviour we do not want.
 */
export function cleanAssistantText(fullText) {
  const thinkingRegex = /^\s*(?:#{1,6}[\s]*)?\**?Thinking Process[:]?\**?\s*/im;
  const answerRegex = /^\s*(?:#{1,6}[\s]*)?\**?Final Answer[:]?\**?\s*/im;

  const trimmedText = String(fullText ?? '').trim();
  const thinkingMatchIndex = trimmedText.search(thinkingRegex);
  const answerMatchIndex = trimmedText.search(answerRegex);

  let finalAnswerContent = trimmedText;
  if (answerMatchIndex !== -1) {
    const answerMarkerMatch = trimmedText.substring(answerMatchIndex).match(answerRegex);
    const answerStartIndex = answerMatchIndex + (answerMarkerMatch ? answerMarkerMatch[0].length : 0);
    finalAnswerContent = trimmedText.substring(answerStartIndex).trim();
  } else if (thinkingMatchIndex !== -1) {
    finalAnswerContent = '';
  }
  return { answer: cleanTextContent(finalAnswerContent) };
}

/** One `parts[]` message → an OpenAI content array (may be empty). */
function contentPartsFor(msg, role) {
  const contentParts = [];

  if (msg?.parts && Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      if (part?.type === 'text' && part.text && part.text.trim() !== '') {
        // Only ASSISTANT text is cleaned — the user's own words are never rewritten.
        const textForPart = role === 'assistant' ? cleanAssistantText(part.text).answer : part.text;
        if (textForPart && textForPart.trim() !== '') {
          contentParts.push({ type: 'text', text: textForPart });
        }
      } else if (part?.type === 'image' && part.media_type && part.data) {
        // User only: an assistant image is history, not an input.
        if (role === 'user') {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${part.media_type};base64,${part.data}` },
          });
        }
      } else if (part?.type === 'file' && part.name && part.media_type && part.data_type && part.data) {
        if (part.media_type === 'application/pdf' && part.data_type === 'base64') {
          if (role === 'user') {
            // A PDF rides as an image_url data URI — what the catalog accepts.
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:application/pdf;base64,${part.data}` },
            });
          }
        } else if (part.data_type === 'text') {
          contentParts.push({ type: 'text', text: `Content of file "${part.name}":\n\n${part.data}` });
        } else if (role === 'user') {
          // Named, not dropped: the model should know something unreadable was attached.
          contentParts.push({ type: 'text', text: `[Attached file: ${part.name} of type ${part.media_type}]` });
        }
      }
    }
  } else if (msg?.text && msg.text.trim() !== '') {
    // Legacy shape — older stored conversations have no `parts`.
    const textContent = role === 'assistant' ? cleanAssistantText(msg.text).answer : msg.text;
    if (textContent && textContent.trim() !== '') {
      contentParts.push({ type: 'text', text: textContent });
    }
  }

  return contentParts;
}

/**
 * Convert a `parts[]` conversation into OpenAI-shaped messages.
 *
 * @param {Array} messages    the client's messages (`role` of 'model' means assistant)
 * @param {object} [options]
 * @param {string|null} [options.systemPrompt]  prepended as a system message when present
 * @returns {Array} OpenAI-shaped messages; messages that produce no content are dropped
 */
export function toProviderMessages(messages, { systemPrompt = null } = {}) {
  const apiMessages = [];
  if (systemPrompt && String(systemPrompt).trim() !== '') {
    apiMessages.push({ role: 'system', content: String(systemPrompt).trim() });
  }

  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = msg?.role === 'model' ? 'assistant' : msg?.role;
    if (!role) continue;
    const contentParts = contentPartsFor(msg, role);
    if (contentParts.length === 0) continue; // nothing survived conversion — drop the turn

    // A single text part goes as a STRING: providers prefer it for simple turns, and some
    // treat a one-element array differently.
    if (contentParts.length === 1 && contentParts[0].type === 'text') {
      apiMessages.push({ role, content: contentParts[0].text });
    } else {
      apiMessages.push({ role, content: contentParts });
    }
  }

  return apiMessages;
}

/** True when a message list is in the client's `parts[]` shape rather than OpenAI's. */
export const looksLikePartsShape = (messages) =>
  Array.isArray(messages) && messages.some((m) => Array.isArray(m?.parts));

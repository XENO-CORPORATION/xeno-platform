/**
 * The `ask_user` tool — the model asks the person a multiple-choice question and the chat shows it as
 * a panel above the composer instead of "A) … B) …" written as prose.
 *
 * Mirrors run_code / generate_image: a schema offered to the model plus a pure argument parser, kept
 * model-free so the loop stays testable in CI.
 *
 * ## It ENDS the turn — it never waits inside the request (2026-10-02)
 * A tool that needs a human cannot hold the SSE response open while they think: the platform runs
 * several backend replicas, so the answer could reach a process that is not holding the turn; the
 * edge closes idle connections; and every open iteration holds credits. So the loop stops at the
 * question, the turn is saved with the question as a pending step, and the answer arrives as the
 * next user message. Nothing is held while the person decides, and a reload loses nothing — the
 * human-in-the-loop "interrupt and resume" shape, rather than an in-process wait.
 */

/** Hard limits, also enforced by the turn-record validator (chatTurnRecord.js) and the client. */
export const ASK_USER_LIMITS = Object.freeze({
  question: 300,
  optionLabel: 300,
  options: { min: 2, max: 6 },
});

export const ASK_USER_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'ask_user',
    description:
      'Ask the person a multiple-choice question and wait for their answer. The chat shows it as a ' +
      'panel with one clickable row per option, so do NOT also write the options as text. Put any ' +
      'context the person needs (a scenario, a code snippet) in your message BEFORE calling this; keep ' +
      '`question` to the short question itself. Use it when you need the person to choose — a quiz ' +
      'answer, a decision between approaches, which of several things they meant. Do not use it for ' +
      'yes/no confirmations of something you can simply do. After calling it, stop: the person’s ' +
      'answer arrives as their next message.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The short question, one sentence. The context belongs in your message above it.',
        },
        options: {
          type: 'array',
          minItems: ASK_USER_LIMITS.options.min,
          maxItems: ASK_USER_LIMITS.options.max,
          items: { type: 'string' },
          description:
            'The choices, in order; they are shown lettered A, B, C… Write each as the complete option ' +
            '(a full sentence is fine). Do not prefix them with letters or numbers.',
        },
        multiple: {
          type: 'boolean',
          description: 'true when the person may choose more than one option ("select all that apply").',
        },
      },
      required: ['question', 'options'],
    },
  },
});

// "A) …", "b. …", "(3) …", "1: …" — the model sometimes letters the options itself even when told not
// to; the panel letters them, so a leading label would read "A. A) Use EFS".
const LEADING_LABEL = /^\s*(?:\(?[A-Za-z]\)|[A-Za-z][.:]|\(?\d{1,2}\)|\d{1,2}[.:])\s+/;

const clip = (value, max) => {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * Parse an `ask_user` call's arguments. Pure: returns `{ ok, question, options, multiple }` or
 * `{ ok: false, error }`. Never throws — a malformed call becomes a tool result the model can read
 * and correct on its next iteration, the same contract as the other tools.
 */
/** The question shown when the model supplied none and its message has no question line either. */
export const ASK_USER_DEFAULT_QUESTION = 'Choose an option';

/**
 * The question a model wrote in its MESSAGE instead of in the `question` field: the last line ending
 * in "?", with markdown quote/emphasis markers stripped. Empty when there is none.
 */
export function questionFromText(text) {
  const lines = String(text || '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:>\s*)+/, '').replace(/[*_`#]/g, '').trim())
    .filter((line) => line.endsWith('?'));
  return lines.length ? lines[lines.length - 1] : '';
}

export function parseAskUserArguments(raw, { fallbackText = '' } = {}) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'ask_user arguments were not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'ask_user arguments must be an object' };

  /*
   * A missing question is NOT a refusal (2026-10-03). Gemini routinely writes the question in its message
   * and sends only `options` — measured on a replay of a real quiz conversation. Refusing turned that into
   * an error tool result, and the model then fell back to writing "A) … B) …" as prose: exactly what the
   * tool exists to prevent. The options are the part only the call can carry; the question is recovered
   * from the message, or a neutral prompt is shown, since the message above already says what is asked.
   */
  const given = typeof parsed.question === 'string' ? clip(parsed.question, ASK_USER_LIMITS.question) : '';
  const question = given || clip(questionFromText(fallbackText), ASK_USER_LIMITS.question) || ASK_USER_DEFAULT_QUESTION;

  if (!Array.isArray(parsed.options)) return { ok: false, error: 'ask_user needs `options` as an array of strings' };
  const options = [];
  for (const option of parsed.options) {
    // An option given as {label} is accepted — some models emit objects even for a string array.
    const value = typeof option === 'string' ? option : (option && typeof option.label === 'string' ? option.label : '');
    const text = clip(value.replace(LEADING_LABEL, ''), ASK_USER_LIMITS.optionLabel);
    if (text) options.push(text);
  }
  const { min, max } = ASK_USER_LIMITS.options;
  if (options.length < min) return { ok: false, error: `ask_user needs at least ${min} non-empty options` };
  if (options.length > max) return { ok: false, error: `ask_user takes at most ${max} options` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return { ok: false, error: 'ask_user options must be distinct' };
  }

  return { ok: true, question, options, multiple: parsed.multiple === true };
}

/** The tool result for a SECOND question in one turn: one question at a time, then wait. */
export const askUserAlreadyPendingPayload = () => ({
  error: 'a question is already waiting for the person in this turn; ask one question at a time',
});

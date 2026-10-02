/**
 * ask_user, the client half — pure, no React. ChatWithLLM owns the state; ChatQuestionPanel draws it.
 *
 * The model asks with the ask_user tool and the turn ENDS on the question (chatAskUserTool.js). The
 * person's answer is their NEXT MESSAGE, written in one fixed form by `formatAnswer`, so:
 *   - nothing is held open while they decide, and a reload loses nothing;
 *   - a saved turn is never edited — "answered" is DERIVED: a question is answered once a message
 *     follows it, and which options were chosen is read back from that message by `readAnswer`;
 *   - every model (Gemini, Claude, GPT) receives a plain conversation it understands, even if the
 *     person switches models between the question and the answer.
 */
import type { ChatTurnQuestionStep } from './chatTurnTranscript';

export const optionLetter = (index: number): string => String.fromCharCode(65 + index);

/**
 * The message an answer becomes. One line per chosen option, lettered as the panel showed it, then the
 * reason on its own line. Deterministic, so `readAnswer` can recover the choice from the saved text.
 */
export function formatAnswer(step: ChatTurnQuestionStep, picked: readonly number[], reason = ''): string {
  const lines = [...new Set(picked)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < step.options.length)
    .sort((a, b) => a - b)
    .map((i) => `${optionLetter(i)}. ${step.options[i]}`);
  const why = reason.replace(/\s+/g, ' ').trim();
  return why ? `${lines.join('\n')}\n\nWhy: ${why}` : lines.join('\n');
}

export interface ReadAnswer {
  /** Option indices the message chose, in order. Empty when the person answered in their own words. */
  picked: number[];
  /** The reason they gave, when the message carried one. */
  reason: string;
  /** True when the message is not in `formatAnswer`'s form — they typed their own answer. */
  ownWords: boolean;
}

/**
 * Recover the choice from an answer message. Exact: a line counts only if it is `<letter>. <option>`
 * with that option's EXACT text, so a typed reply that happens to start with "A." is "own words", never
 * a misread choice.
 */
export function readAnswer(step: ChatTurnQuestionStep, text: string): ReadAnswer {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  const [head, ...rest] = normalized.split(/\n\nWhy: /);
  const reason = rest.join('\n\nWhy: ').trim();
  const lines = head.split('\n').map((line) => line.trim()).filter(Boolean);
  const picked: number[] = [];
  for (const line of lines) {
    const index = step.options.findIndex((option, i) => line === `${optionLetter(i)}. ${option}`);
    if (index === -1) return { picked: [], reason: '', ownWords: true };
    if (!picked.includes(index)) picked.push(index);
  }
  if (picked.length === 0 || (!step.multiple && picked.length > 1)) return { picked: [], reason: '', ownWords: true };
  return { picked, reason, ownWords: false };
}

/**
 * The question as the MODEL sees it in later turns. History carries only the prose of a reply, never
 * its tool calls (chatMessageParts.js), so without this the model would not know what it had asked
 * and an answer like "C. Amazon EFS" would arrive without its question.
 */
export function questionHistoryNote(step: ChatTurnQuestionStep): string {
  const options = step.options.map((option, i) => `${optionLetter(i)}. ${option}`).join('\n');
  const kind = step.multiple ? 'a select-all-that-apply question' : 'a question';
  return `[You asked the user ${kind} with the ask_user tool: ${step.question}\n${options}]`;
}

interface MessageLike {
  id: string;
  sender: string;
  isError?: boolean;
  isStreaming?: boolean;
  turn?: { steps?: Array<{ kind: string }> };
}

/**
 * The question the conversation is waiting on, if any: the LAST message is a finished assistant turn
 * that ended on a question. Anything after it (an answer, a new prompt) means it is no longer pending.
 */
export function pendingQuestion<M extends MessageLike>(messages: readonly M[]): { messageId: string; step: ChatTurnQuestionStep } | null {
  const last = messages[messages.length - 1];
  if (!last || last.sender !== 'ai' || last.isError || last.isStreaming) return null;
  const step = last.turn?.steps?.find((s) => s.kind === 'question') as ChatTurnQuestionStep | undefined;
  return step ? { messageId: last.id, step } : null;
}

/**
 * How a question resolved, for the one-line record in the turn: the message that FOLLOWS it is its
 * answer. Null while nothing follows (still pending).
 */
export function questionOutcome<M extends MessageLike & { text?: string }>(
  messages: readonly M[], messageId: string, step: ChatTurnQuestionStep,
): ReadAnswer | null {
  const at = messages.findIndex((m) => m.id === messageId);
  const next = at >= 0 ? messages[at + 1] : undefined;
  if (!next || next.sender !== 'user') return null;
  return readAnswer(step, next.text || '');
}

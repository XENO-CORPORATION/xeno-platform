/**
 * The chat's prompt queue — pure state, no React. ChatWithLLM owns the state; ChatQueue.tsx draws it.
 *
 * A queued prompt waits while a reply is being written and is sent, in order, when the chat is free.
 * Every transition here returns a NEW state (never mutates), so React sees each change and the queue's
 * auto-send effect re-evaluates on it — including a queued attachment finishing its malware scan.
 */

/** A file attached to a prompt. `ready` is false until the upload's malware scan clears; an unready
 * attachment is never sent (the composer applies the same rule). Structurally the composer's own
 * AttachedFile, restated here so this module has no dependency on the 20k-line component. */
export interface QueuedAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  ready?: boolean;
}

export interface QueuedMessage<F extends QueuedAttachment = QueuedAttachment> {
  id: string;
  text: string;
  attachedFiles: F[];
  timestamp: number;
}

export interface QueueState<F extends QueuedAttachment = QueuedAttachment> {
  messages: QueuedMessage<F>[];
  isExpanded: boolean;
}

export const emptyQueue = <F extends QueuedAttachment = QueuedAttachment>(): QueueState<F> => ({ messages: [], isExpanded: true });

/** Add a prompt at the END. Empty prompts (no text, no file) are refused: there is nothing to send. */
export function enqueue<F extends QueuedAttachment>(state: QueueState<F>, item: { id: string; text: string; attachedFiles: F[]; timestamp: number }): QueueState<F> {
  if (!item.text.trim() && item.attachedFiles.length === 0) return state;
  return { ...state, messages: [...state.messages, { ...item, attachedFiles: [...item.attachedFiles] }] };
}

export function removeQueued<F extends QueuedAttachment>(state: QueueState<F>, id: string): QueueState<F> {
  const messages = state.messages.filter((m) => m.id !== id);
  return messages.length === state.messages.length ? state : { ...state, messages };
}

/** Move the prompt at `from` to `to` (both clamped). Order is the send order. */
export function moveQueued<F extends QueuedAttachment>(state: QueueState<F>, from: number, to: number): QueueState<F> {
  const n = state.messages.length;
  if (from < 0 || from >= n) return state;
  const target = Math.max(0, Math.min(n - 1, to));
  if (target === from) return state;
  const messages = [...state.messages];
  const [moved] = messages.splice(from, 1);
  messages.splice(target, 0, moved);
  return { ...state, messages };
}

/** Replace a prompt's text and/or attachments. An edit that would leave it empty keeps the old text:
 * clearing a queued prompt is "remove", not "save nothing". */
export function updateQueued<F extends QueuedAttachment>(state: QueueState<F>, id: string, patch: { text?: string; attachedFiles?: F[] }): QueueState<F> {
  let changed = false;
  const messages = state.messages.map((m) => {
    if (m.id !== id) return m;
    const files = patch.attachedFiles ?? m.attachedFiles;
    const trimmed = patch.text === undefined ? m.text : patch.text.trim();
    const text = trimmed || (files.length === 0 ? m.text : trimmed);
    if (text === m.text && files === m.attachedFiles) return m;
    changed = true;
    return { ...m, text, attachedFiles: [...files] };
  });
  return changed ? { ...state, messages } : state;
}

/** Mark one of a prompt's attachments ready (its scan cleared). */
export function markQueuedFileReady<F extends QueuedAttachment>(state: QueueState<F>, fileId: string): QueueState<F> {
  let changed = false;
  const messages = state.messages.map((m) => {
    if (!m.attachedFiles.some((f) => f.id === fileId && f.ready === false)) return m;
    changed = true;
    return { ...m, attachedFiles: m.attachedFiles.map((f) => (f.id === fileId ? { ...f, ready: true } : f)) };
  });
  return changed ? { ...state, messages } : state;
}

/**
 * The prompt the queue would send next, or why it will not send anything yet. A held queue (someone
 * is editing or rearranging it) and a prompt whose attachment is still being scanned both WAIT —
 * nothing is removed until it can actually be sent, so a refusal never costs a prompt.
 */
export function nextSendable<F extends QueuedAttachment>(state: QueueState<F>, { held }: { held: boolean }):
  { item: QueuedMessage<F> } | { wait: 'empty' | 'held' | 'scanning' } {
  const item = state.messages[0];
  if (!item) return { wait: 'empty' };
  if (held) return { wait: 'held' };
  if (item.attachedFiles.some((f) => f.ready === false)) return { wait: 'scanning' };
  return { item };
}

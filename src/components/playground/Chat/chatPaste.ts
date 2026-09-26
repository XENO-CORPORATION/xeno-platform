/**
 * When a paste becomes a file, and the file it becomes.
 *
 * A large paste is turned into a `Pasted text.txt` attachment rather than a wall of inline text —
 * the ChatGPT behaviour. The threshold and the two rules live here, pure, so they can be tested
 * against the exact cases that reach them instead of a regex over the composer.
 */

/** A paste at or above this many characters becomes a file (owner decision, 2026-09-26). */
export const PASTE_TO_FILE_MIN_CHARS = 2000;

/**
 * Should this paste divert into a file? Only plain text does: a paste that carries real files or
 * images (`hasFiles`) is left to the browser, and text shorter than the threshold pastes inline.
 */
export function pasteBecomesFile(
  { text, hasFiles }: { text: string; hasFiles: boolean },
  minChars: number = PASTE_TO_FILE_MIN_CHARS,
): boolean {
  if (hasFiles) return false;
  return typeof text === 'string' && text.length >= minChars;
}

/** The attachment a diverted paste becomes — a real text/plain File the upload path can carry. */
export function makePastedTextFile(text: string): File {
  return new File([text], 'Pasted text.txt', { type: 'text/plain' });
}

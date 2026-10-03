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
 * Should this paste divert into a TEXT file? Only plain text does: a paste that carries real files or
 * images (`hasFiles`) is attached as those files instead (`pastedFiles`), and text shorter than the
 * threshold pastes inline.
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

/**
 * The files a paste carries — a screenshot, a copied image, files copied in the OS file manager.
 * A <textarea> does nothing with them, so "left to the browser" meant a pasted screenshot silently
 * vanished (found 2026-10-03). Reads `files` first and falls back to `items` (some browsers expose
 * a pasted image only as an item). A bare clipboard image arrives as "image.png"; it is renamed
 * "Pasted image.png" so the chip says where it came from.
 */
export function pastedFiles(data: { files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null } | null | undefined): File[] {
  if (!data) return [];
  let files = Array.from(data.files || []);
  if (!files.length) files = Array.from(data.items || []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
  return files.map((f) => (/^image.(png|jpe?g|gif|webp)$/i.test(f.name) ? new File([f], 'Pasted ' + f.name, { type: f.type, lastModified: f.lastModified }) : f));
}

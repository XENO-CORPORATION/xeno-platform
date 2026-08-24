import type { ElementDeclaration } from '../schema'

/**
 * `xeno.file-clock` - File history. A degenerate element (pure geometry, no children).
 *
 * `file`'s sheet and fold with a `clock` face where its text lines are. The family rule is in
 * `file-x.ts`: the mark takes the contents' place rather than sitting over them.
 *
 * The face is 9 units, and the size is the whole story of this glyph. A first attempt put it at 7, on
 * the theory that it would tuck neatly into the text area - at 7 the corner radius and the stroke weight
 * compete for the same pixels and it renders as a blob, which was clear the moment it was drawn at scale
 * and not before.
 *
 * At 9 it sits fully inside the sheet. An earlier version let it overhang the left edge, on the idea
 * that a badge breaking its object's outline reads as attached to it - but the two strokes cross, and
 * the crossing draws a line straight through the face. Inside, nothing crosses anything.
 *
 * part[0] = sheet, part[1] = fold, part[2] = clock face, part[3] = hands.
 */
export const FileClock: ElementDeclaration = {
  id: 'xeno.file-clock',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13 3H7a1.4 1.4 0 0 0-1.4 1.4v15.2A1.4 1.4 0 0 0 7 21h10a1.4 1.4 0 0 0 1.4-1.4V9z' },
      { kind: 'path', d: 'M13 3v6h6' },
      { kind: 'rect', x: 7.2, y: 10.8, w: 9, h: 9, rx: 1.8 },
      { kind: 'path', d: 'M11.7 12.9v2.4l1.8 1.1' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'File history' },
  meta: { tags: ['file', 'history', 'version', 'recent'], since: '0.2.0' },
}

export default FileClock

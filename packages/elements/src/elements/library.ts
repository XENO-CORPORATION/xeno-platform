import type { ElementDeclaration } from '../schema'

/**
 * `xeno.library` - Library. A degenerate element (pure geometry, no children).
 *
 * Three books on a shelf, the third leaning against the others. The lean is the whole glyph: three
 * upright bars are `list` or a bar chart, and it is the one that tips out of line that says these are
 * objects standing up rather than marks on a page.
 *
 * Sized against the set: the first draft spanned 19.9 of the 24 grid where the median glyph spans 17,
 * and a shelf that wide sat noticeably heavier than its neighbours in a row of controls.
 *
 * part[0..1] = the upright books, part[2] = the leaning one.
 */
export const Library: ElementDeclaration = {
  id: 'xeno.library',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.6, y: 4.8, w: 3.6, h: 14.4, rx: 1.1 },
      { kind: 'rect', x: 8.4, y: 4.8, w: 3.6, h: 14.4, rx: 1.1 },
      { kind: 'path', d: 'M13.8 6.8 17 5.9a1.1 1.1 0 0 1 1.35 0.78l2.25 8.4a1.1 1.1 0 0 1-0.78 1.35l-3.1 0.85z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Library' },
  meta: { tags: ['books', 'collection', 'reference'], since: '0.2.0' },
}

export default Library

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.quote` - Quote. A degenerate element (pure geometry, no children).
 *
 * Two marks, each a rounded square with a descender dropping from its lower left, the shape a quotation
 * mark has in a grotesque face - built out of this grammar rather than borrowed from a typeface, which
 * would have left one glyph in the set whose weight came from a font and changed with it.
 *
 * The descender runs a full 4 units. A short one turns each mark into a speech balloon with a tail, and
 * the set already has one of those; the length is what makes it read as type rather than as `message`.
 *
 * part[0] = the left mark, part[1] = the right one.
 */
export const Quote: ElementDeclaration = {
  id: 'xeno.quote',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M5 14V9.6A1.6 1.6 0 0 1 6.6 8h2.8A1.6 1.6 0 0 1 11 9.6v2.8A1.6 1.6 0 0 1 9.4 14H7.6l-2.4 4' },
      { kind: 'path', d: 'M13 14V9.6A1.6 1.6 0 0 1 14.6 8h2.8A1.6 1.6 0 0 1 19 9.6v2.8A1.6 1.6 0 0 1 17.4 14h-1.8l-2.4 4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Quote' },
  meta: { tags: ['quote', 'cite', 'excerpt'], since: '0.2.0' },
}

export default Quote

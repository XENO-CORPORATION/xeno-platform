import type { ElementDeclaration } from '../schema'

/**
 * `xeno.arrow-left-right` - Swap. A degenerate element (pure geometry, no children).
 *
 * Two shafts on separate rows with their heads at opposite ends. `arrow-right`'s head is copied exactly
 * - a 4-unit diagonal off a 3.5-unit run - so the arrow glyphs share one arrowhead. An arrowhead is the
 * most recognisable thing in a set this size, and a second one drawn slightly differently would read as
 * a second family rather than another member of this one.
 *
 * part[0] = the rightward arrow, part[1] = the leftward one, so they can pass each other.
 */
export const ArrowLeftRight: ElementDeclaration = {
  id: 'xeno.arrow-left-right',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 8.5h15M15 5l4 3.5-4 3.5' },
      { kind: 'path', d: 'M20 15.5H5M9 12l-4 3.5 4 3.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Swap' },
  meta: { tags: ['swap', 'exchange', 'transfer'], since: '0.2.0' },
}

export default ArrowLeftRight

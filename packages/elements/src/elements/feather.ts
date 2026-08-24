import type { ElementDeclaration } from '../schema'

/**
 * `xeno.feather` - Draft. A degenerate element (pure geometry, no children).
 *
 * A quill: the shaft running to its point, the vane hanging off it, and two barbs across. It reads as
 * writing rather than as a bird because the point is the lowest thing in the glyph - the end that
 * touches the paper - and everything else hangs above it.
 *
 * part[0] = shaft, part[1] = vane, part[2] = barbs.
 */
export const Feather: ElementDeclaration = {
  id: 'xeno.feather',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M3.6 20.4 12.6 11.4' },
      { kind: 'path', d: 'M8.6 15.4 7.4 9.8A6.6 6.6 0 0 1 14 3.6h6.4v6.4a6.6 6.6 0 0 1-6.2 6.6z' },
      { kind: 'path', d: 'M12.2 8.4h5.4M10.6 12.4h4.2' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Draft' },
  meta: { tags: ['write', 'draft', 'compose', 'quill'], since: '0.2.0' },
}

export default Feather

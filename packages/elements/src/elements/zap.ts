import type { ElementDeclaration } from '../schema'

/**
 * `xeno.zap` - Fast. A degenerate element (pure geometry, no children).
 *
 * A bolt: the one glyph in the set with no right angle in it. That is what it is for - everything else
 * here is built from a square, so the shape meaning "sudden" is the one that refuses the grid.
 */
export const Zap: ElementDeclaration = {
  id: 'xeno.zap',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13.4 2.8 5.2 13.4h5.6L10.6 21.2 18.8 10.6h-5.6z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Fast' },
  meta: { tags: ['bolt', 'fast', 'power', 'instant'], since: '0.2.0' },
}

export default Zap

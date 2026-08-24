import type { ElementDeclaration } from '../schema'

/**
 * `xeno.waves` - Waves. A degenerate element (pure geometry, no children).
 *
 * Three identical waves, stacked and offset by nothing - identical on purpose, so the motion can offset
 * them instead. A glyph that was already staggered at rest would have nowhere left to go.
 *
 * part[0..2] = top, middle, bottom.
 */
export const Waves: ElementDeclaration = {
  id: 'xeno.waves',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M2.6 7.4c1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0 1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0' },
      { kind: 'path', d: 'M2.6 12c1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0 1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0' },
      { kind: 'path', d: 'M2.6 16.6c1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0 1.6-1.9 3.2-1.9 4.7 0 1.6 1.9 3.2 1.9 4.7 0' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Waves' },
  meta: { tags: ['audio', 'signal', 'flow', 'water'], since: '0.2.0' },
}

export default Waves

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.arrow-up-right` - Leaving. A degenerate element (pure geometry, no children).
 *
 * One shaft on the diagonal, with the head drawn as the corner it points into rather than as two
 * separate strokes: at 45 degrees a V-shaped head and the shaft meet at angles too shallow to stay
 * distinct at 24px, and the corner keeps them apart.
 *
 * It is the arrow that does not lie on an axis, and that is the meaning - everything staying inside the
 * product moves along one.
 *
 * part[0] = shaft, part[1] = head.
 */
export const ArrowUpRight: ElementDeclaration = {
  id: 'xeno.arrow-up-right',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M6.5 17.5 17.5 6.5' },
      { kind: 'path', d: 'M9 6.5h8.5V15' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Open' },
  meta: { tags: ['external', 'open', 'leave'], since: '0.2.0' },
}

export default ArrowUpRight

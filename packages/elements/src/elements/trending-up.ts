import type { ElementDeclaration } from '../schema'

/**
 * `xeno.trending-up` - Trending up. A degenerate element (pure geometry, no children).
 *
 * A polyline that climbs, with the head drawn as the corner it arrives in - the same treatment as
 * `arrow-up-right`, for the same reason: on a diagonal a V-shaped head and its shaft meet too shallowly
 * to stay distinct at 24px.
 *
 * The dip in the middle is deliberate. A line that only rose would be a diagonal; what is being said is
 * that the direction survived a setback.
 *
 * part[0] = the line, part[1] = the head.
 */
export const TrendingUp: ElementDeclaration = {
  id: 'xeno.trending-up',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M3.5 17.5 9 12l3.4 3.4L20 7.8' },
      { kind: 'path', d: 'M14.6 7.8H20V13.2' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Trending up' },
  meta: { tags: ['chart', 'growth', 'increase'], since: '0.2.0' },
}

export default TrendingUp

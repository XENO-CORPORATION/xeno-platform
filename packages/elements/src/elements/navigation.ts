import type { ElementDeclaration } from '../schema'

/**
 * `xeno.navigation` - Location. A degenerate element (pure geometry, no children).
 *
 * A pointer: one long edge from the tail, and a notch cut into the base so the shape reads as a marker
 * rather than as a triangle. `send` is the near neighbour and the two must not collide - send is a plane
 * seen from above with its wings swept BACK, this is a needle with its point up, and the notch is what
 * tells them apart.
 */
export const Navigation: ElementDeclaration = {
  id: 'xeno.navigation',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 3.2 19.6 20.2 12 16.4 4.4 20.2z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Location' },
  meta: { tags: ['location', 'gps', 'direction', 'here'], since: '0.2.0' },
}

export default Navigation

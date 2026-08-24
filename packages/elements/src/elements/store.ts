import type { ElementDeclaration } from '../schema'

/**
 * `xeno.store` - Store. A degenerate element (pure geometry, no children).
 *
 * An awning over a shopfront, with the door standing open in it. The awning is what separates this from
 * `home`: both are a box with a lid, and the difference is that a roof comes to a point and an awning
 * does not. Keeping the awning flat-topped is what stops the two colliding at 24px.
 *
 * part[0] = awning, part[1] = the front, part[2] = the door.
 */
export const Store: ElementDeclaration = {
  id: 'xeno.store',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M3.2 9.4 4.8 4.6A1.2 1.2 0 0 1 6 3.8h12a1.2 1.2 0 0 1 1.2 0.8l1.6 4.8z' },
      { kind: 'path', d: 'M4.8 9.4V19a1.2 1.2 0 0 0 1.2 1.2h12a1.2 1.2 0 0 0 1.2-1.2V9.4' },
      { kind: 'path', d: 'M9.8 20.2v-5.4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v5.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Store' },
  meta: { tags: ['shop', 'market', 'marketplace'], since: '0.2.0' },
}

export default Store

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.user` — User. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const User: ElementDeclaration = {
  id: 'xeno.user',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 8, y: 3.5, w: 8, h: 8, rx: 1.5 },
      { kind: 'path', d: 'M4.5 20.5V18.5A2.5 2.5 0 0 1 7 16H17A2.5 2.5 0 0 1 19.5 18.5V20.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'User' },
  meta: { tags: ['person', 'account', 'avatar'], since: '0.1.0' },
}

export default User

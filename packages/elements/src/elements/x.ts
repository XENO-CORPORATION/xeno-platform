import type { ElementDeclaration } from '../schema'

/**
 * `xeno.x` — Close. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const X: ElementDeclaration = {
  id: 'xeno.x',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Close' },
  meta: { tags: ['cancel', 'dismiss', 'cross'], since: '0.1.0' },
}

export default X

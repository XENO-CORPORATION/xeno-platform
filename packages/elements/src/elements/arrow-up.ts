import type { ElementDeclaration } from '../schema'

/**
 * `xeno.arrow-up` — Arrow up. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const ArrowUp: ElementDeclaration = {
  id: 'xeno.arrow-up',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 20V5M6 11l6-6 6 6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Arrow up' },
  meta: { tags: ['top', 'north'], since: '0.1.0' },
}

export default ArrowUp

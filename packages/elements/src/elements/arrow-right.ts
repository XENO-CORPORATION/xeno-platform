import type { ElementDeclaration } from '../schema'

/**
 * `xeno.arrow-right` — Arrow right. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const ArrowRight: ElementDeclaration = {
  id: 'xeno.arrow-right',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 12h15M13 6l6 6-6 6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Arrow right' },
  meta: { tags: ['next', 'forward'], since: '0.1.0' },
}

export default ArrowRight

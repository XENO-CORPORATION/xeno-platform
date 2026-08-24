import type { ElementDeclaration } from '../schema'

/**
 * `xeno.chevron-right` — Chevron right. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const ChevronRight: ElementDeclaration = {
  id: 'xeno.chevron-right',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9 6l6 6-6 6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Chevron right' },
  meta: { tags: ['next', 'expand'], since: '0.1.0' },
}

export default ChevronRight

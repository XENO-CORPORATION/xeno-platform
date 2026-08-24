import type { ElementDeclaration } from '../schema'

/**
 * `xeno.chevron-down` — Chevron down. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const ChevronDown: ElementDeclaration = {
  id: 'xeno.chevron-down',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M6 9l6 6 6-6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Chevron down' },
  meta: { tags: ['expand', 'open'], since: '0.1.0' },
}

export default ChevronDown

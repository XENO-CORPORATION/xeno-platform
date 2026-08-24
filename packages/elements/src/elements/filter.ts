import type { ElementDeclaration } from '../schema'

/**
 * `xeno.filter` — Filter. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Filter: ElementDeclaration = {
  id: 'xeno.filter',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 5.5h16l-6 6.6V19l-4 2v-8.9z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Filter' },
  meta: { tags: ['funnel', 'sort'], since: '0.1.0' },
}

export default Filter

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.refresh` — Refresh. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Refresh: ElementDeclaration = {
  id: 'xeno.refresh',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M8 5.5H16.5A1.5 1.5 0 0 1 18 7V9' },
      { kind: 'path', d: 'M10.5 3 8 5.5 10.5 8' },
      { kind: 'path', d: 'M16 18.5H7.5A1.5 1.5 0 0 1 6 17V15' },
      { kind: 'path', d: 'M13.5 16 16 18.5 13.5 21' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Refresh' },
  meta: { tags: ['reload', 'sync', 'retry'], since: '0.1.0' },
}

export default Refresh

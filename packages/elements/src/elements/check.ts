import type { ElementDeclaration } from '../schema'

/**
 * `xeno.check` — Check. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Check: ElementDeclaration = {
  id: 'xeno.check',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 12.5l5 5L20 6.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Check' },
  meta: { tags: ['done', 'confirm', 'tick'], since: '0.1.0' },
}

export default Check

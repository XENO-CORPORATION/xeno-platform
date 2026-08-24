import type { ElementDeclaration } from '../schema'

/**
 * `xeno.code` — Code. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Code: ElementDeclaration = {
  id: 'xeno.code',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    // Split the two brackets so they can flex apart independently — part[0] = left "<", part[1] = right ">".
    base: [
      { kind: 'path', d: 'M9 8l-4 4 4 4' },
      { kind: 'path', d: 'M15 8l4 4-4 4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Code' },
  meta: { tags: ['brackets', 'dev'], since: '0.1.0' },
}

export default Code

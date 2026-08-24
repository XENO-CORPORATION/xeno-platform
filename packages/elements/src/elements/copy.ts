import type { ElementDeclaration } from '../schema'

/**
 * `xeno.copy` — Copy. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Copy: ElementDeclaration = {
  id: 'xeno.copy',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 9, y: 9, w: 11, h: 11, rx: 1.5 },
      { kind: 'path', d: 'M5 15V5a1.4 1.4 0 0 1 1.4-1.4H16' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Copy' },
  meta: { tags: ['duplicate', 'clone'], since: '0.1.0' },
}

export default Copy

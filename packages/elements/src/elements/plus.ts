import type { ElementDeclaration } from '../schema'

/**
 * `xeno.plus` — Plus. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Plus: ElementDeclaration = {
  id: 'xeno.plus',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 11.1, y: 5, w: 1.8, h: 14, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 5, y: 11.1, w: 14, h: 1.8, rx: 0.4, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Plus' },
  meta: { tags: ['add', 'new', 'create'], since: '0.1.0' },
}

export default Plus

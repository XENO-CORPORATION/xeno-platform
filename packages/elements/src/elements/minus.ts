import type { ElementDeclaration } from '../schema'

/**
 * `xeno.minus` — Minus. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Minus: ElementDeclaration = {
  id: 'xeno.minus',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 5, y: 11.1, w: 14, h: 1.8, rx: 0.4, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Minus' },
  meta: { tags: ['remove', 'subtract'], since: '0.1.0' },
}

export default Minus

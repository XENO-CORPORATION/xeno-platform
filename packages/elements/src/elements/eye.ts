import type { ElementDeclaration } from '../schema'

/**
 * `xeno.eye` — Eye. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Eye: ElementDeclaration = {
  id: 'xeno.eye',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M2.5 12 6 8.5H18L21.5 12 18 15.5H6Z' },
      { kind: 'rect', x: 9.6, y: 9.6, w: 4.8, h: 4.8, rx: 1, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Eye' },
  meta: { tags: ['view', 'visible', 'show'], since: '0.1.0' },
}

export default Eye

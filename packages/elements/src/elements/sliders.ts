import type { ElementDeclaration } from '../schema'

/**
 * `xeno.sliders` — Sliders. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Sliders: ElementDeclaration = {
  id: 'xeno.sliders',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4, y: 7.1, w: 9, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 17, y: 7.1, w: 3, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 4, y: 15.1, w: 3, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 11, y: 15.1, w: 9, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 12.5, y: 5.5, w: 5, h: 5, rx: 1 },
      { kind: 'rect', x: 6.5, y: 13.5, w: 5, h: 5, rx: 1 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Sliders' },
  meta: { tags: ['settings', 'adjust', 'controls'], since: '0.1.0' },
}

export default Sliders

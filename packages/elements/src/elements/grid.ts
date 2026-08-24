import type { ElementDeclaration } from '../schema'

/**
 * `xeno.grid` — Grid. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Grid: ElementDeclaration = {
  id: 'xeno.grid',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4, y: 4, w: 6, h: 6, rx: 1 },
      { kind: 'rect', x: 14, y: 4, w: 6, h: 6, rx: 1 },
      { kind: 'rect', x: 4, y: 14, w: 6, h: 6, rx: 1 },
      { kind: 'rect', x: 14, y: 14, w: 6, h: 6, rx: 1 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Grid' },
  meta: { tags: ['tiles', 'apps'], since: '0.1.0' },
}

export default Grid

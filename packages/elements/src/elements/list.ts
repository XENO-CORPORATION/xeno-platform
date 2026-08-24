import type { ElementDeclaration } from '../schema'

/**
 * `xeno.list` — List. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const List: ElementDeclaration = {
  id: 'xeno.list',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 9, y: 6.1, w: 11, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 9, y: 11.1, w: 11, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 9, y: 16.1, w: 11, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 3.4, y: 5.3, w: 3.4, h: 3.4, rx: 0.5, fill: 'foreground' },
      { kind: 'rect', x: 3.4, y: 10.3, w: 3.4, h: 3.4, rx: 0.5, fill: 'foreground' },
      { kind: 'rect', x: 3.4, y: 15.3, w: 3.4, h: 3.4, rx: 0.5, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'List' },
  meta: { tags: ['rows', 'bullets'], since: '0.1.0' },
}

export default List

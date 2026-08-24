import type { ElementDeclaration } from '../schema'

/**
 * `xeno.menu` — Menu. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Menu: ElementDeclaration = {
  id: 'xeno.menu',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 5.6, w: 18, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 3, y: 11.1, w: 18, h: 1.8, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 3, y: 16.6, w: 18, h: 1.8, rx: 0.4, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Menu' },
  meta: { tags: ['hamburger', 'lines', 'nav'], since: '0.1.0' },
}

export default Menu

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.home` — Home. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Home: ElementDeclaration = {
  id: 'xeno.home',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 11l8-7 8 7' },
      { kind: 'path', d: 'M6 9.6V20h12V9.6' },
      // part[2] = the front door; swings open on its left hinge on hover (a welcoming "home").
      { kind: 'rect', x: 10.4, y: 13.5, w: 3.2, h: 6.5, rx: 0.3 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Home' },
  meta: { tags: ['house', 'start'], since: '0.1.0' },
}

export default Home

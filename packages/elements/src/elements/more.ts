import type { ElementDeclaration } from '../schema'

/**
 * `xeno.more` — More. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const More: ElementDeclaration = {
  id: 'xeno.more',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 2.7, y: 9.5, w: 5, h: 5, rx: 0.5 },
      { kind: 'rect', x: 10.25, y: 9.5, w: 5, h: 5, rx: 0.5 },
      { kind: 'rect', x: 17.8, y: 9.5, w: 5, h: 5, rx: 0.5 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'More' },
  meta: { tags: ['kebab', 'overflow', 'dots'], since: '0.1.0' },
}

export default More

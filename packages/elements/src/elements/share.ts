import type { ElementDeclaration } from '../schema'

/**
 * `xeno.share` — Share. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Share: ElementDeclaration = {
  id: 'xeno.share',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 14, y: 3.5, w: 6, h: 6, rx: 1 },
      { kind: 'rect', x: 14, y: 14.5, w: 6, h: 6, rx: 1 },
      { kind: 'rect', x: 3.5, y: 9, w: 6, h: 6, rx: 1 },
      { kind: 'path', d: 'M9.6 10.4l4.8-3.8M9.6 13.6l4.8 3.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Share' },
  meta: { tags: ['nodes', 'network'], since: '0.1.0' },
}

export default Share

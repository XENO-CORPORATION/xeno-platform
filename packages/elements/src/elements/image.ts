import type { ElementDeclaration } from '../schema'

/**
 * `xeno.image` — Image. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Image: ElementDeclaration = {
  id: 'xeno.image',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 4.5, w: 17, h: 15, rx: 1.5 },
      { kind: 'rect', x: 7.3, y: 7.7, w: 2.2, h: 2.2, rx: 0.5, fill: 'foreground' },
      { kind: 'path', d: 'M3.5 16.8 9.5 11.5 13 14.5 15.5 12 20.5 16.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Image' },
  meta: { tags: ['photo', 'picture', 'media'], since: '0.1.0' },
}

export default Image

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.sun` — Sun. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Sun: ElementDeclaration = {
  id: 'xeno.sun',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 8, y: 8, w: 8, h: 8, rx: 1.5 },
      { kind: 'path', d: 'M12 2v2.6M12 19.4V22M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M2 12h2.6M19.4 12H22M4.4 19.6l1.9-1.9M17.7 6.3l1.9-1.9' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Sun' },
  meta: { tags: ['light', 'brightness', 'day'], since: '0.1.0' },
}

export default Sun

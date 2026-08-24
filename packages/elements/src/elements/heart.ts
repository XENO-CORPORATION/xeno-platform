import type { ElementDeclaration } from '../schema'

/**
 * `xeno.heart` — Heart. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Heart: ElementDeclaration = {
  id: 'xeno.heart',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 20 4.5 11V8.8A1.2 1.2 0 0 1 5.7 7.6H8.3A1.2 1.2 0 0 1 9.5 8.8L12 10.8 14.5 8.8A1.2 1.2 0 0 1 15.7 7.6H18.3A1.2 1.2 0 0 1 19.5 8.8V11Z' },
      // part[1] = a solid fill of the same heart; hidden at rest, rises on hover so the heart "fills up".
      { kind: 'path', d: 'M12 20 4.5 11V8.8A1.2 1.2 0 0 1 5.7 7.6H8.3A1.2 1.2 0 0 1 9.5 8.8L12 10.8 14.5 8.8A1.2 1.2 0 0 1 15.7 7.6H18.3A1.2 1.2 0 0 1 19.5 8.8V11Z', fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Heart' },
  meta: { tags: ['like', 'favorite', 'love'], since: '0.1.0' },
}

export default Heart

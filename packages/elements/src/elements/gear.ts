import type { ElementDeclaration } from '../schema'

/**
 * `xeno.gear` — Gear. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Gear: ElementDeclaration = {
  id: 'xeno.gear',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 5, y: 5, w: 14, h: 14, rx: 2 },
      { kind: 'rect', x: 9.3, y: 9.3, w: 5.4, h: 5.4, rx: 1 },
      { kind: 'path', d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l1.9 1.9M17.1 17.1L19 19M19 5l-1.9 1.9M6.9 17.1L5 19' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Gear' },
  meta: { tags: ['settings', 'cog', 'preferences'], since: '0.1.0' },
}

export default Gear

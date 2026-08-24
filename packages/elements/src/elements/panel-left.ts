import type { ElementDeclaration } from '../schema'

/**
 * `xeno.panel-left` — a side panel on the LEFT, with the chevron that says which way it moves.
 *
 * Four glyphs in this family (`panel-left`, `panel-left-close`, `panel-right`, `panel-right-close`)
 * share one frame and one rail, and differ only in which side the rail is on and which way the chevron
 * points. They are authored as a SET on purpose: they are each other's opposites, and half a pair drawn
 * in one system with its twin borrowed from another reads as a mistake rather than a pair.
 *
 * part[0] = frame, part[1] = rail, part[2] = chevron. The chevron is the only part that moves.
 */
export const PanelLeft: ElementDeclaration = {
  id: 'xeno.panel-left',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 16, rx: 2.4 },
      { kind: 'path', d: 'M9 4v16' },
      // Pointing INTO the open area: this is the one that opens the panel.
      { kind: 'path', d: 'M13.4 9.6 15.8 12l-2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Open left panel' },
  meta: { tags: ['panel', 'sidebar', 'layout', 'open'], since: '0.2.0' },
}

export default PanelLeft

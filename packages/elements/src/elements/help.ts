import type { ElementDeclaration } from '../schema'

/**
 * `xeno.help` — Help. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Help: ElementDeclaration = {
  id: 'xeno.help',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 3.5, w: 17, h: 17, rx: 2 },
      { kind: 'path', d: 'M9.7 9.8V7.9A0.7 0.7 0 0 1 10.4 7.2H13.6A0.7 0.7 0 0 1 14.3 7.9V9.7A1.2 1.2 0 0 1 12.9 11L12 12V13.9' },
      { kind: 'rect', x: 11.2, y: 15.7, w: 1.6, h: 1.6, rx: 0.3, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Help' },
  meta: { tags: ['question', 'support'], since: '0.1.0' },
}

export default Help

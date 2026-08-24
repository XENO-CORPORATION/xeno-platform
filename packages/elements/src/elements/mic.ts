import type { ElementDeclaration } from '../schema'

/**
 * `xeno.mic` — Mic. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Mic: ElementDeclaration = {
  id: 'xeno.mic',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 9, y: 2.5, w: 6, h: 10.5, rx: 2 },
      { kind: 'path', d: 'M5.5 10.5V13A2.5 2.5 0 0 0 8 15.5H16A2.5 2.5 0 0 0 18.5 13V10.5' },
      { kind: 'path', d: 'M12 15.5V21M9 21h6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Mic' },
  meta: { tags: ['microphone', 'record', 'voice'], since: '0.1.0' },
}

export default Mic

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.bell` — Bell. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Bell: ElementDeclaration = {
  id: 'xeno.bell',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M5 16 6 10A2 2 0 0 1 8 8H16A2 2 0 0 1 18 10L19 16Z' },
      { kind: 'path', d: 'M10 18.5V19.2A0.8 0.8 0 0 0 10.8 20H13.2A0.8 0.8 0 0 0 14 19.2V18.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Bell' },
  meta: { tags: ['notification', 'alert'], since: '0.1.0' },
}

export default Bell

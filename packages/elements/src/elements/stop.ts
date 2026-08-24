import type { ElementDeclaration } from '../schema'

/**
 * `xeno.stop` — Stop. A degenerate element (pure geometry, no children).
 *
 * A rounded square, centred on the same axis and the same height as `play` and `pause`.
 *
 * Not a circle with a square inside it, which is the conventional drawing: the grammar has no circles,
 * and the ring adds nothing the square does not already say. The radius is the family's small corner —
 * enough to belong to the system, far from the half-dimension where a square becomes a capsule.
 */
export const Stop: ElementDeclaration = {
  id: 'xeno.stop',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [{ kind: 'rect', x: 5.6, y: 5.6, w: 12.8, h: 12.8, rx: 2.4 }],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Stop' },
  meta: { tags: ['media', 'halt', 'end'], since: '0.2.0' },
}

export default Stop

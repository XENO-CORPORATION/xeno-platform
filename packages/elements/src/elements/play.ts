import type { ElementDeclaration } from '../schema'

/**
 * `xeno.play` — Play. A degenerate element (pure geometry, no children).
 *
 * A triangle pointing right. The one shape in the set that has a DIRECTION, which is the whole
 * distinction it carries: pause and stop are both symmetrical, and play is the only one that says
 * where things are going.
 *
 * Drawn as an outline rather than a solid wedge, because everything else in the grammar is an outline
 * and a filled triangle at 24px reads two weights heavier than the icons beside it.
 */
export const Play: ElementDeclaration = {
  id: 'xeno.play',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [{ kind: 'path', d: 'M8.4 5.6 18.6 12 8.4 18.4Z' }],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Play' },
  meta: { tags: ['media', 'start', 'run'], since: '0.2.0' },
}

export default Play

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.brain-circuit` — Reasoning. A degenerate element (pure geometry, no children).
 *
 * `brain`, with the right hemisphere replaced by the circuit rather than decorated with it.
 *
 * The first attempt kept the full outline and put traces and nodes INSIDE the right lobe, which is the
 * obvious reading of "brain plus circuit" and does not survive contact with the sheet: from the sulcus
 * at 12 to the outline at 18.5 there are six units, and a trace, a node and two stroke widths do not fit
 * in six units. Rendered, it was a lobe with two lumps pressed against the inside of it.
 *
 * Cutting the hemisphere away gives the circuit the full half — eight units by fourteen — and it costs
 * nothing, because the sulcus was already drawing that edge. The silhouette stays a brain on the left,
 * and on the right the thing that would have been tissue is wiring instead. That is a better sentence
 * than the crowded one anyway: this is not a brain that has a circuit in it, it is half mind and half
 * machine.
 *
 * The nodes are rounded SQUARES, not dots — the grammar has no circles, and what sits at the end of a
 * trace is a component, so the square is also the truer picture.
 *
 * part[0] = left hemisphere, part[1] = sulcus, part[2..3] = traces, part[4..5] = nodes.
 */
export const BrainCircuit: ElementDeclaration = {
  id: 'xeno.brain-circuit',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      {
        kind: 'path',
        d: 'M12 5.4C10 3.2 6.6 4 6.4 7.2 3.8 8.2 3.6 11.6 5.8 12.8 4.8 15.6 6.8 18 9.6 17.8 10 18.9 11.2 19.3 12 18.9',
      },
      { kind: 'path', d: 'M12 5.4L12 18.9' },
      { kind: 'path', d: 'M12 9.3L15.6 9.3' },
      { kind: 'path', d: 'M12 15.3L15.6 15.3' },
      { kind: 'rect', x: 15.6, y: 7.9, w: 2.8, h: 2.8, rx: 0.9 },
      { kind: 'rect', x: 15.6, y: 13.9, w: 2.8, h: 2.8, rx: 0.9 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Reasoning' },
  meta: { tags: ['brain', 'circuit', 'reasoning', 'memory', 'ai'], since: '0.2.0' },
}

export default BrainCircuit

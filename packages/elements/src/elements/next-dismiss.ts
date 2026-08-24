import type { ElementDeclaration } from '../schema'

/**
 * `xeno.next-dismiss` — the arrow that becomes a cross. A degenerate element (pure geometry, no
 * children), and the first in the set with a MORPHING variant.
 *
 * One control, two jobs: advance through a stack of cards, and — on the last one — dismiss it. Two
 * meanings usually mean two glyphs, and two glyphs swapped in place is a flicker with no explanation.
 * Here the swap is the explanation: the shaft rotates into one arm of the cross, the upper barb into the
 * other, and the lower barb collapses into the middle and is gone. You can see the arrow become the way
 * out.
 *
 * It works because the two variants are STRUCTURALLY identical — three paths, two points each, in the
 * same order, and written with the SAME COMMANDS — which is what `geometryMorphable` tests for. The
 * shaft is `M4 12L19 12` rather than the shorter `M4 12H19` for exactly that reason: a horizontal-line
 * command cannot interpolate into a general line, and a browser asked to try snaps instead. Two strokes
 * animated and the third teleported until this was written the long way. The interpreter checks it, marks the
 * scene, and the stylesheet interpolates `d`. Nothing here is animated by hand; the pairing is what
 * carries the motion, so the only real work was drawing both states out of the same three strokes.
 *
 * The lower barb's `selection:on` form is a zero-length segment. The contract draws with
 * `stroke-linecap: butt`, so a segment with no length paints nothing — the part disappears without an
 * opacity of its own, and comes back the same way. A round cap would have left a dot behind.
 *
 * `selection` is the axis, and it is the honest fit rather than a perfect one: what it encodes is "this
 * is the last card", which is a fact about the deck rather than about this control. The grammar offers
 * availability, selection and interaction; of the three, selection is the one that means "this is the
 * state it is in" rather than "this is what you may do with it".
 */
export const NextDismiss: ElementDeclaration = {
  id: 'xeno.next-dismiss',
  kind: 'icon',
  contract: {
    viewBox: '0 0 24 24',
    weight: 'regular',
    strokeFamily: 'xeno-regular',
    axes: ['selection'],
    signals: [],
  },
  geometry: {
    // Next: `arrow-right`'s shaft and head, at its coordinates.
    base: [
      { kind: 'path', d: 'M4 12L19 12' },
      { kind: 'path', d: 'M13 6L19 12' },
      { kind: 'path', d: 'M13 18L19 12' },
    ],
    // Dismiss: `x`'s two strokes, and the third barb folded away into the centre.
    'selection:on': [
      { kind: 'path', d: 'M6.5 6.5L17.5 17.5' },
      { kind: 'path', d: 'M17.5 6.5L6.5 17.5' },
      { kind: 'path', d: 'M12 12L12 12' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Next' },
  meta: { tags: ['next', 'dismiss', 'close', 'advance'], since: '0.2.0' },
}

export default NextDismiss

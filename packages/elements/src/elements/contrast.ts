import type { ElementDeclaration } from '../schema'

/**
 * `xeno.contrast` — Theme. A degenerate element (pure geometry, no children).
 *
 * A rounded square, half of it solid. The conventional icon here is a circle split down the middle,
 * and it is the one shape the grammar does not have — so this is the same IDEA in the system's own
 * geometry: the frame is the shared `radius` family, and the fill is that frame's own left half,
 * corners and all, rather than a rectangle clipped against it.
 *
 * The fill is drawn SECOND so it sits over the frame's stroke on the shared edge; the two agree on
 * every coordinate, so the seam is a straight line down the middle and not a hairline of background.
 *
 * part[0] = frame, part[1] = the solid half, part[2] = a second copy of the frame.
 *
 * That third part looks redundant and is not. The glyph's motion fills the whole square and then drains
 * it, and a `clip-path` takes an element's STROKE with it — so whatever gets clipped cannot also be
 * carrying the border. part[2] is the layer that fills and drains; part[0] underneath is the border
 * that survives it. It declares no fill of its own, so with no stylesheet it draws as a stroke exactly
 * over part[0]'s and the icon looks the same as it always did.
 */
export const Contrast: ElementDeclaration = {
  id: 'xeno.contrast',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 3, w: 18, h: 18, rx: 5 },
      {
        // The left half of the same rounded square: down the centre line, round the two left corners,
        // back up. Same 5px radius as the frame, so the silhouettes coincide exactly.
        d: 'M12 3H8A5 5 0 0 0 3 8V16A5 5 0 0 0 8 21H12Z',
        kind: 'path',
        fill: 'foreground',
      },
      { kind: 'rect', x: 3, y: 3, w: 18, h: 18, rx: 5 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Theme' },
  meta: { tags: ['theme', 'dark', 'light', 'appearance'], since: '0.2.0' },
}

export default Contrast

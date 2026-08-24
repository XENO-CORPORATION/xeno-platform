import type { ElementDeclaration } from '../schema'

/**
 * `xeno.globe` — Globe. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Globe: ElementDeclaration = {
  id: 'xeno.globe',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      // rx 7 of a possible 9 — noticeably round so it reads as a world, without becoming a plain circle
      // (the XENO grammar is rounded squares, never circles).
      { kind: 'rect', x: 3, y: 3, w: 18, h: 18, rx: 7 },
      // The equator and the parallels: fixed — they do not move when a globe turns about its poles.
      { kind: 'path', d: 'M3 12H21' },
      { kind: 'path', d: 'M3.2 8.5C6.6 7.45 17.4 7.45 20.8 8.5M3.2 15.5C6.6 16.55 17.4 16.55 20.8 15.5' },
      // parts[3..6] — four meridians, each ONE half of a great circle: the half you would actually see on a
      // solid globe. Orthographic projection of a half-meridian at longitude L is the SAME half-ellipse
      // scaled horizontally by sin(L), so a CSS scaleX is the exact reprojection — and the half sweeps
      // LEFT LIMB → straight through the poles → RIGHT LIMB, i.e. it really TRAVELS across the face.
      // (Drawing both halves instead only lets a meridian narrow symmetrically, which reads as closing.)
      //
      // They rest at L = 45°, 135°, 225°, 315° — 90° apart, so the sphere is evenly ribbed, and sin(45)=sin(135)
      // and sin(225)=sin(315), so they coincide in two pairs: with NO stylesheet the icon draws as the frame
      // plus one clean ellipse. None of them rests at ±90°, so none doubles up on the frame's own edge; and
      // each reaches exactly x = 3 / x = 21 at the limb, where it merges into the outline and hands over.
      // The endpoints are the poles and each curve is a kappa (0.5523) two-cubic ellipse half.
      { kind: 'path', d: 'M12 3C15.51 3 18.36 7.03 18.36 12C18.36 16.97 15.51 21 12 21' },
      { kind: 'path', d: 'M12 3C15.51 3 18.36 7.03 18.36 12C18.36 16.97 15.51 21 12 21' },
      { kind: 'path', d: 'M12 3C8.49 3 5.64 7.03 5.64 12C5.64 16.97 8.49 21 12 21' },
      { kind: 'path', d: 'M12 3C8.49 3 5.64 7.03 5.64 12C5.64 16.97 8.49 21 12 21' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Globe' },
  meta: { tags: ['world', 'language', 'web'], since: '0.1.0' },
}

export default Globe

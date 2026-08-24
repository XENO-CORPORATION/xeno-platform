import type { ElementDeclaration } from '../schema'

/**
 * `xeno.briefcase` — Briefcase. A degenerate element (pure geometry, no children).
 *
 * A case with a handle, split along the line it opens on: part[0] = handle, part[1] = lid, part[2] =
 * base. Geometry split where the motion needs it, as with the trash lid and the folder mouth.
 *
 * There is no separate clasp stroke, and that is the point of splitting it this way — the lid's bottom
 * edge and the base's top edge lie on the same y, so the seam between them IS the clasp. One line, and
 * it is a real edge rather than a decoration drawn across a solid box, so when the case opens the line
 * becomes the gap instead of floating over it.
 */
export const Briefcase: ElementDeclaration = {
  id: 'xeno.briefcase',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9 7.5V6A1.5 1.5 0 0 1 10.5 4.5h3A1.5 1.5 0 0 1 15 6V7.5' },
      { kind: 'path', d: 'M3 13V9.3A1.8 1.8 0 0 1 4.8 7.5H19.2A1.8 1.8 0 0 1 21 9.3V13Z' },
      { kind: 'path', d: 'M3 13V17.7A1.8 1.8 0 0 0 4.8 19.5H19.2A1.8 1.8 0 0 0 21 17.7V13Z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Briefcase' },
  meta: { tags: ['work', 'case', 'customize'], since: '0.2.0' },
}

export default Briefcase

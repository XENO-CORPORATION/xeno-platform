import type { ElementDeclaration } from '../schema'

/**
 * `xeno.mic-off` — Muted. A degenerate element (pure geometry, no children).
 *
 * `mic` with the shared negation stroke. Same three parts, same coordinates — see `eye-off.ts` for why
 * the object underneath is copied rather than redrawn.
 *
 * part[0] = capsule, part[1] = cradle, part[2] = stem + base, part[3] = the slash.
 */
export const MicOff: ElementDeclaration = {
  id: 'xeno.mic-off',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 9, y: 2.5, w: 6, h: 10.5, rx: 2 },
      { kind: 'path', d: 'M5.5 10.5V13A2.5 2.5 0 0 0 8 15.5H16A2.5 2.5 0 0 0 18.5 13V10.5' },
      { kind: 'path', d: 'M12 15.5V21M9 21h6' },
      { kind: 'path', d: 'M4.2 4.2 19.8 19.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Microphone off' },
  meta: { tags: ['mute', 'silence', 'voice'], since: '0.2.0' },
}

export default MicOff

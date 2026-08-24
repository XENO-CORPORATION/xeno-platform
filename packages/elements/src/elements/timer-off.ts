import type { ElementDeclaration } from '../schema'

/**
 * `xeno.timer-off` — Timer off. A degenerate element (pure geometry, no children).
 *
 * `clock` with the shared negation stroke. The clock, not a separate timer drawing: this system already
 * says "time" with one shape, and a second one that meant almost the same thing would be a fork in the
 * vocabulary rather than an addition to it.
 *
 * part[0] = face, part[1] = hands, part[2] = the slash.
 */
export const TimerOff: ElementDeclaration = {
  id: 'xeno.timer-off',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 3.5, w: 17, h: 17, rx: 2 },
      // `clock`'s hands MIRRORED — the minute hand swings to the lower LEFT instead of the lower right.
      // Any corner-to-corner slash passes through the middle of the box, which is exactly where a clock's
      // hands meet, so the hands cannot avoid it; what they can avoid is running ALONGSIDE it. At the
      // original angle the minute hand sat within ~13 degrees of the slash and the two fused into one
      // thick zigzag with no clock left in it. Mirrored, each hand crosses the line instead of tracking
      // it, and the face reads as a clock that has been struck out.
      { kind: 'path', d: 'M12 7.5V12l-3.2 2' },
      { kind: 'path', d: 'M4.2 4.2 19.8 19.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Timer off' },
  meta: { tags: ['time', 'expire', 'temporary'], since: '0.2.0' },
}

export default TimerOff

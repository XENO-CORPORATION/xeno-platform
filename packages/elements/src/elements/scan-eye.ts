import type { ElementDeclaration } from '../schema'

/**
 * `xeno.scan-eye` - Inspect. A degenerate element (pure geometry, no children).
 *
 * `maximize`'s four corner brackets with `eye`'s lens between them, both at their own coordinates. It is
 * the clearest case in the set for composing rather than drawing: the brackets already mean "a frame
 * being placed over something" and the lens already means "looking", so the compound says what it says
 * without a single new shape being invented for it.
 *
 * The lens is scaled to fit inside the brackets - it has to be smaller than the frame it sits in, which
 * is the only thing about it that is new.
 *
 * part[0..3] = the corners, part[4] = the lens, part[5] = the pupil.
 */
export const ScanEye: ElementDeclaration = {
  id: 'xeno.scan-eye',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9.5 4.5H6A1.5 1.5 0 0 0 4.5 6v3.5' },
      { kind: 'path', d: 'M14.5 4.5H18A1.5 1.5 0 0 1 19.5 6v3.5' },
      { kind: 'path', d: 'M19.5 14.5V18A1.5 1.5 0 0 1 18 19.5h-3.5' },
      { kind: 'path', d: 'M4.5 14.5V18A1.5 1.5 0 0 0 6 19.5h3.5' },
      { kind: 'path', d: 'M5.8 12 8.4 9.4h7.2L18.2 12 15.6 14.6H8.4Z' },
      { kind: 'rect', x: 10.2, y: 10.2, w: 3.6, h: 3.6, rx: 0.8, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Inspect' },
  meta: { tags: ['scan', 'inspect', 'detect', 'watch'], since: '0.2.0' },
}

export default ScanEye

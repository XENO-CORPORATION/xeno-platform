import type { ElementDeclaration } from '../schema'

/**
 * `xeno.app-window` - Window. A degenerate element (pure geometry, no children).
 *
 * `monitor`'s screen with a title bar ruled across it and two marks in the bar. Two, not three: at 24px
 * a third drops the gaps between them below the stroke weight and the row turns into a dashed line. Two
 * still reads as window furniture, which is all the bar has to say.
 *
 * part[0] = frame, part[1] = title bar, part[2..3] = the marks.
 */
export const AppWindow: ElementDeclaration = {
  id: 'xeno.app-window',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4.5, w: 18, h: 15, rx: 2 },
      { kind: 'path', d: 'M3 9.2h18' },
      { kind: 'rect', x: 6, y: 6.1, w: 1.6, h: 1.6, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 9.2, y: 6.1, w: 1.6, h: 1.6, rx: 0.4, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Window' },
  meta: { tags: ['window', 'app', 'panel'], since: '0.2.0' },
}

export default AppWindow

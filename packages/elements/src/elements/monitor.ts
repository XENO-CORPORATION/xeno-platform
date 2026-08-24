import type { ElementDeclaration } from '../schema'

/**
 * `xeno.monitor` - Desktop. A degenerate element (pure geometry, no children).
 *
 * A screen on a stand. It shares its screen with `app-window` deliberately: the two mean "a desktop" and
 * "a window on one", and the second reading only works if the first shape is recognisably the same. The
 * stand is what separates them, which is exactly the distinction being made.
 *
 * part[0] = screen, part[1] = neck, part[2] = foot.
 */
export const Monitor: ElementDeclaration = {
  id: 'xeno.monitor',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 12.4, rx: 2 },
      { kind: 'path', d: 'M12 16.4v3' },
      { kind: 'path', d: 'M8 19.4h8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Desktop' },
  meta: { tags: ['screen', 'desktop', 'display'], since: '0.2.0' },
}

export default Monitor

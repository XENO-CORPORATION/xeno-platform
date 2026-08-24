import type { ElementDeclaration } from '../schema'

/**
 * `xeno.calendar` — Calendar. A degenerate element (pure geometry, no children).
 *
 * A page with two binder posts and a rule under the header. The rule is what makes it a calendar rather
 * than a window: it separates the month from the days, and without it the same rectangle is `panel`.
 *
 * part[0] = page, part[1] = left post, part[2] = right post, part[3] = the header rule.
 */
export const Calendar: ElementDeclaration = {
  id: 'xeno.calendar',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 5.5, w: 17, h: 15, rx: 2.2 },
      { kind: 'path', d: 'M8.5 3.2v4.4' },
      { kind: 'path', d: 'M15.5 3.2v4.4' },
      { kind: 'path', d: 'M3.5 10.4h17' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Calendar' },
  meta: { tags: ['date', 'schedule', 'month'], since: '0.2.0' },
}

export default Calendar

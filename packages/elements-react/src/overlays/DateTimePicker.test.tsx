import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { DatePicker, TimePicker } from './DateTimePicker.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('DatePicker', () => {
  const AUG = { year: 2026, month: 7 } as const // August 2026 (0-based month)

  it('renders the month card, group role, and the Month Year title', () => {
    const out = html(<DatePicker month={AUG} />)
    expect(out).toContain('class="xeno-datepicker"')
    expect(out).toContain('role="group"')
    expect(out).toContain('August 2026')
  })

  it('renders prev/next month controls as labelled icon buttons', () => {
    const out = html(<DatePicker month={AUG} />)
    expect(out).toContain('aria-label="Previous month"')
    expect(out).toContain('aria-label="Next month"')
    expect(out).toContain('xeno-datepicker-prev')
    expect(out).toContain('xeno-datepicker-next')
  })

  it('marks the selected day with the soft selection state', () => {
    const out = html(<DatePicker month={AUG} selected={{ year: 2026, month: 7, day: 15 }} />)
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('>15<')
  })

  it('marks today with aria-current only (no separate dot marker)', () => {
    const out = html(<DatePicker month={AUG} today={{ year: 2026, month: 7, day: 20 }} />)
    expect(out).toContain('aria-current="date"')
    expect(out).not.toContain('xeno-datepicker-dot')
  })

  it('fills a fixed 6-week grid, greying adjacent-month days', () => {
    const out = html(<DatePicker month={AUG} />)
    expect(out).toContain('data-outside=""')
    expect((out.match(/data-idx=/g) ?? []).length).toBe(42)
  })

  it('does not mark selection/today for a date outside the visible month', () => {
    const out = html(<DatePicker month={AUG} selected={{ year: 2026, month: 6, day: 15 }} />)
    expect(out).not.toContain('data-selection="on"')
    expect(out).not.toContain('aria-selected="true"')
  })

  it('renders the Today button disabled when no today is supplied', () => {
    const out = html(<DatePicker month={AUG} />)
    expect(out).toContain('xeno-datepicker-today')
    // The ghost Button maps disabled -> data-availability="disabled".
    expect(out).toContain('data-availability="disabled"')
  })

  it('shows the Clear button only when onClear is provided', () => {
    expect(html(<DatePicker month={AUG} />)).not.toContain('xeno-datepicker-clear')
    expect(html(<DatePicker month={AUG} onClear={() => {}} />)).toContain('xeno-datepicker-clear')
  })

  it('defaults to a Monday-first weekday header, and honours weekStartsOn=0', () => {
    const mon = html(<DatePicker month={AUG} />)
    expect(mon.indexOf('>Mo<')).toBeGreaterThanOrEqual(0)
    expect(mon.indexOf('>Su<')).toBeGreaterThan(mon.indexOf('>Mo<'))

    const sun = html(<DatePicker month={AUG} weekStartsOn={0} />)
    expect(sun.indexOf('>Su<')).toBeGreaterThanOrEqual(0)
    expect(sun.indexOf('>Su<')).toBeLessThan(sun.indexOf('>Mo<'))
  })

  it('computes a leap February (Feb 29 is selectable in 2024, absent in 2023)', () => {
    expect(
      html(<DatePicker month={{ year: 2024, month: 1 }} selected={{ year: 2024, month: 1, day: 29 }} />),
    ).toContain('data-selection="on"')
    expect(
      html(<DatePicker month={{ year: 2023, month: 1 }} selected={{ year: 2023, month: 1, day: 29 }} />),
    ).not.toContain('data-selection="on"')
  })

  it('merges a className and forwards rest attributes', () => {
    const out = html(<DatePicker month={AUG} className="mine" data-testid="dp" />)
    expect(out).toContain('xeno-datepicker mine')
    expect(out).toContain('data-testid="dp"')
  })
})

describe('TimePicker', () => {
  const VALUE = { hour: 12, minute: 30, meridiem: 'PM' } as const

  it('renders three labelled columns', () => {
    const out = html(<TimePicker value={VALUE} />)
    expect(out).toContain('class="xeno-timepicker"')
    expect(out).toContain('aria-label="Hour"')
    expect(out).toContain('aria-label="Min"')
    expect(out).toContain('aria-label="AM/PM"')
    expect(out).toContain('role="listbox"')
  })

  it('highlights the selected option in each column', () => {
    const out = html(<TimePicker value={VALUE} />)
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('aria-selected="true"')
    // The selected minute (30) and meridiem (PM) render.
    expect(out).toContain('>30<')
    expect(out).toContain('>PM<')
  })

  it('steps minutes by 5 by default (00, 05 present; 01 absent)', () => {
    const out = html(<TimePicker value={VALUE} />)
    expect(out).toContain('>00<')
    expect(out).toContain('>05<')
    expect(out).not.toContain('>01<')
  })

  it('honours a custom minuteStep', () => {
    const out = html(<TimePicker value={VALUE} minuteStep={15} />)
    expect(out).toContain('>15<')
    expect(out).toContain('>45<')
    expect(out).not.toContain('>05<')
  })

  it('renders all twelve hours and both meridiems', () => {
    const out = html(<TimePicker value={VALUE} />)
    expect(out).toContain('>1<')
    expect(out).toContain('>12<')
    expect(out).toContain('>AM<')
    expect(out).toContain('>PM<')
  })

  it('merges a className and forwards rest attributes', () => {
    const out = html(<TimePicker value={VALUE} className="mine" data-testid="tp" />)
    expect(out).toContain('xeno-timepicker mine')
    expect(out).toContain('data-testid="tp"')
  })
})

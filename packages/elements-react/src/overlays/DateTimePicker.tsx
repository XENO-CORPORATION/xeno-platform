import type { HTMLAttributes, KeyboardEvent, ReactElement } from 'react'
import { useEffect, useId, useRef } from 'react'
import { IconButton } from '../controls/IconButton.js'
import { Button } from '../controls/Button.js'
import { cx } from '../controls/util.js'
import ChevronRight from '@xenosystem/elements/elements/chevron-right'

/**
 * DateTimePicker — a faithful port of the XENO chat's project "Scheduled" date/time popover
 * (ChatWithLLM.tsx): monochrome, `rounded-md` (6px) throughout, a soft `--xeno-control` fill for the
 * selection (never bright inverted ink), a fixed 6-week calendar (greyed overflow days keep the height
 * stable), and a three-column time picker whose Hour/Min are quiet scroll lists and AM/PM two flat
 * buttons. Both pieces render PURE from props so SSR is byte-deterministic (no `new Date()`).
 *
 * Exports {@link DatePicker} + {@link TimePicker}.
 */

/** A calendar date. `month` is 0-based (0 = January) to match `Date`'s month index. */
export interface DateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** A visible month. `month` is 0-based (0 = January). */
export interface MonthParts {
  readonly year: number
  readonly month: number
}

// ── Pure calendar math (no `Date`, so identical on server + client, any timezone) ─────────────────

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const SAKAMOTO = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

const daysInMonth = (year: number, month0: number): number =>
  month0 === 1 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month0] ?? 30)

/** Day of week for a date, 0 = Sunday … 6 = Saturday. Sakamoto's algorithm — `month0` is 0-based. */
const dayOfWeek = (year: number, month0: number, day: number): number => {
  const y = month0 < 2 ? year - 1 : year
  const t = SAKAMOTO[month0] ?? 0
  return (((y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t + day) % 7) + 7) % 7
}

/** Shift a month by ±n, carrying the year. */
const shiftMonth = (m: MonthParts, delta: number): MonthParts => {
  const total = m.year * 12 + m.month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

const DEFAULT_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** Short weekday names indexed by JS day: 0 = Sunday … 6 = Saturday. */
const DEFAULT_WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/** A single cell in the fixed 6-week grid — a real day (possibly in the adjacent month). */
interface DayCell extends DateParts {
  readonly inMonth: boolean
}

const sameDay = (a: DateParts | undefined, c: DayCell): boolean =>
  a !== undefined && a.year === c.year && a.month === c.month && a.day === c.day

// ── DatePicker ────────────────────────────────────────────────────────────────────────────────

export interface DatePickerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect' | 'children'> {
  /** The month currently on screen (0-based month). */
  readonly month: MonthParts
  /** The selected date — its cell gets the soft `--xeno-control` fill. */
  readonly selected?: DateParts
  /** "Today" — gets `aria-current` and drives the Today button. */
  readonly today?: DateParts
  /** The visible month should change (prev/next chevrons, PageUp/PageDown, Today). */
  readonly onMonthChange?: (month: MonthParts) => void
  /** A day cell was activated (may be a day from the adjacent month). */
  readonly onSelect?: (date: DateParts) => void
  /** The Clear button was pressed. When omitted the Clear button is hidden. */
  readonly onClear?: () => void
  /** First column of the week: 0 = Sunday, 1 = Monday (default). */
  readonly weekStartsOn?: 0 | 1
  /** Override the 12 month names (index 0 = January). */
  readonly monthNames?: readonly string[]
  /** Override the 7 short weekday names (index 0 = Sunday). */
  readonly weekdayNames?: readonly string[]
}

/**
 * `<DatePicker>` — a single-month calendar. A header (prev/next chevron {@link IconButton}s around a
 * `Month Year` label), a weekday header (Mo…Su by default), a FIXED 6-week grid of square day cells
 * (adjacent-month days shown greyed so the height never jumps), and a footer of Clear / Today ghost
 * buttons. Controlled. Keyboard: arrows rove day-to-day (↑/↓ = week, ←/→ = day), Home/End jump to the
 * ends of the grid, PageUp/PageDown change month, Enter/Space select (native).
 */
export function DatePicker({
  month,
  selected,
  today,
  onMonthChange,
  onSelect,
  onClear,
  weekStartsOn = 1,
  monthNames = DEFAULT_MONTH_NAMES,
  weekdayNames = DEFAULT_WEEKDAY_NAMES,
  className,
  ...rest
}: DatePickerProps): ReactElement {
  const gridRef = useRef<HTMLDivElement>(null)
  const labelId = useId()

  const { year, month: m0 } = month
  const monthName = monthNames[m0] ?? ''
  const total = daysInMonth(year, m0)
  const firstDow = dayOfWeek(year, m0, 1)
  const lead = (firstDow - weekStartsOn + 7) % 7

  // A FIXED 6-week (42-cell) grid, filled with real days from the previous and next months so the
  // calendar height is constant and every cell is a real, clickable date.
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const prevTotal = daysInMonth(prev.year, prev.month)
  const cells: DayCell[] = []
  for (let i = 0; i < lead; i += 1) {
    cells.push({ year: prev.year, month: prev.month, day: prevTotal - lead + 1 + i, inMonth: false })
  }
  for (let d = 1; d <= total; d += 1) cells.push({ year, month: m0, day: d, inMonth: true })
  for (let d = 1; cells.length < 42; d += 1) {
    cells.push({ year: next.year, month: next.month, day: d, inMonth: false })
  }
  const weeks: DayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // The single roving-tabbable cell: the selection (if this month), else today (if this month), else
  // the 1st — always an in-month day.
  const focusIdx = (() => {
    const bySel = cells.findIndex((c) => c.inMonth && sameDay(selected, c))
    if (bySel >= 0) return bySel
    const byToday = cells.findIndex((c) => c.inMonth && sameDay(today, c))
    if (byToday >= 0) return byToday
    return cells.findIndex((c) => c.inMonth)
  })()

  const weekdayHeader = Array.from({ length: 7 }, (_, i) => {
    const idx = (weekStartsOn + i) % 7
    return weekdayNames[idx] ?? ''
  })

  const goToMonth = (delta: number): void => onMonthChange?.(shiftMonth(month, delta))

  const goToday = (): void => {
    if (!today) return
    onMonthChange?.({ year: today.year, month: today.month })
    onSelect?.(today)
  }

  // Arrow-key roving across the 42 day buttons by their grid index.
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const nav = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
    if (!nav.includes(e.key)) return
    e.preventDefault()
    if (e.key === 'PageUp') return goToMonth(-1)
    if (e.key === 'PageDown') return goToMonth(1)
    const grid = gridRef.current
    if (!grid) return
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-idx]'))
    if (buttons.length === 0) return
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null
    const cur = activeEl instanceof HTMLButtonElement ? buttons.indexOf(activeEl) : -1
    const base = cur < 0 ? Math.max(0, focusIdx) : cur
    let nextIdx = base
    if (e.key === 'ArrowLeft') nextIdx = base - 1
    else if (e.key === 'ArrowRight') nextIdx = base + 1
    else if (e.key === 'ArrowUp') nextIdx = base - 7
    else if (e.key === 'ArrowDown') nextIdx = base + 7
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = buttons.length - 1
    nextIdx = Math.max(0, Math.min(buttons.length - 1, nextIdx))
    buttons[nextIdx]?.focus()
  }

  let idx = -1
  return (
    <div className={cx('xeno-datepicker', className)} role="group" aria-labelledby={labelId} {...rest}>
      <div className="xeno-datepicker-header">
        <IconButton
          className="xeno-datepicker-nav xeno-datepicker-prev"
          icon={ChevronRight}
          aria-label="Previous month"
          size="xs"
          onClick={() => goToMonth(-1)}
        />
        <div className="xeno-datepicker-title" id={labelId} aria-live="polite">
          {monthName} {year}
        </div>
        <IconButton
          className="xeno-datepicker-nav xeno-datepicker-next"
          icon={ChevronRight}
          aria-label="Next month"
          size="xs"
          onClick={() => goToMonth(1)}
        />
      </div>

      <div className="xeno-datepicker-weekdays" aria-hidden="true">
        {weekdayHeader.map((wd, i) => (
          <div className="xeno-datepicker-weekday" key={`${wd}-${i}`}>
            {wd}
          </div>
        ))}
      </div>

      <div className="xeno-datepicker-grid" role="grid" ref={gridRef} onKeyDown={onGridKeyDown}>
        {weeks.map((week, wi) => (
          <div className="xeno-datepicker-week" role="row" key={wi}>
            {week.map((cell, di) => {
              idx += 1
              const isSel = sameDay(selected, cell)
              const isToday = sameDay(today, cell)
              const cellIdx = idx
              return (
                <button
                  type="button"
                  className="xeno-datepicker-cell xeno-datepicker-day"
                  role="gridcell"
                  key={di}
                  data-idx={String(cellIdx)}
                  data-outside={cell.inMonth ? undefined : ''}
                  data-selection={isSel ? 'on' : 'off'}
                  data-availability="enabled"
                  aria-selected={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  tabIndex={cellIdx === focusIdx ? 0 : -1}
                  onClick={() => onSelect?.({ year: cell.year, month: cell.month, day: cell.day })}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="xeno-datepicker-footer">
        {onClear !== undefined && (
          <Button className="xeno-datepicker-clear" variant="ghost" size="xs" onClick={() => onClear()}>
            Clear
          </Button>
        )}
        <Button
          className="xeno-datepicker-today"
          variant="ghost"
          size="xs"
          disabled={today === undefined}
          onClick={goToday}
        >
          Today
        </Button>
      </div>
    </div>
  )
}

// ── TimePicker ────────────────────────────────────────────────────────────────────────────────

export type Meridiem = 'AM' | 'PM'

/** A 12-hour clock time. `hour` is 1–12, `minute` is 0–59. */
export interface TimeValue {
  readonly hour: number
  readonly minute: number
  readonly meridiem: Meridiem
}

export interface TimePickerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  /** The selected time. */
  readonly value: TimeValue
  readonly onChange?: (value: TimeValue) => void
  /** Minute granularity for the middle column. Default 5. */
  readonly minuteStep?: number
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const MERIDIEMS: readonly Meridiem[] = ['AM', 'PM']
const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

/**
 * `<TimePicker>` — three columns (Hour 1–12, Minute 00–59 by `minuteStep`, AM/PM). Hour + Min are quiet
 * scroll lists inside their own hairline box; AM/PM is two flat buttons, not a scroller. The selected
 * option in each column sits on `--xeno-control`. Controlled via `value` / `onChange`; each list is a
 * `listbox` whose options rove with ↑/↓, Home/End jump, Enter/Space select. On change the selected
 * scroll option is centred within its own column (never scrolling the page).
 */
export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  className,
  ...rest
}: TimePickerProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)

  const step = minuteStep > 0 ? minuteStep : 5
  const minutes: number[] = []
  for (let mnt = 0; mnt < 60; mnt += step) minutes.push(mnt)

  // Centre the selected option within each SCROLL column's own box (no page scroll).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-timecol]').forEach((col) => {
      const sel = col.querySelector<HTMLElement>('[data-selection="on"]')
      if (sel) col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.offsetHeight / 2
    })
  }, [value.hour, value.minute, value.meridiem, step])

  // Roving focus within one column's options.
  const onColumnKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-option]'))
    if (options.length === 0) return
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null
    const cur = activeEl instanceof HTMLButtonElement ? options.indexOf(activeEl) : -1
    let next = cur < 0 ? 0 : cur
    if (e.key === 'ArrowUp') next = cur <= 0 ? options.length - 1 : cur - 1
    else if (e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    options[next]?.focus()
  }

  const column = (
    label: string,
    items: readonly (number | Meridiem)[],
    isSelected: (item: number | Meridiem) => boolean,
    format: (item: number | Meridiem) => string,
    onPick: (item: number | Meridiem) => void,
    scroll: boolean,
  ): ReactElement => (
    <div className="xeno-timepicker-col">
      <div className="xeno-timepicker-col-head" aria-hidden="true">
        {label}
      </div>
      <div
        className="xeno-timepicker-list"
        role="listbox"
        aria-label={label}
        data-scroll={scroll ? '' : undefined}
        data-timecol={scroll ? '' : undefined}
        onKeyDown={onColumnKeyDown}
      >
        {items.map((item) => {
          const on = isSelected(item)
          return (
            <button
              type="button"
              className="xeno-timepicker-option"
              role="option"
              key={String(item)}
              data-option=""
              data-selection={on ? 'on' : 'off'}
              data-availability="enabled"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onPick(item)}
            >
              {format(item)}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className={cx('xeno-timepicker', className)} role="group" aria-label="Time" ref={rootRef} {...rest}>
      {column(
        'Hour',
        HOURS,
        (h) => h === value.hour,
        (h) => String(h),
        (h) => onChange?.({ ...value, hour: h as number }),
        true,
      )}
      {column(
        'Min',
        minutes,
        (mnt) => mnt === value.minute,
        (mnt) => pad2(mnt as number),
        (mnt) => onChange?.({ ...value, minute: mnt as number }),
        true,
      )}
      {column(
        'AM/PM',
        MERIDIEMS,
        (mer) => mer === value.meridiem,
        (mer) => String(mer),
        (mer) => onChange?.({ ...value, meridiem: mer as Meridiem }),
        false,
      )}
    </div>
  )
}

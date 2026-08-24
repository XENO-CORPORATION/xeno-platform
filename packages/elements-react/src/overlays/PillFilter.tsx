import { useState, type HTMLAttributes, type ReactElement } from 'react'
import { sizeAttr, cx, type ControlSizeToken } from '../controls/util.js'

/**
 * `<PillFilter>` — a wrapping row of small toggle pills (rounded squares, `radius-md`) for
 * multi-select. Each pill is its own on/off toggle on the selection axis (`aria-pressed` +
 * `data-selection`); the whole row is a `role="group"`. A selected pill fills to
 * `var(--xeno-control)` with a `var(--xeno-muted)` hairline; an optional `count` renders as a small
 * inset badge.
 *
 * Controlled: `value` is the array of selected option values and `onValueChange` receives the next
 * array on every toggle. A disabled option rides the availability axis and cannot be toggled.
 */
export interface PillOption {
  readonly value: string
  readonly label: string
  readonly count?: number
  readonly disabled?: boolean
}

export interface PillFilterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  readonly value: readonly string[]
  readonly onValueChange?: (value: string[]) => void
  readonly options: readonly PillOption[]
  readonly size?: ControlSizeToken
}

export function PillFilter({
  value,
  onValueChange,
  options,
  size = 'sm',
  className,
  ...rest
}: PillFilterProps): ReactElement {
  const toggle = (v: string): void => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v]
    onValueChange?.(next)
  }

  /**
   * The fill pours in on a keyframe, so a row rendered with pills already selected would pour every one
   * of them on page load. Arming has to be PER PILL, not per row: arming the whole row on the first
   * click would make every already-selected pill flood at that moment too, which is the same bug one
   * interaction later. A pill joins the set the first time its own selection actually flips, and stays.
   *
   * The comparison is on a sorted key, not on the array's identity — a parent that rebuilds `value` on
   * every render would otherwise look like a change every time, and setting state during render on
   * every render does not terminate.
   */
  const key = [...value].sort().join('\u0000')
  const [seen, setSeen] = useState<{ key: string; list: readonly string[] }>({ key, list: value })
  const [armed, setArmed] = useState<ReadonlySet<string>>(() => new Set<string>())
  if (seen.key !== key) {
    const before = new Set(seen.list)
    const after = new Set(value)
    const flipped = [...new Set([...seen.list, ...value])].filter((v) => before.has(v) !== after.has(v))
    if (flipped.length > 0) {
      setArmed((prev) => {
        const next = new Set(prev)
        for (const v of flipped) next.add(v)
        return next
      })
    }
    setSeen({ key, list: value })
  }

  return (
    <div role="group" className={cx('xeno-pillfilter', className)} {...sizeAttr(size)} {...rest}>
      {options.map((o) => {
        const selected = value.includes(o.value)
        const disabled = o.disabled ?? false
        return (
          <button
            key={o.value}
            type="button"
            className="xeno-pill"
            data-selection={selected ? 'on' : 'off'}
            data-availability={disabled ? 'disabled' : 'enabled'}
            {...(armed.has(o.value) ? { 'data-motion': 'ready' } : {})}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(o.value)}
          >
            <span className="xeno-pill-label">{o.label}</span>
            {o.count !== undefined && (
              <span className="xeno-pill-count" aria-hidden="true">
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

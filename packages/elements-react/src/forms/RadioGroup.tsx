import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { forwardRef, useRef, useState } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<RadioRow>` — one selectable row in a radio group. A rounded-SQUARE marker (never a circle) holds a
 * smaller inner square that scales in when selected. CSS-first: the `selection` axis (`data-selection`)
 * mirrors `aria-checked`. Usable standalone or, more usually, mapped by {@link RadioGroup}. Controlled:
 * reports its own `value` up through `onSelect`.
 */
export interface RadioRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children' | 'onSelect'> {
  /** The value this row represents. */
  readonly value: string
  /** Whether this row is the selected one. */
  readonly checked: boolean
  /** Fires with this row's `value` when chosen. */
  readonly onSelect?: (value: string) => void
  /** Label rendered to the right of the marker. */
  readonly label?: ReactNode
}

/**
 * The ref is FORWARDED rather than taken as a plain prop. Accepting `ref` in the props object is React
 * 19 only; on React 18 — which this package's peer range still allows — `createElement` strips it, so
 * the group's `refs.current[i]` would stay null and `focus()` after an arrow key would be a silent
 * no-op: selection would move and focus would not, which is precisely the roving-tabindex contract.
 */
export const RadioRow = forwardRef<HTMLButtonElement, RadioRowProps>(function RadioRow(
  { value, checked, onSelect, label, disabled = false, className, onClick, ...rest },
  ref,
): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      ref={ref}
      className={cx('xeno-radio', className)}
      data-selection={checked ? 'on' : 'off'}
      data-availability={disabled ? 'disabled' : 'enabled'}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onSelect?.(value)
      }}
      {...rest}
    >
      <span className="xeno-radio-marker" aria-hidden="true">
        <span className="xeno-radio-dot" />
      </span>
      {label !== undefined && <span className="xeno-radio-label">{label}</span>}
    </button>
  )
})

/** One choice in a {@link RadioGroup}. */
export interface RadioOption {
  readonly value: string
  readonly label: ReactNode
  readonly disabled?: boolean
}

/**
 * `<RadioGroup>` — a controlled `role="radiogroup"` that maps `options` to {@link RadioRow}s. Keyboard is
 * hand-rolled to the WAI-ARIA radio pattern: Arrow keys move selection (and focus) to the next/previous
 * enabled option and wrap; Home/End jump to the first/last; disabled options are skipped. Roving
 * tabindex keeps exactly one row in the tab order.
 */
export interface RadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** The selected value. */
  readonly value: string
  /** Fires with the newly selected value. */
  readonly onValueChange?: (value: string) => void
  /** The choices, in order. */
  readonly options: readonly RadioOption[]
  /** Shared group name, forwarded to each row. */
  readonly name: string
  /** Disable the whole group. */
  readonly disabled?: boolean
  /** Layout axis. */
  readonly orientation?: 'vertical' | 'horizontal'
}

export function RadioGroup({
  value,
  onValueChange,
  options,
  name,
  disabled = false,
  orientation = 'vertical',
  className,
  onKeyDown,
  ...rest
}: RadioGroupProps): ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const select = (v: string): void => onValueChange?.(v)

  // First enabled index reached by stepping `dir` from `start` (exclusive), wrapping; -1 if none.
  const nextEnabled = (start: number, dir: number): number => {
    const n = options.length
    for (let step = 1; step <= n; step++) {
      const j = (((start + dir * step) % n) + n) % n
      const opt = options[j]
      if (opt && opt.disabled !== true) return j
    }
    return -1
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(e)
    if (e.defaultPrevented || disabled || options.length === 0) return
    const curr = options.findIndex((o) => o.value === value)
    let target = -1
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        target = nextEnabled(curr < 0 ? -1 : curr, 1)
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        target = nextEnabled(curr < 0 ? 0 : curr, -1)
        break
      case 'Home':
        target = nextEnabled(-1, 1)
        break
      case 'End':
        target = nextEnabled(0, -1)
        break
      default:
        return
    }
    e.preventDefault()
    const opt = options[target]
    if (!opt) return
    select(opt.value)
    refs.current[target]?.focus()
  }

  // Roving tabindex: the selected row is tabbable; if nothing is selected, the first enabled row is.
  const selectedIdx = options.findIndex((o) => o.value === value)
  const firstEnabled = disabled ? -1 : options.findIndex((o) => o.disabled !== true)
  const rovingIdx = selectedIdx >= 0 ? selectedIdx : firstEnabled

  /**
   * The mark stamps itself in on a keyframe, which plays as soon as its rule matches — so a group that
   * mounts with a choice already made would stamp it on page load. Arm on the first render where
   * `value` genuinely changes. The flag lives on the GROUP rather than the row, which is only safe
   * because exactly one radio can be on: the sole rule that starts matching when the group arms belongs
   * to the row that just changed.
   */
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (!armed) setArmed(true)
  }

  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-orientation={orientation}
      data-availability={disabled ? 'disabled' : 'enabled'}
      {...(armed ? { 'data-motion': 'ready' } : {})}
      className={cx('xeno-radiogroup', className)}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {options.map((opt, i) => (
        <RadioRow
          key={opt.value}
          value={opt.value}
          checked={opt.value === value}
          onSelect={select}
          label={opt.label}
          disabled={disabled || opt.disabled === true}
          name={name}
          tabIndex={i === rovingIdx ? 0 : -1}
          ref={(el) => {
            refs.current[i] = el
          }}
        />
      ))}
    </div>
  )
}

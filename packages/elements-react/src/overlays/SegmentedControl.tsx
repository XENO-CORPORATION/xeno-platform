import { useState, type CSSProperties, type HTMLAttributes, type ReactElement } from 'react'
import { sizeAttr, cx, type ControlSizeToken } from '../controls/util.js'

/**
 * `<SegmentedControl>` — a single-select of connected options inside one bordered track (a rounded
 * square, `radius-md`). The chosen option floats on an inset `var(--xeno-control)` fill; the rest are
 * transparent `var(--xeno-muted)` labels. Semantics are a `role="group"` of `aria-pressed` buttons
 * (the selection axis), so exactly one option reads as pressed.
 *
 * Controlled: the caller owns `value`/`onValueChange`. Clicking the already-selected option is a no-op
 * (a segmented control always keeps one option chosen). A disabled option rides the availability axis.
 */
export interface SegmentedOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  readonly value: string
  readonly onValueChange?: (value: string) => void
  readonly options: readonly SegmentedOption[]
  readonly size?: ControlSizeToken
}

export function SegmentedControl({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...rest
}: SegmentedControlProps): ReactElement {
  /**
   * The two numbers the stylesheet cannot work out for itself — how many segments there are, and which
   * one is chosen. They are DATA, not animation: CSS derives the thumb's width and offset from them and
   * owns every frame. An index of -1 (a `value` matching no option) parks the thumb and hides it.
   */
  const index = options.findIndex((o) => o.value === value)

  /* The squash is a keyframe, and a keyframe plays the moment its rule matches — so a control that
     mounts with a selection would squash on page load. Arm on the first genuine change of `value`. */
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(value)
  /**
   * How far the thumb is about to travel, in segments. The goo stretches in proportion to it, so a jump
   * from one end to the other reaches further than a step to the neighbour. Capped at 2: past that the
   * stretch stops adding anything and starts looking like a smear.
   */
  const [distance, setDistance] = useState(1)
  if (seen !== value) {
    const from = options.findIndex((o) => o.value === seen)
    if (from >= 0 && index >= 0) setDistance(Math.min(2, Math.abs(index - from)))
    setSeen(value)
    if (!armed) setArmed(true)
  }

  // Only the per-instance numbers stay inline; the size metrics moved to `data-xeno-size`.
  const trackVars = {
    '--xeno-seg-count': options.length,
    '--xeno-seg-index': Math.max(0, index),
    '--xeno-seg-dist': distance,
  } as CSSProperties

  return (
    <div
      role="group"
      className={cx('xeno-segmented', className)}
      data-selection={index >= 0 ? 'on' : 'off'}
      data-index={index >= 0 ? index : undefined}
      {...(armed ? { 'data-motion': 'ready' } : {})}
      {...sizeAttr(size)}
      style={trackVars}
      {...rest}
    >
      <span className="xeno-segmented-thumb" aria-hidden="true" />
      {options.map((o) => {
        const selected = o.value === value
        const disabled = o.disabled ?? false
        return (
          <button
            key={o.value}
            type="button"
            className="xeno-segmented-option"
            data-selection={selected ? 'on' : 'off'}
            data-availability={disabled ? 'disabled' : 'enabled'}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => {
              if (!selected) onValueChange?.(o.value)
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

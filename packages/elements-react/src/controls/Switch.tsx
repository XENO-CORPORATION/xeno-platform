import { useState, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { cx } from './util.js'

/**
 * `<Switch>` — a track+knob on/off control. Grammar-consistent: the track is a rounded SQUARE
 * (`radius.md`) and the knob a smaller rounded square (`radius.xs`) — never circles, matching the
 * chat's locked square switch. Honours `selection` (data-selection / aria-checked) and `availability`.
 */
export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  readonly checked: boolean
  readonly onCheckedChange?: (checked: boolean) => void
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  onClick,
  ...rest
}: SwitchProps): ReactElement {
  /**
   * The knob's throw is a KEYFRAME, and a keyframe plays the moment its rule starts matching — so a
   * switch that mounts in the "off" state would bounce on page load, unprompted. Arm the motion on the
   * first render where `checked` actually CHANGES (whoever moved it — the click, or the parent), and
   * leave it armed; before that the switch is simply drawn in whichever state it was handed.
   */
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(checked)
  if (seen !== checked) {
    setSeen(checked)
    if (!armed) setArmed(true)
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('xeno-switch', className)}
      data-selection={checked ? 'on' : 'off'}
      data-availability={disabled ? 'disabled' : 'enabled'}
      {...(armed ? { 'data-motion': 'ready' } : {})}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onCheckedChange?.(!checked)
      }}
      {...rest}
    >
      <span className="xeno-switch-knob" aria-hidden="true" />
    </button>
  )
}

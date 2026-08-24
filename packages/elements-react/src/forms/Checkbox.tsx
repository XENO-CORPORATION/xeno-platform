import { useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import Check from '@xenosystem/elements/elements/check'
import Minus from '@xenosystem/elements/elements/minus'

/**
 * `<Checkbox>` — a rounded-SQUARE box (never a circle). CSS-first: the `selection` axis drives paint via
 * `data-selection="off|on|mixed"`, matching `aria-checked`. Checked fills with `--xeno-text` and stamps a
 * check glyph in `--xeno-on-accent`; indeterminate stamps a minus glyph. An optional label sits to the
 * right and is part of the button, so clicking the word toggles too. Controlled: owns nothing, reports
 * the next boolean through `onCheckedChange` (a mixed box resolves to `true` on click).
 */
export type CheckboxState = boolean | 'mixed'

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  /** Tri-state: `true`, `false`, or `'mixed'` (indeterminate). */
  readonly checked: CheckboxState
  /** Fires with the next boolean value (mixed → true). */
  readonly onCheckedChange?: (checked: boolean) => void
  /** Optional clickable label rendered to the right of the box. */
  readonly label?: ReactNode
}

/** Glyph px inside the ~17px box — small enough to breathe within the marker. */
const GLYPH_PX = 13

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
  onClick,
  ...rest
}: CheckboxProps): ReactElement {
  const selection = checked === 'mixed' ? 'mixed' : checked ? 'on' : 'off'

  /**
   * The tick DRAWS itself when it appears, and a CSS animation starts the moment its element exists —
   * so a form that mounts with boxes already ticked would draw every one of them on page load. Arm on
   * the first render where `checked` actually changes, and leave it armed.
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
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      className={cx('xeno-checkbox', className)}
      data-selection={selection}
      data-availability={disabled ? 'disabled' : 'enabled'}
      {...(armed ? { 'data-motion': 'ready' } : {})}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onCheckedChange?.(checked !== true)
      }}
      {...rest}
    >
      <span className="xeno-checkbox-box" aria-hidden="true">
        {checked === 'mixed' ? (
          <XenoElement decl={Minus} size={GLYPH_PX} />
        ) : checked ? (
          <XenoElement decl={Check} size={GLYPH_PX} />
        ) : null}
      </span>
      {label !== undefined && <span className="xeno-checkbox-label">{label}</span>}
    </button>
  )
}

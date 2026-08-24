import { useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from './util.js'

/**
 * `<ToggleButton>` — a button-shaped on/off control (the chat's skills On/Off, byte-identical in two
 * files). It honours the `selection` axis via `data-selection` and `aria-pressed` — the SAME axis the
 * bookmark icon uses. Persistent selection, not a transient press.
 */
export interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'onChange'> {
  readonly pressed: boolean
  readonly onPressedChange?: (pressed: boolean) => void
  readonly size?: ControlSizeToken
  readonly leadingIcon?: ElementDeclaration
  /** The label when OFF (and the only label, if `pressedChildren` is not given). */
  readonly children?: ReactNode
  /**
   * The label when ON — `Following` to a `Follow`, `Pinned` to a `Pin`. Give BOTH and the button holds
   * one width for both: the longer word is what it is sized to, in either state, so pressing it never
   * makes it jump. Omit it and the one label is used throughout.
   */
  readonly pressedChildren?: ReactNode
}

export function ToggleButton({
  pressed,
  onPressedChange,
  size = 'md',
  leadingIcon,
  disabled = false,
  className,
  children,
  pressedChildren,
  onClick,
  ...rest
}: ToggleButtonProps): ReactElement {
  /**
   * The fill pours in on a KEYFRAME, and a keyframe plays as soon as its rule starts matching — so a
   * toggle that mounts already pressed would pour itself in on page load. Arm on the first render where
   * `pressed` actually CHANGES (from the click, or from the parent), and stay armed.
   */
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(pressed)
  if (seen !== pressed) {
    setSeen(pressed)
    if (!armed) setArmed(true)
  }
  return (
    <button
      type="button"
      className={cx('xeno-btn', 'xeno-toggle', className)}
      data-selection={pressed ? 'on' : 'off'}
      data-availability={disabled ? 'disabled' : 'enabled'}
      {...(armed ? { 'data-motion': 'ready' } : {})}
      aria-pressed={pressed}
      disabled={disabled}
      {...sizeAttr(size)}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onPressedChange?.(!pressed)
      }}
      {...rest}
    >
      {/* The glyph is handed the SAME selection the button is in, so a stateful element — bookmark is
          the canonical one — draws its outline when off and its filled twin when on, straight from the
          declaration. Nothing to configure at the call site: pass a plain glyph and it simply ignores
          the state. */}
      {leadingIcon && (
        <XenoElement
          decl={leadingIcon}
          size={iconPx(size)}
          state={{ selection: pressed ? 'on' : 'off' }}
        />
      )}
      {/* Two labels of different lengths are the reason a toggle appears to resize itself — nothing to do
          with the motion. Both are rendered into the SAME grid cell, so the button is always as wide as
          the longer of the two and the state swap only changes which one is showing. The hidden one is
          `aria-hidden`, so it holds space without being read out. */}
      {pressedChildren === undefined ? (
        children
      ) : (
        <span className="xeno-toggle-labels">
          <span className="xeno-toggle-label" data-when="off" aria-hidden={pressed || undefined}>
            {children}
          </span>
          <span className="xeno-toggle-label" data-when="on" aria-hidden={!pressed || undefined}>
            {pressedChildren}
          </span>
        </span>
      )}
    </button>
  )
}

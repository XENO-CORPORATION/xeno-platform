import type { MouseEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import Check from '@xenosystem/elements/elements/check'
import { IconButton, type IconButtonProps } from './IconButton.js'

/**
 * `<ConfirmButton>` — an {@link IconButton} that, on activate, swaps its glyph to a confirmation (a
 * check by default) for a beat, then reverts. Generalises the copy→check affordance the CodeBlock
 * hand-rolls, so any action can acknowledge itself. The confirmed glyph pops in on the overshoot easing;
 * the swap and `aria-label` update announce success to a screen reader.
 */
export interface ConfirmButtonProps extends Omit<IconButtonProps, 'icon'> {
  /** The resting glyph (e.g. `xeno.copy`). */
  readonly icon: ElementDeclaration
  /** The glyph shown after activating. Default `xeno.check`. */
  readonly confirmIcon?: ElementDeclaration
  /** How long the confirmation shows, ms. Default 1500. */
  readonly confirmMs?: number
  /** `aria-label` while confirmed (e.g. "Copied"). Falls back to the resting label. */
  readonly confirmLabel?: string
  /** Fired when the action is taken (do the copy/etc. here). */
  readonly onConfirm?: () => void
}

export function ConfirmButton({
  icon,
  confirmIcon = Check,
  confirmMs = 1500,
  confirmLabel,
  onConfirm,
  onClick,
  'aria-label': ariaLabel,
  ...rest
}: ConfirmButtonProps): ReactElement {
  const [confirmed, setConfirmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <IconButton
      icon={confirmed ? confirmIcon : icon}
      aria-label={confirmed ? (confirmLabel ?? ariaLabel) : ariaLabel}
      data-confirmed={confirmed ? '' : undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        onConfirm?.()
        setConfirmed(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setConfirmed(false), confirmMs)
      }}
      {...rest}
    />
  )
}

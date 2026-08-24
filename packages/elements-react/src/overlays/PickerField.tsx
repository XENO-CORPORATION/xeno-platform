import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import ChevronRight from '@xenosystem/elements/elements/chevron-right'
import { Reveal } from './Reveal.js'

/**
 * `<PickerField>` — a form field that REVEALS a panel (a {@link DatePicker}, {@link TimePicker}, or any
 * content) with the chat's "Scheduled" open/close animation, via {@link Reveal}: the panel unfolds
 * in-flow (pushing content down, never floating over it), full-width, its content fading up a beat
 * later. The trigger shows a `label`, the current `value` (or `placeholder`), and a chevron that turns
 * as it opens. Controlled (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`); Esc and an outside
 * click dismiss it.
 *
 * For several fields that should share ONE reveal (so switching between them never dips the layout),
 * compose your own triggers with a single {@link Reveal} instead — see the preview's date/time pair.
 */
export interface PickerFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  /** The value shown in the field (e.g. a formatted date). Falls back to `placeholder` when empty. */
  readonly value?: ReactNode
  /** Shown, muted, when `value` is empty. */
  readonly placeholder?: string
  /** A small caption before the value (e.g. "Date"). */
  readonly label?: string
  /** A leading glyph, drawn by the shared renderer. */
  readonly icon?: ElementDeclaration
  /** Controlled open state. Omit to use `defaultOpen`. */
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** Which field edge the panel aligns to. Default `start`. */
  readonly align?: 'start' | 'end'
  /** The revealed content — a picker, a menu, anything. */
  readonly children?: ReactNode
}

export function PickerField({
  value,
  placeholder,
  label,
  icon,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  align = 'start',
  className,
  children,
  ...rest
}: PickerFieldProps): ReactElement {
  const controlled = openProp !== undefined
  const [openState, setOpenState] = useState(defaultOpen)
  const open = controlled ? openProp : openState
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const setOpen = (next: boolean): void => {
    onOpenChange?.(next)
    if (!controlled) setOpenState(next)
  }

  // Dismiss on Escape / outside click, only while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const empty = value === undefined || value === null || value === ''

  return (
    <div ref={rootRef} className={cx('xeno-field', className)} data-align={align} {...rest}>
      <button
        type="button"
        className="xeno-field-trigger"
        data-open={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon && (
          <span className="xeno-field-icon" aria-hidden="true">
            <XenoElement decl={icon} size={16} />
          </span>
        )}
        {label && <span className="xeno-field-label">{label}</span>}
        <span className="xeno-field-value" data-placeholder={empty ? 'true' : 'false'}>
          {empty ? placeholder : value}
        </span>
        <span className="xeno-field-chevron" aria-hidden="true">
          <XenoElement decl={ChevronRight} size={14} />
        </span>
      </button>

      <Reveal open={open} align={align} panelProps={{ id: panelId, role: 'dialog', 'aria-modal': false }}>
        {children}
      </Reveal>
    </div>
  )
}

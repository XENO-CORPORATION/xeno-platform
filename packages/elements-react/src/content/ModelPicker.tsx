import type { HTMLAttributes, KeyboardEvent, ReactElement } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from '../controls/util.js'
import Gear from '@xenosystem/elements/elements/gear'
import ChevronDown from '@xenosystem/elements/elements/chevron-down'
import Check from '@xenosystem/elements/elements/check'

/**
 * `<ModelPicker>` — a model chooser: a trigger button (leading glyph + current model + a chevron) that
 * opens a panel of options. It is the same monochrome grammar as the controls — a `button` on the
 * `availability` axis, options on the `selection` axis (`data-selection` + `aria-selected`), and a
 * hand-rolled overlay (a relative wrapper + an absolute panel, no portal lib).
 *
 * Two panel layouts via `layout`:
 *  - `tray` — an absolute dropdown of grouped rows (a provider header + model rows); the selected row is
 *    marked with a check glyph on a `--xeno-control` ground.
 *  - `rail` — a horizontal, scrollable strip of compact chips with left/right fade edges; the selected
 *    chip sits on `--xeno-control`.
 *
 * Controlled selection (`value` / `onChange`) and optionally controlled open state (`open` /
 * `onOpenChange`). Esc and an outside click close it; keyboard nav is hand-rolled (Arrow keys move the
 * active option, Home/End jump, Enter/Space select) via `aria-activedescendant`.
 */
export interface ModelOption {
  readonly id: string
  readonly label: string
  /** The vendor/family label — becomes a group header (tray) or a chip eyebrow (rail). */
  readonly provider?: string
}

export type ModelPickerLayout = 'tray' | 'rail'

export interface ModelPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  readonly options: readonly ModelOption[]
  /** The selected option id. */
  readonly value: string
  readonly onChange?: (id: string) => void
  readonly layout?: ModelPickerLayout
  readonly size?: ControlSizeToken
  /** The trigger's leading glyph — defaults to Gear (pass Terminal, etc.). */
  readonly triggerIcon?: ElementDeclaration
  /** Shown on the trigger when `value` matches no option. */
  readonly placeholder?: string
  readonly disabled?: boolean
  /** Controlled open state; omit to let the component own it. */
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** Accessible name for the trigger and the listbox. */
  readonly label?: string
}

interface Grouped {
  readonly provider?: string
  readonly items: { readonly opt: ModelOption; readonly index: number }[]
}

export function ModelPicker({
  options,
  value,
  onChange,
  layout = 'tray',
  size = 'md',
  triggerIcon,
  placeholder = 'Select a model',
  disabled = false,
  open,
  onOpenChange,
  label,
  className,
  ...rest
}: ModelPickerProps): ReactElement {
  const baseId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const isControlledOpen = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlledOpen ? open : internalOpen
  const [activeIndex, setActiveIndex] = useState(0)

  const setOpen = (next: boolean): void => {
    if (!isControlledOpen) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const glyph = iconPx(size)
  const n = options.length
  const selected = options.find((o) => o.id === value)

  // On open: sync the active option to the selection, focus the panel, and wire outside-click to close.
  useEffect(() => {
    if (!isOpen) return
    const idx = options.findIndex((o) => o.id === value)
    setActiveIndex(idx >= 0 ? idx : 0)
    panelRef.current?.focus()
    const onDocPointer = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    return () => document.removeEventListener('mousedown', onDocPointer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const select = (opt: ModelOption): void => {
    onChange?.(opt.id)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const move = (delta: number): void => {
    if (n === 0) return
    setActiveIndex((cur) => (cur + delta + n) % n)
  }

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) setOpen(true)
    }
  }

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(n > 0 ? n - 1 : 0)
        break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const opt = options[activeIndex]
        if (opt) select(opt)
        break
      }
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  const availability = disabled ? 'disabled' : 'enabled'
  const listLabel = label ?? 'Model options'
  const activeId = `${baseId}-opt-${activeIndex}`

  // Group tray rows by provider, preserving first-seen order and each option's flat index (nav is flat).
  const groups: Grouped[] = []
  options.forEach((opt, index) => {
    const found = groups.find((g) => g.provider === opt.provider)
    if (found) found.items.push({ opt, index })
    else groups.push({ items: [{ opt, index }], ...(opt.provider !== undefined ? { provider: opt.provider } : {}) })
  })

  return (
    <div
      ref={rootRef}
      className={cx('xeno-model-picker', className)}
      data-layout={layout}
      data-open={isOpen ? 'true' : 'false'}
      data-availability={availability}
      {...rest}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cx('xeno-btn', 'xeno-mp-trigger')}
        data-variant="secondary"
        data-availability={availability}
        {...sizeAttr(size)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        {...(label !== undefined ? { 'aria-label': label } : {})}
        onClick={() => {
          if (!disabled) setOpen(!isOpen)
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <XenoElement decl={triggerIcon ?? Gear} size={glyph} />
        <span className={cx('xeno-mp-label', !selected && 'xeno-mp-placeholder')}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="xeno-mp-chevron" aria-hidden="true">
          <XenoElement decl={ChevronDown} size={glyph} />
        </span>
      </button>

      {isOpen && layout === 'tray' && (
        <div
          ref={panelRef}
          className="xeno-mp-panel xeno-mp-panel--tray"
          role="listbox"
          tabIndex={-1}
          aria-label={listLabel}
          aria-activedescendant={activeId}
          onKeyDown={onPanelKeyDown}
        >
          {groups.map((group, gi) => (
            <div
              key={group.provider ?? `__ungrouped-${gi}`}
              className="xeno-mp-group"
              role="group"
              {...(group.provider !== undefined ? { 'aria-label': group.provider } : {})}
            >
              {group.provider !== undefined && <div className="xeno-mp-group-label">{group.provider}</div>}
              {group.items.map(({ opt, index }) => {
                const isSel = opt.id === value
                return (
                  <div
                    key={opt.id}
                    id={`${baseId}-opt-${index}`}
                    role="option"
                    aria-selected={isSel}
                    className="xeno-mp-option"
                    data-selection={isSel ? 'on' : 'off'}
                    data-active={index === activeIndex ? 'true' : undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(opt)}
                  >
                    <span className="xeno-mp-check" aria-hidden="true">
                      {isSel && <XenoElement decl={Check} size={glyph} />}
                    </span>
                    <span className="xeno-mp-option-name">{opt.label}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {isOpen && layout === 'rail' && (
        <div
          ref={panelRef}
          className="xeno-mp-panel xeno-mp-panel--rail"
          role="listbox"
          aria-orientation="horizontal"
          tabIndex={-1}
          aria-label={listLabel}
          aria-activedescendant={activeId}
          onKeyDown={onPanelKeyDown}
        >
          <div className="xeno-mp-rail-viewport">
            <div className="xeno-mp-rail">
              {options.map((opt, index) => {
                const isSel = opt.id === value
                return (
                  <div
                    key={opt.id}
                    id={`${baseId}-opt-${index}`}
                    role="option"
                    aria-selected={isSel}
                    className="xeno-mp-chip"
                    data-selection={isSel ? 'on' : 'off'}
                    data-active={index === activeIndex ? 'true' : undefined}
                    title={opt.provider !== undefined ? `${opt.provider} · ${opt.label}` : opt.label}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(opt)}
                  >
                    {opt.provider !== undefined && <span className="xeno-mp-chip-provider">{opt.provider}</span>}
                    <span className="xeno-mp-chip-label">{opt.label}</span>
                    {isSel && (
                      <span className="xeno-mp-chip-check" aria-hidden="true">
                        <XenoElement decl={Check} size={Math.max(12, glyph - 2)} />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

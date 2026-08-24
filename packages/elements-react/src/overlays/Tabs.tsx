import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactElement, ReactNode } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from '../controls/util.js'

/**
 * `<Tabs>` — a horizontal tablist that follows the WAI-ARIA tabs pattern: `role="tablist"` wrapping
 * `role="tab"` buttons with a roving tabIndex (only the selected tab is in the tab order) and
 * Arrow/Home/End keys that move focus *and* selection (automatic activation). The selected tab reads
 * as `var(--xeno-text)` with a hairline underline; the rest sit at `var(--xeno-muted)`.
 *
 * Controlled: the caller owns `value`/`onValueChange`. An optional panel is drawn either from a
 * `renderPanel(value)` callback or from `children`; when present it is a `role="tabpanel"` labelled by
 * the selected tab. A disabled item rides the availability axis (`aria-disabled` + `data-availability`)
 * and is skipped by keyboard traversal — never made unfocusable-then-orphaned.
 */
export interface TabItem {
  readonly value: string
  readonly label: string
  /** A glyph before the label — imported per-id from `@xenosystem/elements`. */
  readonly icon?: ElementDeclaration
  readonly disabled?: boolean
}

// useLayoutEffect measures before paint on the client; fall back to useEffect on the server so SSR does
// not warn. (Same seam as <Reveal>.)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  readonly value: string
  readonly onValueChange?: (value: string) => void
  readonly items: readonly TabItem[]
  readonly size?: ControlSizeToken
  /** Draw the panel for the active tab. Wins over `children` when both are given. */
  readonly renderPanel?: (value: string) => ReactNode
  /** Panel content for the active tab (used when `renderPanel` is absent). */
  readonly children?: ReactNode
}

export function Tabs({
  value,
  onValueChange,
  items,
  size = 'md',
  renderPanel,
  children,
  className,
  'aria-label': ariaLabel,
  ...rest
}: TabsProps): ReactElement {
  const baseId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const glyph = iconPx(size)
  const currentIndex = items.findIndex((it) => it.value === value)

  /**
   * The underline is ONE bar that slides from the old tab to the new one, and to slide it has to know
   * where the new tab starts and how wide it is. A stylesheet cannot know that: a tab is as wide as its
   * label, which only layout can answer. So the component measures — once, when the selection or the
   * layout changes — and hands CSS two numbers. Measuring is not animating: CSS still owns every frame
   * between them, and nothing here runs per-frame.
   *
   * The alternative was forcing every tab to the same width, which would make it pure arithmetic (that
   * is what SegmentedControl does). Tabs are labels, not segments — they should keep their own width.
   */
  const [bar, setBar] = useState({ x: 0, w: 0 })
  useIsoLayoutEffect(() => {
    const list = listRef.current
    const tab = currentIndex >= 0 ? tabRefs.current[currentIndex] : null
    if (!list) return
    const measure = (): void => {
      if (!tab) {
        setBar((b) => (b.w === 0 ? b : { x: b.x, w: 0 }))
        return
      }
      const x = tab.offsetLeft
      const w = tab.offsetWidth
      setBar((b) => (b.x === x && b.w === w ? b : { x, w }))
    }
    measure()
    // Re-measure when the list is resized or a web font finally lands and relays the labels out.
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    for (const t of tabRefs.current) if (t) ro.observe(t)
    return () => ro.disconnect()
  }, [currentIndex, items, size])

  /* The travel is a transition, and a transition fires the moment the value changes — including the
     first measurement after mount, which would slide the bar in from the left edge on page load. Arm on
     the first genuine change of `value`. */
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(value)
  const [distance, setDistance] = useState(1)
  if (seen !== value) {
    const from = items.findIndex((it) => it.value === seen)
    if (from >= 0 && currentIndex >= 0) setDistance(Math.min(2, Math.abs(currentIndex - from)))
    setSeen(value)
    if (!armed) setArmed(true)
  }

  // Only the MEASURED values stay inline — they are per-instance and cannot come from a stylesheet.
  // The size metrics moved to `data-xeno-size` so a surface can reach them.
  const listVars = {
    '--xeno-tab-x': `${bar.x}px`,
    '--xeno-tab-w': `${bar.w}px`,
    '--xeno-tab-dist': distance,
  } as CSSProperties

  const activate = (index: number): void => {
    const item = items[index]
    if (!item || item.disabled) return
    onValueChange?.(item.value)
    tabRefs.current[index]?.focus()
  }

  const step = (from: number, dir: 1 | -1): number => {
    const n = items.length
    let idx = from
    for (let k = 0; k < n; k++) {
      idx = (idx + dir + n) % n
      const it = items[idx]
      if (it && !it.disabled) return idx
    }
    return from
  }

  const edge = (dir: 1 | -1): number => {
    const n = items.length
    if (dir === 1) {
      for (let i = 0; i < n; i++) {
        const it = items[i]
        if (it && !it.disabled) return i
      }
      return 0
    }
    for (let i = n - 1; i >= 0; i--) {
      const it = items[i]
      if (it && !it.disabled) return i
    }
    return n - 1
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) return
    const base = currentIndex < 0 ? 0 : currentIndex
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        activate(step(base, 1))
        break
      case 'ArrowLeft':
        e.preventDefault()
        activate(step(base, -1))
        break
      case 'Home':
        e.preventDefault()
        activate(edge(1))
        break
      case 'End':
        e.preventDefault()
        activate(edge(-1))
        break
    }
  }

  const hasPanel = renderPanel !== undefined || children !== undefined
  const panelId = `${baseId}-panel`
  const panelContent = renderPanel !== undefined ? renderPanel(value) : children

  return (
    <div className={cx('xeno-tabs', className)} {...rest}>
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        className="xeno-tablist"
        data-index={currentIndex >= 0 ? Math.min(7, currentIndex) : undefined}
        {...(armed ? { 'data-motion': 'ready' } : {})}
        {...sizeAttr(size)}
        style={listVars}
        onKeyDown={onKeyDown}
        {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      >
        {items.map((item, i) => {
          const selected = item.value === value
          const disabled = item.disabled ?? false
          const focusable = selected || (currentIndex < 0 && i === 0)
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              className="xeno-tab"
              data-selection={selected ? 'on' : 'off'}
              data-availability={disabled ? 'disabled' : 'enabled'}
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              {...(hasPanel ? { 'aria-controls': panelId } : {})}
              tabIndex={focusable ? 0 : -1}
              onClick={() => {
                if (disabled) return
                onValueChange?.(item.value)
              }}
            >
              {item.icon && <XenoElement decl={item.icon} size={glyph} />}
              <span className="xeno-tab-label">{item.label}</span>
            </button>
          )
        })}
        {/* Last child, so the tabs keep their natural `:nth-child` numbering. */}
        <span className="xeno-tab-indicator" aria-hidden="true" />
      </div>
      {hasPanel && (
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${baseId}-tab-${value}`}
          tabIndex={0}
          className="xeno-tab-panel"
        >
          {panelContent}
        </div>
      )}
    </div>
  )
}

export interface TabProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly size?: ControlSizeToken
  readonly selectionStyle?: 'fill' | 'ring' | 'underline'
  readonly selected?: boolean
  readonly icon?: ElementDeclaration
  readonly children?: ReactNode
  readonly disabled?: boolean
  readonly type?: 'button' | 'submit' | 'reset'
  readonly onClick?: React.MouseEventHandler<HTMLButtonElement>
}

export function Tab({
  size = 'md',
  selectionStyle = 'underline',
  selected,
  icon,
  className,
  children,
  style,
  disabled,
  type = 'button',
  ...rest
}: TabProps): ReactElement {
  const glyph = iconPx(size)
  const isRing = selectionStyle === 'ring'
  return (
    <button
      type={type}
      role="tab"
      data-selection={selected ? 'on' : 'off'}
      data-availability={disabled ? 'disabled' : 'enabled'}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      {...sizeAttr(size)}
      className={cx('xeno-tab', isRing && 'xeno-tab--ring', className)}
      style={
        isRing && selected
          ? {
              boxShadow: 'inset 0 0 0 1px var(--xeno-muted, rgba(255, 255, 255, 0.4))',
              ...style,
            }
          : style
      }
      disabled={disabled}
      {...rest}
    >
      {icon && <XenoElement decl={icon} size={glyph} />}
      <span className="xeno-tab-label">{children}</span>
    </button>
  )
}


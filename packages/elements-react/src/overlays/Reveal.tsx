import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Reveal>` — an IN-FLOW animated disclosure (the XENO chat's "Scheduled" reveal, generalised). When
 * `open`, an in-flow region animates its height (measured from the content) so surrounding content is
 * pushed DOWN — never floated over — while the content itself is clipped panel-WIDTH so a wide child
 * (e.g. a calendar) shows full width and only unfolds VERTICALLY, its content fading up a beat later.
 *
 * Because the region's height tracks the CONTENT, one shared `<Reveal>` swapped between two same-height
 * panels keeps a constant height — so switching panels never dips the layout. Hand-rolled, no portal
 * lib (SPEC §13). Returns nothing while closed + fully exited.
 */
export interface RevealProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly open: boolean
  /** Which edge the clipped panel aligns to. Default `start`. */
  readonly align?: 'start' | 'end'
  readonly children?: ReactNode
  /** Spread onto the panel node — `id`, `role`, `aria-*` (composition seam for {@link PickerField}). */
  readonly panelProps?: HTMLAttributes<HTMLDivElement>
}

/** Match the CSS reveal/exit duration so the region is unmounted only after it has animated out. */
const EXIT_MS = 240

// useLayoutEffect measures before paint on the client; fall back to useEffect on the server so SSR does
// not warn. `typeof window` is constant per environment, so the hook choice is stable.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function Reveal({
  open,
  align = 'start',
  children,
  panelProps,
  className,
  ...rest
}: RevealProps): ReactElement | null {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const [clipped, setClipped] = useState(true)
  const [height, setHeight] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  // The panel's natural height is what the region animates to. Re-measured when the content changes, so
  // a swapped-in panel of a different height re-targets smoothly.
  useIsoLayoutEffect(() => {
    if (mounted && panelRef.current) setHeight(panelRef.current.offsetHeight)
  }, [mounted, children])

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClipped(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      const unclip = setTimeout(() => setClipped(false), EXIT_MS + 30)
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
        clearTimeout(unclip)
      }
    }
    setShown(false)
    setClipped(true)
    const t = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open])

  if (!mounted) return null

  const { className: panelClassName, ...restPanel } = panelProps ?? {}
  return (
    <div
      className={cx('xeno-reveal', className)}
      data-open={shown ? 'true' : 'false'}
      style={{ height: shown ? height : 0 }}
      {...rest}
    >
      <div className="xeno-reveal-clip" data-clip={clipped ? 'true' : 'false'} data-align={align}>
        <div className={cx('xeno-reveal-panel', panelClassName)} ref={panelRef} {...restPanel}>
          <div className="xeno-reveal-content">{children}</div>
        </div>
      </div>
    </div>
  )
}

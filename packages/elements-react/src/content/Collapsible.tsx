import { useId, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import Sun from '@xenosystem/elements/elements/sun'
import ChevronDown from '@xenosystem/elements/elements/chevron-down'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'

/**
 * `<Collapsible>` — a "Thoughts"-style disclosure. The summary row pairs a lightbulb glyph (the Sun
 * element, the nearest monochrome stand-in) with a label and a rotating chevron; pressing it folds the
 * body. The body is set apart like a {@link Callout}: a 2px `--xeno-border` left rule with `12px` inset.
 *
 * State is controlled (`open` / `onOpenChange`) or uncontrolled (`defaultOpen`, internal state). The open
 * axis is stamped on the root as `data-open`; the chevron rotates from CSS off that seam — no JS motion.
 */
export interface CollapsibleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The always-visible label of the disclosure row. */
  readonly summary: ReactNode
  /** The foldaway body. */
  readonly children?: ReactNode
  /** Initial open state when uncontrolled. */
  readonly defaultOpen?: boolean
  /** Controlled open state. When set, `onOpenChange` owns transitions. */
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** The summary glyph — imported per-id from `@xenosystem/elements`. Defaults to the lightbulb-like Sun. */
  readonly icon?: ElementDeclaration
}

export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  icon = Sun,
  className,
  ...rest
}: CollapsibleProps): ReactElement {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const isOpen = open !== undefined ? open : uncontrolled
  const bodyId = useId()
  const labelId = useId()

  const toggle = (): void => {
    const next = !isOpen
    if (open === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }

  return (
    <div className={cx('xeno-collapsible', className)} data-open={isOpen ? '' : undefined} {...rest}>
      <button
        type="button"
        className="xeno-collapsible-summary"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="xeno-collapsible-icon" aria-hidden="true">
          <XenoElement decl={icon} size={16} />
        </span>
        <span id={labelId} className="xeno-collapsible-label">
          {summary}
        </span>
        <span className="xeno-collapsible-chevron" aria-hidden="true">
          <XenoElement decl={ChevronDown} size={16} />
        </span>
      </button>

      <div id={bodyId} className="xeno-collapsible-body" role="region" aria-labelledby={labelId} hidden={!isOpen}>
        {children}
      </div>
    </div>
  )
}

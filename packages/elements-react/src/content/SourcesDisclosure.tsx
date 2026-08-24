import { useId, useState, type HTMLAttributes, type ReactElement } from 'react'
import ChevronDown from '@xenosystem/elements/elements/chevron-down'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import { SourceCard, sourceInitial } from './SourceCard.js'

/** One referenced source — the row model shared by the stack avatar and the expanded <SourceCard>. */
export interface SourceRef {
  readonly title: string
  readonly domain: string
  readonly href?: string
  readonly snippet?: string
  readonly favicon?: string
}

/**
 * `<SourcesDisclosure>` — a BORDERLESS header row: a rotating chevron, the word "Sources", an overlapping
 * favicon STACK (square tiles, -8px overlap, +N overflow), and a mono, muted count. Clicking the header
 * toggles a panel of <SourceCard> rows.
 *
 * Disclosure state is controlled (`open` / `onOpenChange`) or uncontrolled (`defaultOpen`, internal state).
 * The open axis is stamped on the root as `data-open`; the chevron rotates from CSS off that seam.
 */
export interface SourcesDisclosureProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly sources: readonly SourceRef[]
  readonly defaultOpen?: boolean
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** How many favicons to stack before collapsing the rest into a +N overflow tile. Default 4. */
  readonly maxAvatars?: number
}

export function SourcesDisclosure({
  sources,
  defaultOpen = false,
  open,
  onOpenChange,
  maxAvatars = 4,
  className,
  ...rest
}: SourcesDisclosureProps): ReactElement {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const isOpen = open !== undefined ? open : uncontrolled
  const panelId = useId()

  const toggle = (): void => {
    const next = !isOpen
    if (open === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }

  const shown = sources.slice(0, maxAvatars)
  const overflow = sources.length - shown.length

  return (
    <div className={cx('xeno-sources', className)} data-open={isOpen ? '' : undefined} {...rest}>
      <button
        type="button"
        className="xeno-sources-header"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="xeno-sources-chevron" aria-hidden="true">
          <XenoElement decl={ChevronDown} size={16} />
        </span>
        <span className="xeno-sources-label">Sources</span>
        <span className="xeno-sources-stack" aria-hidden="true">
          {shown.map((s, i) => (
            <span key={i} className="xeno-sources-avatar" style={{ zIndex: shown.length - i }}>
              {s.favicon !== undefined ? (
                <img src={s.favicon} alt="" loading="lazy" />
              ) : (
                sourceInitial(s.domain)
              )}
            </span>
          ))}
          {overflow > 0 && (
            <span className="xeno-sources-avatar xeno-sources-overflow" style={{ zIndex: 0 }}>
              +{overflow}
            </span>
          )}
        </span>
        <span className="xeno-sources-count">{sources.length}</span>
      </button>

      <div
        id={panelId}
        className="xeno-sources-panel"
        role="region"
        aria-label="Sources"
        hidden={!isOpen}
      >
        {sources.map((s, i) => (
          <SourceCard
            key={i}
            title={s.title}
            domain={s.domain}
            {...(s.href !== undefined ? { href: s.href } : {})}
            {...(s.snippet !== undefined ? { snippet: s.snippet } : {})}
            {...(s.favicon !== undefined ? { favicon: s.favicon } : {})}
          />
        ))}
      </div>
    </div>
  )
}

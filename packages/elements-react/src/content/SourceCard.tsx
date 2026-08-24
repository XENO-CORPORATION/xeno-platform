import type { HTMLAttributes, ReactElement } from 'react'
import { cx } from '../controls/util.js'

/**
 * `sourceInitial` — the placeholder glyph for a source with no favicon: the domain's first letter,
 * upper-cased, with a leading `www.` stripped. Exported so <SourcesDisclosure> draws the same avatar
 * fallback as <SourceCard>.
 */
export function sourceInitial(domain: string): string {
  const cleaned = domain.replace(/^www\./i, '').trim()
  const first = cleaned[0] // noUncheckedIndexedAccess: string | undefined
  return (first ?? '?').toUpperCase()
}

/**
 * `<SourceCard>` — a link-embed row: a leading favicon/thumb TILE (square, radius-md — or a placeholder
 * carrying the domain initial when no favicon), then the title (`--xeno-text`), the domain (`--xeno-muted`),
 * and an optional snippet. Card radius, a hairline border, and on hover the border lifts to `--xeno-muted`.
 *
 * When `href` is set the whole row is an `<a>` (the accessible name is its own text; the tile is decorative).
 * With no `href` it degrades to a passive `<div>` embed.
 */
export interface SourceCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  readonly title: string
  readonly domain: string
  readonly href?: string
  readonly snippet?: string
  readonly favicon?: string
}

export function SourceCard({
  title,
  domain,
  href,
  snippet,
  favicon,
  className,
  ...rest
}: SourceCardProps): ReactElement {
  const tile = (
    <span
      className="xeno-source-card-tile"
      data-placeholder={favicon === undefined ? '' : undefined}
      aria-hidden="true"
    >
      {favicon !== undefined ? (
        <img className="xeno-source-card-favicon" src={favicon} alt="" loading="lazy" />
      ) : (
        sourceInitial(domain)
      )}
    </span>
  )

  const body = (
    <span className="xeno-source-card-body">
      <span className="xeno-source-card-title">{title}</span>
      <span className="xeno-source-card-domain">{domain}</span>
      {snippet !== undefined && <span className="xeno-source-card-snippet">{snippet}</span>}
    </span>
  )

  const cls = cx('xeno-source-card', className)

  return href !== undefined ? (
    <a className={cls} data-availability="enabled" href={href} {...rest}>
      {tile}
      {body}
    </a>
  ) : (
    <div className={cls} data-availability="enabled" {...rest}>
      {tile}
      {body}
    </div>
  )
}

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Badge, StatusPill, CountBadge, CitationBadge } from './Badges.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Badge', () => {
  it('renders a neutral mono chip carrying its label', () => {
    const out = html(<Badge>New</Badge>)
    expect(out).toContain('class="xeno-badge"')
    expect(out).toContain('data-tone="neutral"')
    expect(out).toContain('New')
  })

  it('merges a custom className and forwards rest props', () => {
    const out = html(<Badge className="mine" id="b1">x</Badge>)
    expect(out).toContain('xeno-badge mine')
    expect(out).toContain('id="b1"')
  })
})

describe('StatusPill', () => {
  it('defaults to neutral with no injected tone var', () => {
    const out = html(<StatusPill>Idle</StatusPill>)
    expect(out).toContain('class="xeno-statuspill"')
    expect(out).toContain('data-tone="neutral"')
    expect(out).not.toContain('--xeno-pill-tone')
  })

  it('injects the status TOKEN as an inline var for success and warning', () => {
    const ok = html(<StatusPill tone="success">Live</StatusPill>)
    expect(ok).toContain('data-tone="success"')
    expect(ok).toContain('--xeno-pill-tone:#3fb950')

    const warn = html(<StatusPill tone="warning">Slow</StatusPill>)
    expect(warn).toContain('data-tone="warning"')
    expect(warn).toContain('--xeno-pill-tone:#d29922')
  })

  it('routes danger through the theme token (no inline var)', () => {
    const out = html(<StatusPill tone="danger">Down</StatusPill>)
    expect(out).toContain('data-tone="danger"')
    expect(out).not.toContain('--xeno-pill-tone')
  })

  it('renders an aria-hidden square dot when requested', () => {
    const out = html(<StatusPill tone="success" dot>Live</StatusPill>)
    expect(out).toContain('class="xeno-statuspill-dot"')
    expect(out).toContain('aria-hidden="true"')
  })
})

describe('CountBadge', () => {
  it('renders the count in a tabular chip', () => {
    const out = html(<CountBadge count={5} />)
    expect(out).toContain('class="xeno-countbadge"')
    expect(out).toContain('>5<')
  })

  it('hides at zero unless showZero is set', () => {
    expect(html(<CountBadge count={0} />)).toBe('')
    expect(html(<CountBadge count={0} showZero />)).toContain('>0<')
  })

  it('caps values above max as {max}+', () => {
    expect(html(<CountBadge count={250} max={99} />)).toContain('99+')
  })
})

describe('CitationBadge', () => {
  it('renders an [XS:n] mono marker with an emphasised index', () => {
    const out = html(<CitationBadge index={3} />)
    expect(out).toContain('class="xeno-citation"')
    expect(out).toContain('[XS:')
    expect(out).toContain('class="xeno-citation-index"')
    expect(out).toContain('>3<')
    expect(out).toContain(']')
  })

  it('accepts a custom source label', () => {
    expect(html(<CitationBadge index={7} label="DOC" />)).toContain('[DOC:')
  })
})

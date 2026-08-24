import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Callout } from './Callout.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Callout', () => {
  it('renders a <blockquote> with the xeno-callout class and its children', () => {
    const out = html(<Callout>Take note.</Callout>)
    expect(out).toContain('<blockquote')
    expect(out).toContain('class="xeno-callout"')
    expect(out).toContain('Take note.')
  })

  it('defaults to the monochrome tone', () => {
    const out = html(<Callout>x</Callout>)
    expect(out).toContain('data-tone="default"')
  })

  it('stamps data-tone="danger" for the danger tone', () => {
    const out = html(<Callout tone="danger">Careful.</Callout>)
    expect(out).toContain('data-tone="danger"')
  })

  it('merges an extra className', () => {
    const out = html(<Callout className="extra">x</Callout>)
    expect(out).toContain('class="xeno-callout extra"')
  })

  it('gives danger an alert glyph and leaves the default tone unmarked', () => {
    const danger = html(<Callout tone="danger">Careful.</Callout>)
    expect(danger).toContain('data-icon')
    expect(danger).toContain('aria-label="Alert"')

    // A default callout is an aside; stamping a mark on it changes what it is.
    const plain = html(<Callout>Quiet.</Callout>)
    expect(plain).not.toContain('data-icon')
    expect(plain).not.toContain('<svg')
  })

  it('lets icon={false} suppress the danger default', () => {
    const out = html(
      <Callout tone="danger" icon={false}>
        Careful.
      </Callout>,
    )
    expect(out).toContain('data-tone="danger"')
    expect(out).not.toContain('<svg')
  })

  it('keeps children as direct descendants when there is no glyph to sit beside', () => {
    // The flex row only appears with an icon, so a blockquote of <p>s still lays out as prose.
    expect(html(<Callout>x</Callout>)).not.toContain('xeno-callout-body')
    expect(html(<Callout tone="danger">x</Callout>)).toContain('xeno-callout-body')
  })

  it('plays the entrance only when asked', () => {
    expect(html(<Callout enter>x</Callout>)).toContain('data-enter')
    expect(html(<Callout>x</Callout>)).not.toContain('data-enter')
  })
})

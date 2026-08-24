import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { SourceCard, sourceInitial } from './SourceCard.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('SourceCard', () => {
  it('renders the row with title, domain, and the enabled availability axis', () => {
    const out = html(<SourceCard title="Attention Is All You Need" domain="arxiv.org" />)
    expect(out).toContain('class="xeno-source-card"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('class="xeno-source-card-title"')
    expect(out).toContain('Attention Is All You Need')
    expect(out).toContain('class="xeno-source-card-domain"')
    expect(out).toContain('arxiv.org')
  })

  it('is an anchor when href is set, a plain div otherwise', () => {
    const linked = html(<SourceCard title="OpenAI" domain="openai.com" href="https://openai.com" />)
    expect(linked).toContain('<a')
    expect(linked).toContain('href="https://openai.com"')

    const passive = html(<SourceCard title="OpenAI" domain="openai.com" />)
    expect(passive).not.toContain('<a')
    expect(passive).toContain('<div')
  })

  it('draws a favicon image when given one', () => {
    const out = html(
      <SourceCard title="Wikipedia" domain="wikipedia.org" favicon="https://cdn.example/wiki.png" />,
    )
    expect(out).toContain('class="xeno-source-card-favicon"')
    expect(out).toContain('src="https://cdn.example/wiki.png"')
    expect(out).toContain('alt=""')
  })

  it('falls back to the domain initial when no favicon is given', () => {
    const out = html(<SourceCard title="OpenAI" domain="www.openai.com" />)
    expect(out).toContain('data-placeholder=""')
    expect(out).toContain('>O<') // www. stripped, first letter, upper-cased
    expect(out).not.toContain('xeno-source-card-favicon')
  })

  it('renders the snippet only when provided', () => {
    const withSnippet = html(
      <SourceCard title="Doc" domain="docs.example" snippet="A short summary line." />,
    )
    expect(withSnippet).toContain('class="xeno-source-card-snippet"')
    expect(withSnippet).toContain('A short summary line.')

    const without = html(<SourceCard title="Doc" domain="docs.example" />)
    expect(without).not.toContain('xeno-source-card-snippet')
  })

  it('merges a caller className', () => {
    expect(html(<SourceCard title="x" domain="x.com" className="mt-2" />)).toContain(
      'class="xeno-source-card mt-2"',
    )
  })
})

describe('sourceInitial', () => {
  it('strips a leading www. and upper-cases the first letter', () => {
    expect(sourceInitial('www.openai.com')).toBe('O')
    expect(sourceInitial('arxiv.org')).toBe('A')
  })

  it('degrades to ? for an empty domain', () => {
    expect(sourceInitial('')).toBe('?')
  })
})

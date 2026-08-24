import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Card } from './Card.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Card', () => {
  it('renders a flat, non-interactive surface by default', () => {
    const out = html(<Card>Body</Card>)
    expect(out).toContain('class="xeno-card"')
    expect(out).toContain('data-variant="flat"')
    expect(out).toContain('data-interactive="false"')
    expect(out).toContain('class="xeno-card-body"')
    expect(out).toContain('Body')
  })

  it('elevated variant reflects on the variant axis', () => {
    expect(html(<Card variant="elevated">x</Card>)).toContain('data-variant="elevated"')
  })

  it('marks the interactive hover-lift seam via data-interactive', () => {
    const on = html(<Card interactive>x</Card>)
    expect(on).toContain('data-interactive="true"')
  })

  it('renders optional header and footer slots when provided', () => {
    const out = html(
      <Card header={<span>Title</span>} footer={<span>Updated</span>}>
        Body
      </Card>,
    )
    expect(out).toContain('class="xeno-card-header"')
    expect(out).toContain('class="xeno-card-footer"')
    expect(out).toContain('Title')
    expect(out).toContain('Updated')
  })

  it('omits header and footer slots when not provided', () => {
    const out = html(<Card>x</Card>)
    expect(out).not.toContain('xeno-card-header')
    expect(out).not.toContain('xeno-card-footer')
  })

  it('merges a custom className and forwards rest attributes', () => {
    const out = html(
      <Card className="mine" role="group" aria-label="Stats">
        x
      </Card>,
    )
    expect(out).toContain('xeno-card mine')
    expect(out).toContain('role="group"')
    expect(out).toContain('aria-label="Stats"')
  })
})

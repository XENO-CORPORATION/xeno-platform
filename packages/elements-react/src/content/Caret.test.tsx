import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Caret } from './Caret.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Caret', () => {
  it('renders a decorative span carrying the xeno-caret class', () => {
    const out = html(<Caret />)
    expect(out).toContain('<span')
    expect(out).toContain('class="xeno-caret"')
    expect(out).toContain('aria-hidden="true"')
  })

  it('merges an extra className', () => {
    const out = html(<Caret className="extra" />)
    expect(out).toContain('class="xeno-caret extra"')
  })

  it('forwards arbitrary HTML attributes', () => {
    const out = html(<Caret data-streaming="true" />)
    expect(out).toContain('data-streaming="true"')
  })
})

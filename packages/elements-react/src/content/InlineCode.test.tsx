import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { InlineCode } from './InlineCode.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('InlineCode', () => {
  it('renders a <code> element carrying the xeno-inline-code class and its children', () => {
    const out = html(<InlineCode>npm run build</InlineCode>)
    expect(out).toContain('<code')
    expect(out).toContain('class="xeno-inline-code"')
    expect(out).toContain('npm run build')
  })

  it('merges an extra className', () => {
    const out = html(<InlineCode className="extra">x</InlineCode>)
    expect(out).toContain('class="xeno-inline-code extra"')
  })

  it('forwards arbitrary HTML attributes', () => {
    const out = html(<InlineCode id="c1" data-token="foo">y</InlineCode>)
    expect(out).toContain('id="c1"')
    expect(out).toContain('data-token="foo"')
  })
})

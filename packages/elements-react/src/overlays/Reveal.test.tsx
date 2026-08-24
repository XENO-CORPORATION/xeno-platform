import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Reveal } from './Reveal.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('Reveal', () => {
  it('renders nothing while closed', () => {
    expect(html(<Reveal open={false}>hidden</Reveal>)).toBe('')
  })

  it('mounts the region, clip, and content when open', () => {
    const out = html(<Reveal open>shown</Reveal>)
    expect(out).toContain('class="xeno-reveal"')
    expect(out).toContain('xeno-reveal-clip')
    expect(out).toContain('xeno-reveal-content')
    expect(out).toContain('shown')
  })

  it('spreads panelProps onto the panel and honours align=end', () => {
    const out = html(
      <Reveal open align="end" panelProps={{ id: 'p1', role: 'dialog' }}>
        x
      </Reveal>,
    )
    expect(out).toContain('id="p1"')
    expect(out).toContain('role="dialog"')
    expect(out).toContain('data-align="end"')
  })
})

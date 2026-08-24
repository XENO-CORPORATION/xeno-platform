import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Collapsible } from './Collapsible.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

/** Isolate the body's opening tag so its attributes can be asserted without the surrounding markup. */
const bodyTag = (h: string): string => h.match(/<div[^>]*class="xeno-collapsible-body"[^>]*>/)?.[0] ?? ''

describe('Collapsible', () => {
  it('renders the summary row: lightbulb glyph, label, and a chevron glyph', () => {
    const out = html(<Collapsible summary="Thoughts">reasoning…</Collapsible>)
    expect(out).toContain('class="xeno-collapsible"')
    expect(out).toContain('class="xeno-collapsible-summary"')
    expect(out).toContain('class="xeno-collapsible-label"')
    expect(out).toContain('Thoughts')
    // two glyphs drawn by <XenoElement>: the icon and the chevron
    expect(out.match(/<svg/g)?.length).toBe(2)
  })

  it('is collapsed by default: aria-expanded=false, body hidden, no data-open seam', () => {
    const out = html(<Collapsible summary="Thoughts">reasoning…</Collapsible>)
    expect(out).toContain('aria-expanded="false"')
    expect(out).not.toContain('data-open')
    expect(bodyTag(out)).toContain('hidden')
  })

  it('honours defaultOpen: aria-expanded=true, data-open seam, body visible', () => {
    const out = html(
      <Collapsible summary="Thoughts" defaultOpen>
        reasoning…
      </Collapsible>,
    )
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('data-open=""')
    expect(bodyTag(out)).not.toContain('hidden')
    expect(out).toContain('reasoning…')
  })

  it('is controllable via open (overrides defaultOpen)', () => {
    expect(html(<Collapsible summary="s" open>b</Collapsible>)).toContain('aria-expanded="true"')
    expect(html(<Collapsible summary="s" open={false} defaultOpen>b</Collapsible>)).toContain(
      'aria-expanded="false"',
    )
  })

  it('wires aria-controls on the button to the body id, and aria-labelledby back to the label', () => {
    const out = html(
      <Collapsible summary="Thoughts" defaultOpen>
        b
      </Collapsible>,
    )
    const controls = out.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls).toBeTruthy()
    expect(out).toContain(`id="${controls}"`)
    const labelledby = out.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledby).toBeTruthy()
    expect(out).toContain(`id="${labelledby}"`)
  })
})

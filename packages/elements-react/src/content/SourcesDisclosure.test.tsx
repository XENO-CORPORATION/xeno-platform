import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { SourcesDisclosure, type SourceRef } from './SourcesDisclosure.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

/** Isolate the panel's opening tag so its attributes can be asserted without the surrounding markup. */
const panelTag = (h: string): string => h.match(/<div[^>]*class="xeno-sources-panel"[^>]*>/)?.[0] ?? ''

const sources: readonly SourceRef[] = [
  { title: 'A', domain: 'a.com', href: 'https://a.com', favicon: 'https://cdn.example/a.png' },
  { title: 'B', domain: 'b.org', href: 'https://b.org' },
  { title: 'C', domain: 'c.net', href: 'https://c.net', snippet: 'about c' },
  { title: 'D', domain: 'd.io' },
  { title: 'E', domain: 'e.dev' },
  { title: 'F', domain: 'f.ai' },
]

describe('SourcesDisclosure', () => {
  it('renders a borderless header, the Sources label, the chevron glyph, and a mono count', () => {
    const out = html(<SourcesDisclosure sources={sources} />)
    expect(out).toContain('class="xeno-sources"')
    expect(out).toContain('class="xeno-sources-header"')
    expect(out).toContain('class="xeno-sources-label"')
    expect(out).toContain('Sources')
    expect(out).toContain('<svg') // chevron drawn by <XenoElement>
    expect(out).toContain('class="xeno-sources-count"')
    expect(out).toContain('>6<') // one count per source
  })

  it('is collapsed by default: aria-expanded=false, panel hidden, chevron un-rotated', () => {
    const out = html(<SourcesDisclosure sources={sources} />)
    expect(out).toContain('aria-expanded="false"')
    expect(out).not.toContain('data-open')
    expect(panelTag(out)).toContain('hidden')
  })

  it('honours defaultOpen: aria-expanded=true, data-open seam, panel visible with SourceCard rows', () => {
    const out = html(<SourcesDisclosure sources={sources} defaultOpen />)
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('data-open=""')
    expect(panelTag(out)).not.toContain('hidden')
    expect(out).toContain('class="xeno-source-card"')
  })

  it('is controllable via open', () => {
    expect(html(<SourcesDisclosure sources={sources} open />)).toContain('aria-expanded="true"')
    expect(html(<SourcesDisclosure sources={sources} open={false} />)).toContain('aria-expanded="false"')
  })

  it('stacks favicons and collapses the rest into a +N overflow tile', () => {
    const out = html(<SourcesDisclosure sources={sources} />)
    // default maxAvatars = 4 → 6 sources leaves +2
    expect(out).toContain('xeno-sources-overflow')
    expect(out).toContain('+2')
    // the first source has a favicon → an <img> in the stack
    expect(out).toContain('src="https://cdn.example/a.png"')
    // a source without a favicon → an initial in the stack
    expect(out).toContain('class="xeno-sources-avatar"')
  })

  it('respects a custom maxAvatars (no overflow when it covers every source)', () => {
    const out = html(<SourcesDisclosure sources={sources} maxAvatars={6} />)
    expect(out).not.toContain('xeno-sources-overflow')
  })

  it('wires aria-controls on the header to the panel id', () => {
    const out = html(<SourcesDisclosure sources={sources} defaultOpen />)
    const controls = out.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls).toBeTruthy()
    expect(out).toContain(`id="${controls}"`)
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { renderSvg } from '@xenosystem/generate'
import Menu from '../../elements/src/elements/menu'
import Image from '../../elements/src/elements/image'
import Search from '../../elements/src/elements/search'
import Bookmark from '../../elements/src/elements/bookmark'
import { XenoElement } from './XenoElement.js'

/** Normalise the DRAWN shapes (rect/path) of an SVG string: tag + sorted attrs, ignoring self-closing
 * style and attribute order. The root differs by design (React adds class + data-xeno-element), so
 * parity is asserted on geometry only. */
const shapes = (svg: string): string[] => {
  const out: string[] = []
  const tag = /<(rect|path)\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = tag.exec(svg)) !== null) {
    const attrs: string[] = []
    const attr = /([\w-]+)="([^"]*)"/g
    let a: RegExpExecArray | null
    while ((a = attr.exec(m[2] as string)) !== null) attrs.push(`${a[1]}="${a[2]}"`)
    out.push(`${m[1]}|${attrs.sort().join(' ')}`)
  }
  return out
}

describe('XenoElement — cross-renderer parity with renderSvg (SPEC §6)', () => {
  const cases = [
    { name: 'menu', el: <XenoElement decl={Menu} />, svg: renderSvg(Menu) },
    { name: 'image', el: <XenoElement decl={Image} />, svg: renderSvg(Image) },
    { name: 'search', el: <XenoElement decl={Search} />, svg: renderSvg(Search) },
    { name: 'bookmark:off', el: <XenoElement decl={Bookmark} />, svg: renderSvg(Bookmark) },
    {
      name: 'bookmark:on',
      el: <XenoElement decl={Bookmark} state={{ selection: 'on' }} />,
      svg: renderSvg(Bookmark, { state: { selection: 'on' } }),
    },
  ]
  for (const c of cases) {
    it(`${c.name} draws the same shapes in React and in the serializer`, () => {
      expect(shapes(renderToStaticMarkup(c.el))).toEqual(shapes(c.svg))
    })
  }
})

describe('XenoElement — axis proof from pure data', () => {
  it('a degenerate icon carries the marker + base class but no axis attribute', () => {
    const html = renderToStaticMarkup(<XenoElement decl={Menu} />)
    expect(html).toContain('data-xeno-element=""')
    expect(html).toContain('class="xeno-element"')
    expect(html).toContain('data-glyph="menu"') // the animated-icon hook
    expect(html).not.toContain('data-selection')
    expect(html).not.toContain('data-availability')
    // three solid bars
    expect(html.match(/fill="currentColor"/g)).toHaveLength(3)
  })

  it('bookmark honours the selection axis: off = outline, on = filled', () => {
    const off = renderToStaticMarkup(<XenoElement decl={Bookmark} />)
    const on = renderToStaticMarkup(<XenoElement decl={Bookmark} state={{ selection: 'on' }} />)

    expect(off).toContain('data-selection="off"')
    expect(on).toContain('data-selection="on"')
    expect(off).not.toContain('fill="currentColor"') // stroked outline
    expect(on).toContain('fill="currentColor"') // same silhouette, solid
  })

  it('search carries fill-rule through to the DOM', () => {
    expect(renderToStaticMarkup(<XenoElement decl={Search} />)).toContain('fill-rule="evenodd"')
  })
})

describe('XenoElement — render options', () => {
  it('honours size and stroke-width overrides', () => {
    const html = renderToStaticMarkup(<XenoElement decl={Menu} size={32} strokeWidth={2} />)
    expect(html).toContain('width="32"')
    expect(html).toContain('height="32"')
    expect(html).toContain('stroke-width="2"')
  })

  it('keeps the base class and appends a custom one', () => {
    const html = renderToStaticMarkup(<XenoElement decl={Menu} className="nav-icon" />)
    expect(html).toContain('class="xeno-element nav-icon"')
  })
})

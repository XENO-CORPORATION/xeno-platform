import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import File from '../../../elements/src/elements/file'
import { Tile } from './Tile.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Tile', () => {
  it('centres a glyph in a square surface tile at the default 32px edge', () => {
    const out = html(<Tile icon={File} />)
    expect(out).toContain('class="xeno-tile"')
    expect(out).toContain('--xeno-tile-size:32px')
    expect(out).toContain('<svg')
    expect(out).toContain('aria-label="File"')
    expect(out).toContain('width="16"') // default glyph = round(32 * 0.5)
  })

  it('scales the glyph down for a 24px tile', () => {
    const out = html(<Tile icon={File} size={24} />)
    expect(out).toContain('--xeno-tile-size:24px')
    expect(out).toContain('width="12"')
  })

  it('honours an explicit glyphSize override', () => {
    expect(html(<Tile icon={File} size={32} glyphSize={18} />)).toContain('width="18"')
  })
})

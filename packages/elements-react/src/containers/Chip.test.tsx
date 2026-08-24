import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Bookmark from '../../../elements/src/elements/bookmark'
import { Chip } from './Chip.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Chip', () => {
  it('renders a labelled token, off + enabled at md metrics by default', () => {
    const out = html(<Chip>Design</Chip>)
    expect(out).toContain('class="xeno-chip"')
    expect(out).toContain('data-selection="off"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('data-xeno-size="md"') // md
    expect(out).toContain('class="xeno-chip-label"')
    expect(out).toContain('Design')
  })

  it('reflects presentational selection through the selection axis', () => {
    expect(html(<Chip selected>On</Chip>)).toContain('data-selection="on"')
    expect(html(<Chip selected={false}>Off</Chip>)).toContain('data-selection="off"')
  })

  it('composes a leading glyph via the shared renderer', () => {
    const out = html(<Chip leadingIcon={Bookmark}>Saved</Chip>)
    expect(out).toContain('<svg')
    expect(out).toContain('aria-label="Bookmark"')
    expect(out).toContain('width="16"') // md icon px
  })

  it('renders a remove affordance drawn from the x glyph when onRemove is set', () => {
    const out = html(<Chip onRemove={() => {}}>Tag</Chip>)
    expect(out).toContain('data-removable="true"')
    expect(out).toContain('xeno-chip-remove')
    expect(out).toContain('aria-label="Remove"')
    expect(out).toContain('aria-label="Close"') // the x decl's own label
  })

  it('becomes a controlled toggle (aria-pressed) when onSelectedChange is set', () => {
    const out = html(
      <Chip selected onSelectedChange={() => {}}>
        Filter
      </Chip>,
    )
    expect(out).toContain('xeno-chip-select')
    expect(out).toContain('aria-pressed="true"')
    expect(html(<Chip onSelectedChange={() => {}}>Filter</Chip>)).toContain('aria-pressed="false"')
  })

  it('emits smaller metrics at size sm', () => {
    expect(html(<Chip size="sm">x</Chip>)).toContain('data-xeno-size="sm"')
  })

  it('maps disabled to the availability axis', () => {
    expect(html(<Chip disabled>x</Chip>)).toContain('data-availability="disabled"')
  })
})

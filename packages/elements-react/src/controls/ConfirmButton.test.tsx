import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Copy from '../../../elements/src/elements/copy'
import { ConfirmButton } from './ConfirmButton.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('ConfirmButton', () => {
  it('renders as an icon button showing the resting glyph + label (not confirmed)', () => {
    const out = html(<ConfirmButton icon={Copy} aria-label="Copy" />)
    expect(out).toContain('xeno-icon-btn')
    expect(out).toContain('aria-label="Copy"')
    expect(out).toContain('<svg') // the resting glyph
    expect(out).not.toContain('data-confirmed')
  })
})

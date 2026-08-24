import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Modal, Sheet } from './Modal.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => {}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    expect(html(<Modal open={false} onClose={noop} title="Hidden" />)).toBe('')
  })

  it('is a center dialog: scrim + card, role and aria-modal, default variant', () => {
    const out = html(
      <Modal open onClose={noop} title="Delete project">
        Body copy
      </Modal>,
    )
    expect(out).toContain('class="xeno-modal-overlay"')
    expect(out).toContain('xeno-modal')
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('data-variant="center"')
    expect(out).toContain('Body copy')
    expect(out).toContain('tabindex="-1"')
  })

  it('labels the dialog from its title (aria-labelledby matches the heading id)', () => {
    const out = html(
      <Modal open onClose={noop} title="Confirm">
        x
      </Modal>,
    )
    expect(out).toContain('<h2')
    expect(out).toContain('Confirm')
    const labelledby = out.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledby).toBeTruthy()
    expect(out).toContain(`id="${labelledby}"`)
  })

  it('has no title heading and forwards a consumer aria-label when title is omitted', () => {
    const out = html(
      <Modal open onClose={noop} aria-label="Options">
        x
      </Modal>,
    )
    expect(out).not.toContain('<h2')
    expect(out).not.toContain('aria-labelledby')
    expect(out).toContain('aria-label="Options"')
  })

  it('renders the header close button (x glyph) with a labelled control', () => {
    const out = html(
      <Modal open onClose={noop} title="Confirm" closeLabel="Dismiss">
        x
      </Modal>,
    )
    expect(out).toContain('xeno-modal-close') // IconButton composes it after its base classes
    expect(out).toContain('aria-label="Dismiss"')
    expect(out).toContain('<svg') // the x glyph, drawn by <XenoElement>
  })

  it('renders a footer only when provided', () => {
    const bare = html(
      <Modal open onClose={noop} title="No footer">
        x
      </Modal>,
    )
    expect(bare).not.toContain('xeno-modal-footer')
    const withFooter = html(
      <Modal open onClose={noop} title="With footer" footer={<button>OK</button>}>
        x
      </Modal>,
    )
    expect(withFooter).toContain('class="xeno-modal-footer"')
    expect(withFooter).toContain('OK')
  })

  it('sheet variant tags the scrim and card', () => {
    const out = html(
      <Modal open onClose={noop} variant="sheet" title="Sheet">
        x
      </Modal>,
    )
    const variants = out.match(/data-variant="sheet"/g) ?? []
    expect(variants.length).toBe(2) // scrim + card
  })
})

describe('Sheet', () => {
  it('is Modal pinned to the sheet variant', () => {
    const out = html(
      <Sheet open onClose={noop} title="Quick settings">
        x
      </Sheet>,
    )
    expect(out).toContain('role="dialog"')
    expect(out).toContain('data-variant="sheet"')
    expect(out).toContain('Quick settings')
  })

  it('renders nothing when closed', () => {
    expect(html(<Sheet open={false} onClose={noop} title="Hidden" />)).toBe('')
  })
})

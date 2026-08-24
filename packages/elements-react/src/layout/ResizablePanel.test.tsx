import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ResizablePanel } from './ResizablePanel.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('ResizablePanel', () => {
  it('renders the root, a sized panel body, and a separator handle', () => {
    const out = html(<ResizablePanel>Body</ResizablePanel>)
    expect(out).toContain('class="xeno-resizable"')
    expect(out).toContain('class="xeno-resizable-panel"')
    expect(out).toContain('class="xeno-resizable-handle"')
    expect(out).toContain('role="separator"')
    expect(out).toContain('aria-orientation="vertical"')
    expect(out).toContain('Body')
  })

  it('defaults to the right edge and the default size', () => {
    const out = html(<ResizablePanel>x</ResizablePanel>)
    expect(out).toContain('data-side="right"')
    expect(out).toContain('width:280px')
    expect(out).toContain('aria-valuenow="280"')
    // right handle is emitted AFTER the panel body
    expect(out.indexOf('xeno-resizable-panel')).toBeLessThan(out.indexOf('xeno-resizable-handle'))
  })

  it('places the handle before the body when side="left"', () => {
    const out = html(<ResizablePanel side="left">x</ResizablePanel>)
    expect(out).toContain('data-side="left"')
    expect(out.indexOf('xeno-resizable-handle')).toBeLessThan(out.indexOf('xeno-resizable-panel'))
  })

  it('honours a controlled size and exposes the value range on the handle', () => {
    const out = html(
      <ResizablePanel size={320} min={200} max={600}>
        x
      </ResizablePanel>,
    )
    expect(out).toContain('width:320px')
    expect(out).toContain('aria-valuenow="320"')
    expect(out).toContain('aria-valuemin="200"')
    expect(out).toContain('aria-valuemax="600"')
  })

  it('clamps a size beyond max down to max', () => {
    const out = html(
      <ResizablePanel size={9999} min={160} max={480}>
        x
      </ResizablePanel>,
    )
    expect(out).toContain('width:480px')
    expect(out).toContain('aria-valuenow="480"')
  })

  it('clamps a size below min up to min', () => {
    const out = html(
      <ResizablePanel size={10} min={160} max={480}>
        x
      </ResizablePanel>,
    )
    expect(out).toContain('width:160px')
  })

  it('reflects the disabled state on the root and removes the handle from the tab order', () => {
    const out = html(<ResizablePanel disabled>x</ResizablePanel>)
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('aria-disabled="true"')
    expect(out).toContain('tabindex="-1"')
  })

  it('is enabled and focusable by default', () => {
    const out = html(<ResizablePanel>x</ResizablePanel>)
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('tabindex="0"')
    expect(out).toContain('data-dragging="false"')
  })

  it('uses a custom accessible label for the handle', () => {
    const out = html(<ResizablePanel handleLabel="Resize sidebar">x</ResizablePanel>)
    expect(out).toContain('aria-label="Resize sidebar"')
  })

  it('merges a custom className and forwards rest attributes', () => {
    const out = html(
      <ResizablePanel className="mine" data-testid="rp">
        x
      </ResizablePanel>,
    )
    expect(out).toContain('xeno-resizable mine')
    expect(out).toContain('data-testid="rp"')
  })

  it('links the handle to the panel it controls', () => {
    const out = html(<ResizablePanel>x</ResizablePanel>)
    const controls = out.match(/aria-controls="([^"]+)"/)
    expect(controls).not.toBeNull()
    const id = controls?.[1]
    expect(id).toBeTruthy()
    expect(out).toContain(`id="${id}"`)
  })
})

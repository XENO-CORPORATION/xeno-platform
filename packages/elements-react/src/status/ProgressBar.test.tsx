import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ProgressBar } from './ProgressBar.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('ProgressBar', () => {
  it('renders a progressbar track with the clamped value and width fill', () => {
    const out = html(<ProgressBar value={0.5} />)
    expect(out).toContain('class="xeno-progressbar"')
    expect(out).toContain('class="xeno-progressbar-track"')
    expect(out).toContain('class="xeno-progressbar-fill"')
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-valuenow="50"')
    expect(out).toContain('aria-valuemin="0"')
    expect(out).toContain('aria-valuemax="100"')
    expect(out).toContain('width:50%')
    // no label -> the default accessible name and no visible header
    expect(out).toContain('aria-label="Progress"')
    expect(out).not.toContain('xeno-progressbar-header')
  })

  it('clamps values outside the 0..1 range', () => {
    const over = html(<ProgressBar value={1.5} />)
    expect(over).toContain('aria-valuenow="100"')
    expect(over).toContain('width:100%')

    const under = html(<ProgressBar value={-2} />)
    expect(under).toContain('aria-valuenow="0"')
    expect(under).toContain('width:0%')
  })

  it('reads a non-finite value as zero', () => {
    expect(html(<ProgressBar value={Number.NaN} />)).toContain('aria-valuenow="0"')
  })

  it('renders an aria-hidden header with the label + percent when labelled', () => {
    const out = html(<ProgressBar value={0.42} label="Uploading" />)
    expect(out).toContain('class="xeno-progressbar-header"')
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('class="xeno-progressbar-label"')
    expect(out).toContain('Uploading')
    expect(out).toContain('>42%<')
    // the label also names the progressbar
    expect(out).toContain('aria-label="Uploading"')
  })

  it('merges a custom className and forwards rest props', () => {
    const out = html(<ProgressBar value={0.3} className="mine" id="p1" />)
    expect(out).toContain('xeno-progressbar mine')
    expect(out).toContain('id="p1"')
  })

  it('value={null} is indeterminate — no position is claimed anywhere', () => {
    const out = html(<ProgressBar value={null} label="Indexing" />)
    expect(out).toContain('data-state="indeterminate"')
    // Omitting aria-valuenow is the ARIA spelling of "busy, extent unknown". Reporting 0 would be a
    // claim that the work measurably has not started.
    expect(out).not.toContain('aria-valuenow')
    // ...and the fill must not carry a width either, or the sweep would be laid out over a stale one.
    expect(out).not.toContain('width:')
    // The readout has to agree with the bar about what is unknown.
    expect(out).toContain('>—<')
    expect(out).not.toContain('>0%<')
  })

  it('a determinate bar still declares its state', () => {
    expect(html(<ProgressBar value={0.5} />)).toContain('data-state="determinate"')
  })
})

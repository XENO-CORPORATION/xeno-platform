import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Terminal from '../../../elements/src/elements/terminal'
import { ModelPicker, type ModelOption } from './ModelPicker.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

const OPTIONS: ModelOption[] = [
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
  { id: 'o3-mini', label: 'o3-mini', provider: 'OpenAI' },
  { id: 'opus-4', label: 'Claude Opus 4', provider: 'Anthropic' },
  { id: 'local', label: 'Local Llama' },
]

describe('ModelPicker — trigger', () => {
  it('renders a closed listbox trigger showing the selected model', () => {
    const out = html(<ModelPicker options={OPTIONS} value="opus-4" />)
    expect(out).toContain('class="xeno-model-picker"')
    expect(out).toContain('data-layout="tray"')
    expect(out).toContain('data-open="false"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('aria-haspopup="listbox"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('Claude Opus 4')
    // closed → no panel
    expect(out).not.toContain('role="listbox"')
  })

  it('falls back to the placeholder when value matches no option', () => {
    const out = html(<ModelPicker options={OPTIONS} value="does-not-exist" placeholder="Pick one" />)
    expect(out).toContain('xeno-mp-placeholder')
    expect(out).toContain('Pick one')
  })

  it('maps disabled to the availability axis on root and trigger', () => {
    const out = html(<ModelPicker options={OPTIONS} value="gpt-4o" disabled />)
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('disabled')
  })

  it('accepts a custom trigger glyph', () => {
    const out = html(<ModelPicker options={OPTIONS} value="gpt-4o" triggerIcon={Terminal} />)
    expect(out).toContain('aria-label="Terminal"')
  })
})

describe('ModelPicker — tray panel (controlled open)', () => {
  const out = html(<ModelPicker options={OPTIONS} value="opus-4" open label="Model" />)

  it('renders a listbox with grouped, selectable options', () => {
    expect(out).toContain('data-open="true"')
    expect(out).toContain('xeno-mp-panel--tray')
    expect(out).toContain('role="listbox"')
    expect(out).toContain('aria-label="Model"')
    expect(out).toContain('role="option"')
    expect(out).toContain('role="group"')
  })

  it('renders provider group headers', () => {
    expect(out).toContain('class="xeno-mp-group-label"')
    expect(out).toContain('OpenAI')
    expect(out).toContain('Anthropic')
  })

  it('marks the selected option and only it', () => {
    expect(out).toContain('aria-selected="true"')
    // the selected row carries a check glyph
    expect(out).toContain('aria-label="Check"')
    // both selection states are present across the option list
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('data-selection="off"')
  })

  it('drives the active descendant', () => {
    expect(out).toContain('aria-activedescendant=')
    expect(out).toContain('data-active="true"')
  })
})

describe('ModelPicker — rail panel (controlled open)', () => {
  const out = html(<ModelPicker options={OPTIONS} value="o3-mini" layout="rail" open />)

  it('renders a horizontal listbox of chips with fade edges', () => {
    expect(out).toContain('data-layout="rail"')
    expect(out).toContain('xeno-mp-panel--rail')
    expect(out).toContain('aria-orientation="horizontal"')
    expect(out).toContain('class="xeno-mp-rail-viewport"')
    expect(out).toContain('class="xeno-mp-chip"')
  })

  it('shows the provider eyebrow and marks the selected chip', () => {
    expect(out).toContain('class="xeno-mp-chip-provider"')
    expect(out).toContain('class="xeno-mp-chip-label"')
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('xeno-mp-chip-check')
  })
})

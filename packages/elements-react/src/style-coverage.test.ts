import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * Chrome coverage — the gate that stops the axis rotting one component at a time.
 *
 * Everything a construction decides must be READ from `--xeno-style-*`. A literal typed into a
 * component stylesheet is invisible in review, invisible to every component test (a single-chrome
 * fixture renders correctly either way), and changes BOTH constructions at once. That is not
 * hypothetical: seven values leaked exactly like that in one pass and silently altered the look that
 * was supposed to be preserved untouched.
 *
 * The playbook's three properties, all present:
 *  · a FLOOR — a wrong path would otherwise scan an empty list and pass over nothing;
 *  · a REASONED allowlist, asserted to still be needed rather than left as stale permission;
 *  · a mutation check, run by hand: reintroduce a literal radius in `menu.css` and this fails.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))
const read = (p: string): string => readFileSync(`${SRC}${p}`, 'utf8')

/** Every stylesheet in the package, recursively — derived, never hand-listed. */
const stylesheets = (dir = ''): string[] =>
  readdirSync(`${SRC}${dir}`, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? stylesheets(`${dir}${e.name}/`)
      : e.name.endsWith('.css')
        ? [`${dir}${e.name}`]
        : [],
  )

/**
 * Components that carry app CHROME — the ones whose construction differs between Industrial and
 * Soft, so each must read the axis.
 */
const CHROME = [
  'containers/panel.css',
  'containers/card.css',
  'overlays/modal.css',
  'overlays/menu.css',
  'overlays/tooltip.css',
  'overlays/segmented-control.css',
  'overlays/pill-filter.css',
  'overlays/picker-field.css',
  'overlays/date-time-picker.css',
  'content/code-block.css',
  'content/model-picker.css',
  'content/source-card.css',
  'content/inline-code.css',
  'nav/sidebar.css',
]

/**
 * NOT chrome, and each line is a reason rather than an exemption.
 *
 * The playbook's scope line is "Not document content", and `DESIGN_SYSTEM.md` §2 separates content
 * containers that RECESS below the page from app chrome that sits above it. A content card that
 * changed shape with the chrome would be pretending to be a dialog.
 */
const NOT_CHROME: Record<string, string> = {
  'containers/tile.css': 'content — a tile is a thumbnail of the user’s own material',
  'containers/avatar.css': 'content — identity, and its shape is fixed by DESIGN_SYSTEM §3',
  'containers/message-bubble.css': 'content — the conversation is the document',
  'containers/Badges.css': 'content — a status mark reads the same in any chrome',
  'containers/list-row.css': 'content — rows carry data; their chrome is the panel around them',
}

describe('chrome coverage', () => {
  it('scans a real set of stylesheets (floor)', () => {
    // A wrong SRC would make every assertion below vacuous. This is the tripwire for that.
    expect(stylesheets().length).toBeGreaterThan(30)
  })

  it.each(CHROME)('%s reads the chrome axis', (file) => {
    expect(read(file)).toMatch(/var\(--xeno-style-/)
  })

  it('no chrome component hardcodes a drop shadow', () => {
    // A shadow is a construction decision — `separated` casts none. A literal here pins one look.
    const offenders = CHROME.filter((f) => /box-shadow:\s*[^;]*rgba?\(/.test(read(f)))
    expect(offenders).toEqual([])
  })

  /*
   * ⚠️ This assertion exists because the FIRST version of this suite was decoration.
   *
   * It only checked that a chrome component references SOME `--xeno-style-*` token, and a component
   * that reads the axis in one rule can hardcode a construction value in the next. Proven: putting
   * `border-radius: 12px` back into `menu.css` left every assertion green.
   *
   * A literal `border-radius: 0` is legitimate and stays allowed — it is how §4's per-corner rule
   * squares the faces a plate presents to its neighbour.
   */
  it('no chrome component hardcodes a radius in px', () => {
    const offenders = CHROME.filter((f) => /border-radius:[^;]*\d+px/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('every allowlisted file exists and is still genuinely not chrome', () => {
    // Stale permission is how a gate quietly re-opens the door: a file that no longer needs an
    // exemption, or no longer exists, must not keep one.
    const all = stylesheets()
    for (const [file, why] of Object.entries(NOT_CHROME)) {
      expect(all, `${file} is allowlisted but does not exist`).toContain(file)
      expect(why.length, `${file} needs a real reason`).toBeGreaterThan(20)
      expect(read(file), `${file} reads the axis — it is chrome, move it`).not.toMatch(
        /var\(--xeno-style-/,
      )
    }
  })
})

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useId, useRef } from 'react'

/**
 * `useTabs()` — everything a tablist has to DO, for a tablist this library did not build.
 *
 * Arrow keys move between tabs, one Tab key press leaves the whole set, each tab names the panel it
 * controls and the panel names the tab that labels it. None of that is visual, and all of it is what
 * separates a row of tabs from a row of buttons that happen to sit next to each other.
 *
 * It exists for the same reason {@link useDialog} does, and the evidence is the same shape. Measured on
 * one product's chat: FIVE tablists, and they disagreed with each other.
 *
 * - one had roving `tabIndex` and arrow keys, and pointed at no panel
 * - three had neither — every tab was a Tab stop, so getting past a seven-section settings header meant
 *   seven presses, and the arrow keys did nothing at all
 * - one had a `role="tabpanel"` and nothing tying it to the tab that opened it
 *
 * None of them was wrong on purpose. The behaviour is just long enough that it gets written once,
 * properly, and then the next tablist is copied from the markup rather than from the working one.
 *
 * ```tsx
 * const tabs = useTabs({ ids: SECTIONS.map((s) => s.id), activeId: section, onChange: setSection })
 * return (
 *   <>
 *     <div {...tabs.tablistProps} aria-label="Settings sections">
 *       {SECTIONS.map((s) => <button key={s.id} {...tabs.tabProps(s.id)}>{s.label}</button>)}
 *     </div>
 *     <div {...tabs.panelProps}>…</div>
 *   </>
 * )
 * ```
 */
export interface UseTabsOptions<Id extends string> {
  /** Every tab, in the order they are rendered. Arrow keys walk this array. */
  readonly ids: readonly Id[]
  /** The selected tab. */
  readonly activeId: Id
  /** Called with the tab the user moved to. */
  readonly onChange: (id: Id) => void
  /**
   * Which arrow keys walk the list. `horizontal` (default) is Left/Right; `vertical` is Up/Down.
   * A vertical tablist must also say so to assistive technology, and `tablistProps` sets
   * `aria-orientation` to match.
   */
  readonly orientation?: 'horizontal' | 'vertical'
  /**
   * Wrap from the last tab to the first. Default `true` — a tab strip is a ring, and stopping dead at
   * the end is a behaviour people notice only as the control feeling stuck.
   */
  readonly wrap?: boolean
  /**
   * Share one panel between two tablists.
   *
   * Normally the hook mints the panel's id and nobody has to know it. The case that needs this is a
   * RESPONSIVE duplicate: the same sections rendered twice, once for wide screens and once for narrow,
   * with CSS hiding one — both are in the document, and both must point at the single panel below them.
   * Two hook instances would otherwise each invent an id and each claim to own the panel.
   *
   * Pass the same string to both; give the panel to whichever instance you like. The tab ids stay
   * distinct either way, because those still come from `useId`.
   */
  readonly panelId?: string
}

export interface UseTabsResult<Id extends string> {
  /** Spread on the element that holds the tabs. */
  readonly tablistProps: {
    readonly role: 'tablist'
    readonly 'aria-orientation': 'horizontal' | 'vertical'
    readonly onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
  }
  /** Spread on each tab. Pass the same id you passed in `ids`. */
  readonly tabProps: (id: Id) => {
    readonly role: 'tab'
    readonly id: string
    readonly 'aria-selected': boolean
    readonly 'aria-controls': string
    readonly tabIndex: 0 | -1
    readonly ref: (node: HTMLElement | null) => void
  }
  /** Spread on the panel the active tab controls. */
  readonly panelProps: {
    readonly role: 'tabpanel'
    readonly id: string
    readonly 'aria-labelledby': string
    /** So a panel that scrolls can be reached and scrolled from the keyboard. */
    readonly tabIndex: 0
  }
}

export function useTabs<Id extends string>({
  ids,
  activeId,
  onChange,
  orientation = 'horizontal',
  wrap = true,
  panelId: givenPanelId,
}: UseTabsOptions<Id>): UseTabsResult<Id> {
  /* One id per hook instance, so two tablists on the same screen — a settings modal over a settings
     page is the ordinary case — cannot both claim `#tab-general`. Duplicate ids do not throw; they
     make `aria-controls` resolve to whichever came first, which is a bug with no symptom until
     someone is using a screen reader. */
  const uid = useId()
  const tabId = useCallback((id: Id) => `${uid}tab-${id}`, [uid])
  /* ONE panel id, not one per tab. Every tablist this was written for has a single panel element whose
     CONTENTS swap — a settings page with one scroll container, a modal with one body — rather than N
     panels of which N-1 are hidden. So every tab controls that one element, and the panel names the tab
     currently labelling it. Minting an id per tab would describe a structure that is not there. */
  const panelId = givenPanelId ?? `${uid}panel`

  /* The tabs, by id, so the hook can move focus without going through the document. `querySelector`
     works and is what hand-rolled versions reach for; it also finds a tab from a DIFFERENT tablist
     when both are open, because the selector it can write has nothing to scope by. */
  const nodes = useRef(new Map<Id, HTMLElement>())
  /* Ref callbacks memoised PER ID. Returning a fresh closure from `tabProps` would give React a new ref
     identity on every render, which it answers by calling the old one with null and the new one with
     the node — every render, for every tab. Harmless and pointless; the map costs one lookup. */
  const refs = useRef(new Map<Id, (node: HTMLElement | null) => void>())
  const setNode = useCallback((id: Id) => {
    let fn = refs.current.get(id)
    if (!fn) {
      fn = (node: HTMLElement | null) => {
        if (node) nodes.current.set(id, node)
        else nodes.current.delete(id)
      }
      refs.current.set(id, fn)
    }
    return fn
  }, [])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>): void => {
      const [prev, next] =
        orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
      const at = ids.indexOf(activeId)
      if (at < 0) return

      let to: number | null = null
      if (e.key === next) to = at + 1
      else if (e.key === prev) to = at - 1
      else if (e.key === 'Home') to = 0
      else if (e.key === 'End') to = ids.length - 1
      if (to === null) return

      if (to < 0 || to >= ids.length) {
        if (!wrap) return
        to = (to + ids.length) % ids.length
      }
      const target = ids[to]
      if (target === undefined || target === activeId) return

      e.preventDefault()
      onChange(target)

      /* Focus AFTER the change has painted. Selection follows focus here — the ARIA pattern calls it
         automatic activation, and it is right for tabs whose panels are already rendered — which means
         the tab we want to focus is about to become the only one with `tabIndex: 0`. Focusing it in
         this handler focuses the node as it is now, and React then re-renders and can replace it.

         Two frames, not one. A single `requestAnimationFrame` fires BEFORE the commit that React
         schedules in response to `onChange`, so on a slow section it lands on the old node. */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => nodes.current.get(target)?.focus())
      })
    },
    [ids, activeId, onChange, orientation, wrap],
  )

  const tabProps = useCallback(
    (id: Id) => ({
      role: 'tab' as const,
      id: tabId(id),
      'aria-selected': id === activeId,
      'aria-controls': panelId,
      /* Roving: exactly one tab is a Tab stop, and it is the selected one. Without this every tab is
         a stop, and a seven-section header costs seven presses to walk past — which is the difference
         between a control and an obstacle. */
      tabIndex: (id === activeId ? 0 : -1) as 0 | -1,
      ref: setNode(id),
    }),
    [activeId, tabId, panelId, setNode],
  )

  return {
    tablistProps: { role: 'tablist', 'aria-orientation': orientation, onKeyDown },
    tabProps,
    panelProps: {
      role: 'tabpanel',
      id: panelId,
      'aria-labelledby': tabId(activeId),
      tabIndex: 0,
    },
  }
}

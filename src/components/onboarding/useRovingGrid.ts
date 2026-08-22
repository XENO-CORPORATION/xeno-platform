import { useCallback, useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * ROVING TAB INDEX over a whole step.
 *
 * Arrows move a highlight, Space activates whatever is highlighted, Enter
 * continues. The step is ONE tab stop rather than a dozen.
 *
 * ── ITEMS ARE DISCOVERED, NOT DECLARED ─────────────────────────────────────
 *
 * An earlier version took a `count` and handed every item an index, a ref and
 * an onFocus through props. That worked for the card grid and could not reach
 * Continue or Back — they live in a different component, so including them
 * meant threading indices across a boundary and keeping two components
 * agreeing about how many things exist.
 *
 * Now the hook queries its container for `[data-roving]`. Anything inside can
 * join by adding one attribute, wherever it lives, and there is no count to
 * keep in sync — the DOM already knows. Adding a control to a step cannot
 * silently leave it unreachable.
 *
 * ── SPACE ACTIVATES, IT DOES NOT "CHOOSE" ──────────────────────────────────
 *
 * Space calls .click() on the focused element, so every item behaves exactly
 * as it does under a mouse: a card toggles, Continue continues, Back goes
 * back. No handler is duplicated for the keyboard, which is what stopped the
 * two routes drifting apart in the first place.
 *
 * ── ARROWS MOVE, THEY DO NOT SELECT ────────────────────────────────────────
 *
 * The ARIA pattern normally selects as you arrow. Here it must not: some of
 * these items ADVANCE THE STEP, so arrowing would fire the flow forward before
 * the user had seen the options. The spec allows manual selection precisely
 * when selection has side effects.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function useRovingGrid(onEnter?: () => void, resetKey?: unknown) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);
  // Focus only follows a KEYBOARD move; otherwise the step would steal focus
  // on mount and on every re-render.
  const shouldFocus = useRef(false);

  /* The highlight returns to the first item whenever the step changes.
   *
   * One grid serves every step, because only one step is mounted at a time and
   * each renders its cards and its Back/Continue inside the same wrapper. What
   * that shares is the ACTIVE INDEX — arrive at a 7-item step holding index 9
   * from a 10-item one and the clamp drops you onto Continue, so the step opens
   * with the highlight past all of its content. Clamping keeps it in range; only
   * a reset puts it back at the beginning. */
  useEffect(() => { setActive(0); }, [resetKey]);

  const items = useCallback((): HTMLElement[] => {
    const root = containerRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[data-roving]'))
      // A disabled Continue is not a place the highlight should be able to
      // rest — arrowing onto a dead control reads as the keys breaking.
      .filter((el) => !(el as HTMLButtonElement).disabled);
  }, []);

  /* One tab stop: only the active item is tabbable.
   *
   * Applied after every render because the item LIST changes — Continue
   * enables once something is chosen, and the everything-bar comes and goes.
   * A tabIndex assigned once would leave a stale item as the entry point. */
  useEffect(() => {
    const els = items();
    if (els.length === 0) return;
    const i = Math.min(active, els.length - 1);
    els.forEach((el, n) => { el.tabIndex = n === i ? 0 : -1; });
    if (shouldFocus.current) {
      shouldFocus.current = false;
      els[i]?.focus();
    }
  });

  /** Items per row, from the rendered layout — never from the breakpoints.
   *  Reading those back in JS would restate the grid in a second place. */
  const columns = useCallback((els: HTMLElement[]) => {
    if (els.length === 0) return 1;
    const top = els[0].offsetTop;
    return Math.max(1, els.filter((el) => el.offsetTop === top).length);
  }, []);

  const go = useCallback((next: number, els: HTMLElement[]) => {
    shouldFocus.current = true;
    setActive(Math.max(0, Math.min(els.length - 1, next)));
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const els = items();
    if (els.length === 0) return;
    const i = Math.min(active, els.length - 1);
    const cols = columns(els);

    switch (e.key) {
      case 'ArrowRight':
        // Wraps: a row's end and the next row's start are adjacent to the eye.
        e.preventDefault(); shouldFocus.current = true;
        setActive((i + 1) % els.length);
        break;
      case 'ArrowLeft':
        e.preventDefault(); shouldFocus.current = true;
        setActive((i - 1 + els.length) % els.length);
        break;
      case 'ArrowDown':
        // Clamps: wrapping vertically jumps the eye across the whole step.
        e.preventDefault(); go(i + cols, els);
        break;
      case 'ArrowUp':
        e.preventDefault(); go(i - cols, els);
        break;
      case 'Home': e.preventDefault(); go(0, els); break;
      case 'End': e.preventDefault(); go(els.length - 1, els); break;
      case ' ':
        /* preventDefault is required, not tidiness: these are <button>s, and
           Space natively fires a click on keyUP. Without it the item would
           activate TWICE — which on a toggle looks like nothing happening. */
        e.preventDefault();
        els[i]?.click();
        break;
      case 'Enter': {
        /* Enter CONTINUES from a choice, and ACTIVATES a navigation control.
         *
         * "Enter always continues" is simpler to describe and sets a trap:
         * arrow onto Back, press Enter, and the flow moves FORWARD. Pressing
         * Enter on a focused button activating that button is about as strong
         * an expectation as the keyboard has, and no legend overrides it.
         *
         * So the distinction is carried on the item itself. A card or the
         * everything bar is a CHOICE — Enter there means "done choosing", which
         * is the shortcut worth having. Back, Continue and Select plan are
         * ACTIONS, and Enter does exactly what it looks like it does. On
         * Continue the two rules agree, which is why the trap was easy to miss. */
        const el = els[i];
        if (el?.dataset.roving === 'action') {
          e.preventDefault();
          el.click();
          return;
        }
        if (!onEnter) return;
        e.preventDefault();
        onEnter();
        break;
      }
      default:
    }
  }, [active, columns, go, items, onEnter]);

  /* A first arrow claims the step without a Tab.
   *
   * A roving tabindex still requires REACHING the container before the arrows
   * mean anything — you press Right, nothing moves, and it looks broken before
   * it has been used. Once focus is inside, the container handler owns it, so
   * this only ever fires for the first press.
   *
   * Editable targets are left alone: arrows move a caret in a field and change
   * the value in a select. */
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (containerRef.current && el && containerRef.current.contains(el)) return;

      const els = items();
      if (els.length === 0) return;
      e.preventDefault();
      shouldFocus.current = true;
      els[Math.min(active, els.length - 1)]?.focus();
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [active, items]);

  /** Spread onto the element that CONTAINS every roving item. */
  const containerProps = {
    ref: (el: HTMLElement | null) => { containerRef.current = el; },
    onKeyDown,
  };

  return { containerProps };
}

/** Spread onto a CHOICE — a card, a toggle. Enter there means "done choosing". */
export const ROVING = { 'data-roving': '' } as const;

/** Spread onto an ACTION — Back, Continue, Select plan. Enter activates it. */
export const ROVING_ACTION = { 'data-roving': 'action' } as const;

export default useRovingGrid;

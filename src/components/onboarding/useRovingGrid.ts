import { useCallback, useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * ROVING TAB INDEX for a card grid.
 *
 * Arrow keys move a highlight between cards; Enter or Space chooses one. The
 * whole grid is ONE tab stop rather than eight, which is the actual point:
 * without it, tabbing through this flow means eight presses to cross a single
 * question, and a keyboard user pays that on every step.
 *
 * ── ARROWS MOVE, THEY DO NOT SELECT ────────────────────────────────────────
 *
 * The ARIA radiogroup pattern normally selects as you arrow. Here it must not:
 * choosing a role ADVANCES THE STEP, so arrowing would fire the flow forward
 * on the first keypress and the user would never see the other options. The
 * spec allows manual selection precisely when selection has side effects, and
 * this is that case.
 *
 * ── THE COLUMN COUNT IS MEASURED, NOT ASSUMED ──────────────────────────────
 *
 * Up and Down move by a row, so they need to know the row width — and the grid
 * is 4 columns on a wide screen, 2 on a laptop, 1 on a phone. Reading the
 * breakpoints back in JS would restate the layout in a second place and drift
 * the moment the CSS changes.
 *
 * Instead it counts how many items share the first item's `offsetTop`. That is
 * the row width by definition, whatever produced it, so this stays correct
 * through any grid change and any breakpoint nobody remembered to tell it
 * about.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function useRovingGrid(
  count: number,
  /** Space — toggles the focused item. */
  onChoose: (index: number) => void,
  /** Enter — the step's forward move. Optional: a grid on a step with no
   *  primary action simply ignores Enter rather than inventing one. */
  onEnter?: () => void,
) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const containerRef = useRef<HTMLElement | null>(null);
  // Focus only follows a KEYBOARD move. Without this the grid would steal
  // focus on mount and on every re-render, yanking it away from whatever the
  // user was actually doing.
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    refs.current[active]?.focus();
  }, [active]);

  /** Items per row, from the rendered layout. */
  const columns = useCallback(() => {
    const items = refs.current.filter(Boolean) as HTMLElement[];
    if (items.length === 0) return 1;
    const top = items[0].offsetTop;
    const n = items.filter((el) => el.offsetTop === top).length;
    return Math.max(1, n);
  }, []);

  const move = useCallback((next: number) => {
    shouldFocus.current = true;
    setActive(Math.max(0, Math.min(count - 1, next)));
  }, [count]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cols = columns();
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        // Wraps, because a row's end and the next row's start are adjacent to
        // the eye — stopping dead there feels like the grid is broken.
        shouldFocus.current = true;
        setActive((i) => (i + 1) % count);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        shouldFocus.current = true;
        setActive((i) => (i - 1 + count) % count);
        break;
      case 'ArrowDown':
        e.preventDefault();
        // Clamped, not wrapped: wrapping vertically jumps the eye across the
        // whole grid, which reads as a glitch rather than as navigation.
        move(active + cols);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(active - cols);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(count - 1);
        break;
      case ' ':
        /* SPACE selects. Enter does not — see below.
         *
         * preventDefault is required, not tidiness: these items are <button>s,
         * and Space on a button natively fires a click on keyUP. Without it the
         * item would toggle twice per press — once here, once natively — which
         * on a toggle means nothing appears to happen at all. */
        e.preventDefault();
        onChoose(active);
        break;
      case 'Enter':
        /* ENTER advances; it does not select.
         *
         * Splitting the two is what makes a multi-select grid usable from the
         * keyboard: Space to pick as many as you want, Enter when satisfied.
         * With both bound to select, there was no key left to move forward —
         * and on a single-select grid Enter silently did two things at once.
         *
         * preventDefault stops the native button click, which would otherwise
         * select the focused item on the way out of the step. */
        if (!onEnter) return;
        e.preventDefault();
        onEnter();
        break;
      default:
    }
  }, [active, columns, count, move, onChoose, onEnter]);

  /* ── ARROWS CLAIM THE GRID WITHOUT A TAB FIRST ───────────────────────────
   *
   * A roving tabindex still requires you to REACH the grid before the arrows
   * mean anything, and on a step whose entire content is the grid that first
   * Tab is a toll for no reason — you press Right, nothing moves, and the
   * feature looks broken before it has been used.
   *
   * So an arrow pressed while focus is OUTSIDE the grid pulls focus into it and
   * acts on that same keypress. From then on the container's own handler has
   * focus and takes over; this listener only ever fires for the FIRST arrow.
   *
   * ── WHAT IT REFUSES TO CLAIM ─────────────────────────────────────────────
   *
   * Arrows inside a text field move the caret, and inside a select they change
   * the value. Stealing them there would break typing on a step that has text
   * inputs one screen away — so an editable target is left completely alone.
   * ─────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;

      // Already inside: the container handler owns it, and running both would
      // move twice per press.
      if (containerRef.current && el && containerRef.current.contains(el)) return;

      const target = refs.current[active];
      if (!target) return;
      e.preventDefault();
      shouldFocus.current = true;
      target.focus();
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [active]);

  /** Props for item `i`. Only the active item is tabbable. */
  const itemProps = useCallback((i: number) => ({
    ref: (el: HTMLElement | null) => { refs.current[i] = el; },
    tabIndex: i === active ? 0 : -1,
    // A pointer user who clicks card 6 should then be able to arrow from card
    // 6, not from wherever the keyboard last was.
    onFocus: () => setActive(i),
  }), [active]);

  /** Props for the grid container — the ref is what lets the window listener
   *  tell "focus is already in here" from "focus is elsewhere". */
  const containerProps = {
    ref: (el: HTMLElement | null) => { containerRef.current = el; },
    onKeyDown,
  };

  return { active, onKeyDown, itemProps, containerProps };
}

export default useRovingGrid;

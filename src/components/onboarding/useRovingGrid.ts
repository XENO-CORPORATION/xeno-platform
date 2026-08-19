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

export function useRovingGrid(count: number, onChoose: (index: number) => void) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);
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
      case 'Enter':
      case ' ':
        // Selection is MANUAL — see the note above. Space is included because
        // a button natively answers to it, and losing that would make the grid
        // behave unlike every other control on the page.
        e.preventDefault();
        onChoose(active);
        break;
      default:
    }
  }, [active, columns, count, move, onChoose]);

  /** Props for item `i`. Only the active item is tabbable. */
  const itemProps = useCallback((i: number) => ({
    ref: (el: HTMLElement | null) => { refs.current[i] = el; },
    tabIndex: i === active ? 0 : -1,
    // A pointer user who clicks card 6 should then be able to arrow from card
    // 6, not from wherever the keyboard last was.
    onFocus: () => setActive(i),
  }), [active]);

  return { active, onKeyDown, itemProps };
}

export default useRovingGrid;

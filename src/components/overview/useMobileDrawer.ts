/**
 * The platform sidebar on a phone — an off-canvas DRAWER, and how it opens.
 *
 * On a small viewport the sidebar is fully out of the viewport so the surface underneath (the
 * chat, a project, a page) has the whole screen. It comes in from the left over a scrim:
 *
 *   HOLD-TAP  press and hold anywhere on the content for 500ms without moving (the ask, 2026-09-19)
 *   EDGE SWIPE  a right swipe that starts within 24px of the left edge — the gesture every mobile
 *               drawer answers to (Gmail, Slack, ChatGPT), so a thumb that expects it is not wrong
 *   BACK / ESC / SCRIM  close it. Opening pushes a history entry, so the device back button
 *               closes the drawer instead of leaving the page — the drawer is a modal layer.
 *
 * What a hold-tap must NOT steal: a press inside a text field, a button, a link, or a region
 * that is selecting text. Those already own the long press (context menus, selection handles);
 * the drawer only claims a hold on the surface itself. A hold that moved (scrolled) is not a
 * hold. A hold that ended with a text selection is a selection.
 *
 * Every listener here is passive and document-level; nothing re-renders while a finger is down.
 */
import { useEffect, useRef } from 'react';

export const MOBILE_DRAWER_QUERY = '(max-width: 760px)';
export const HOLD_MS = 500;
export const HOLD_SLOP_PX = 10;
export const EDGE_PX = 24;
export const SWIPE_PX = 56;

const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="button"], [role="textbox"], [role="slider"], [data-no-drawer-hold]';

/** True when a press here should NOT be read as a hold for the drawer. */
export function claimsItsOwnPress(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  return !!el.closest(INTERACTIVE);
}

/** The swipe rule, pure: a right swipe from the edge opens; a left swipe on the drawer closes. */
export function swipeDecision({ dx, dy, fromEdge, open, onDrawer }: { dx: number; dy: number; fromEdge: boolean; open: boolean; onDrawer: boolean }): 'open' | 'close' | null {
  const horizontal = Math.abs(dx) > SWIPE_PX && Math.abs(dy) < Math.abs(dx) * 0.6;
  if (!horizontal) return null;
  if (dx > 0 && fromEdge && !open) return 'open';
  if (dx < 0 && open && onDrawer) return 'close';
  return null;
}

export function useMobileDrawer({ open, onOpen, onClose, drawerRef }: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLElement | null>;
}) {
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  // hold-tap and edge swipe
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_DRAWER_QUERY);
    let holdTimer: number | null = null;
    let start: { x: number; y: number; id: number; edge: boolean } | null = null;
    const clearHold = () => { if (holdTimer !== null) { window.clearTimeout(holdTimer); holdTimer = null; } };

    const onDown = (event: PointerEvent) => {
      if (!mq.matches || event.pointerType === 'mouse' || !event.isPrimary) return;
      const insideDrawer = !!drawerRef.current && drawerRef.current.contains(event.target as Node);
      start = { x: event.clientX, y: event.clientY, id: event.pointerId, edge: event.clientX <= EDGE_PX };
      clearHold();
      if (openRef.current || insideDrawer || claimsItsOwnPress(event.target)) return;
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        // a hold that produced a text selection was a selection, not a summons
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        if (!openRef.current) onOpenRef.current();
      }, HOLD_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (Math.abs(event.clientX - start.x) > HOLD_SLOP_PX || Math.abs(event.clientY - start.y) > HOLD_SLOP_PX) clearHold();
    };
    const onUp = (event: PointerEvent) => {
      clearHold();
      if (!start || event.pointerId !== start.id) { start = null; return; }
      if (mq.matches) {
        const verdict = swipeDecision({
          dx: event.clientX - start.x, dy: event.clientY - start.y, fromEdge: start.edge,
          open: openRef.current, onDrawer: !!drawerRef.current?.contains(event.target as Node),
        });
        if (verdict === 'open') onOpenRef.current();
        else if (verdict === 'close') onCloseRef.current();
      }
      start = null;
    };
    const onCancel = () => { clearHold(); start = null; };
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointercancel', onCancel, { passive: true });
    // the browser's own long-press menu on the surface would race the hold; the drawer wins
    // only where it may claim the press (never on text fields, links, buttons)
    const onContextMenu = (event: MouseEvent) => {
      if (mq.matches && holdTimer !== null && !claimsItsOwnPress(event.target)) event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      clearHold();
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [drawerRef]);

  // while open: a history entry (Back closes), Escape closes, the page behind is inert, focus moves in
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.matchMedia?.(MOBILE_DRAWER_QUERY).matches) return;
    const token = `xeno-drawer-${Date.now()}`;
    let popped = false;
    try { window.history.pushState({ xenoDrawer: token }, ''); } catch { /* history optional */ }
    const onPop = () => { popped = true; onCloseRef.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelector<HTMLElement>('button, a, input, [tabindex]:not([tabindex="-1"])');
    focusable?.focus({ preventScroll: true });
    const shell = drawer?.closest('[data-overview-shell]');
    const siblings: Element[] = [];
    if (shell) for (const child of Array.from(shell.children)) if (!child.contains(drawer)) { child.setAttribute('inert', ''); siblings.push(child); }
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      for (const el of siblings) el.removeAttribute('inert');
      document.body.style.overflow = bodyOverflow;
      // closed by something other than Back: take our history entry back out
      if (!popped && window.history.state && window.history.state.xenoDrawer === token) {
        try { window.history.back(); } catch { /* history optional */ }
      }
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, drawerRef]);
}

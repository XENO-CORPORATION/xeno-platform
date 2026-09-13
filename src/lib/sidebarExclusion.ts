/**
 * One expanded sidebar at a time.
 *
 * ## The defect this exists to prevent, measured 2026-09-13
 *
 * The platform sidebar (`Overview.tsx` → `OverviewTaskbar`) expands from its 52px icon rail to
 * **300px**. The chat's history sidebar is `position: fixed`, portalled to `document.body`, and
 * positioned at `left: isTaskbarHidden ? 0 : TASKBAR_WIDTH_PX` — where `TASKBAR_WIDTH_PX` is
 * **52**, the COLLAPSED width, hardcoded. So with both open, the chat panel started 248px inside
 * the platform panel and painted over it: two expanded sidebars stacked, neither readable.
 *
 * The chat could not have known better. `Overview` publishes `isSidebarCollapsed` through
 * `LayoutContext`, and `ChatWithLLM` reads that context ZERO times; the only cross-surface signal
 * it does consume, `overview_taskbar_visibility`, carries *hidden or shown*, never *how wide*.
 * Two independent escape hatches existed and neither carried the one fact that mattered.
 *
 * ## Why a module rather than a prop
 *
 * The two panels have no common React ancestor that owns both: the chat sidebar is PORTALLED out
 * of the tree to `document.body`, so an ancestor's layout cannot contain it, and `ChatWithLLM` is
 * rendered through a `<Route>` several levels below the shell. Threading a prop would mean
 * plumbing through the router.
 *
 * More importantly, mutual exclusion is a RULE, and a rule implemented twice is a rule that
 * drifts. Both sides asking one module — "I am opening, close the other" — keeps it in one place,
 * and makes it testable without a DOM.
 *
 * ## The contract
 *
 * Exactly one panel may be expanded. Opening either collapses the other; the caller is told to
 * collapse via its own state setter, so each surface keeps ownership of its own rendering and
 * persistence. This module holds no DOM and no React state — it is a notice board.
 *
 * ⚠️ It deliberately does NOT force a panel open. Announcing an open closes the other one;
 * nothing here can open anything, because a module that could would need to know each surface's
 * preconditions (mobile, multi-interface, route) and that knowledge belongs at the call site.
 */

/** The panels that compete for the expanded slot. */
export type SidebarOwner = 'platform' | 'chat';

/** The event name is internal — every caller goes through the functions below. */
const CHANNEL = 'xeno_sidebar_expanded';

interface SidebarExpandedDetail {
  owner: SidebarOwner;
}

/**
 * Announce that `owner`'s panel is now expanded.
 *
 * Every OTHER registered owner is told to collapse. Safe to call when already expanded — the
 * listeners below ignore their own announcement, so a redundant call is a no-op rather than a
 * loop. That matters: both surfaces re-announce on mount, and a naive implementation would have
 * them close each other forever.
 */
export function announceSidebarExpanded(owner: SidebarOwner): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SidebarExpandedDetail>(CHANNEL, { detail: { owner } }));
}

/**
 * Subscribe `owner` to collapse requests.
 *
 * `onCollapse` fires when a DIFFERENT owner expands. Returns an unsubscribe function for the
 * effect's cleanup.
 *
 * 🔴 The self-check is load-bearing, not a micro-optimisation: without it, `announceSidebarExpanded`
 * would deliver to the announcer too, collapsing the panel that just opened. The symptom would be
 * a sidebar that opens and instantly shuts — which reads as a broken button, not as a layout rule.
 */
export function onSidebarCollapseRequest(owner: SidebarOwner, onCollapse: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SidebarExpandedDetail>).detail;
    if (!detail || detail.owner === owner) return;
    onCollapse();
  };
  window.addEventListener(CHANNEL, handler as EventListener);
  return () => window.removeEventListener(CHANNEL, handler as EventListener);
}

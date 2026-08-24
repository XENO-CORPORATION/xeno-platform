/**
 * Semantic STATUS colours — `DESIGN_SYSTEM.md` status vocabulary (the ROADMAP token that was pending).
 *
 * These are the ONE exception to the monochrome shell: danger/success/warning carry hue because they
 * mean something a greyscale cannot. They are NOT brand or interactive colour (that stays white-at-
 * opacity, see `./interactive.ts`). A `danger` button variant resolves its hover to `status.danger`.
 */
export const status = {
  danger: '#ef4444',
  dangerHover: '#dc2626',
  success: '#3fb950',
  warning: '#d29922',
} as const

export type StatusToken = keyof typeof status

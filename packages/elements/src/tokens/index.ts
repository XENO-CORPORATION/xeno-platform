/**
 * `@xenosystem/elements/tokens` — `DESIGN_SYSTEM.md §2` resolved into pure data.
 *
 * A SMALL, bounded set — not the per-element barrel the no-barrel rule forbids. Re-exporting the token
 * groups is fine and tree-shakes cleanly. Values implement the LOCKED design system verbatim; where the
 * doc gives a role without a concrete value, that value is PROPOSED in the PR, not silently locked here.
 *
 * Scope so far: §2 surfaces + interactive/text/glass, plus the radius scale, control size scale and
 * status vocabulary (landed for Tier-1 controls, values from the locked chat lab / DESIGN_SYSTEM). Motion
 * durations and the cursor map are the remaining ROADMAP tokens.
 */
export * from './surfaces'
export * from './interactive'
export * from './radius'
export * from './size'
export * from './status'
export * from './motion'

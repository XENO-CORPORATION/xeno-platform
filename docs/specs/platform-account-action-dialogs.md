# Account action dialogs — UI-1 continuation

Status: implemented and locally tested 2026-09-08; authenticated browser acceptance remains open.

## Contract

Replace all three native browser dialog sites in account surfaces: project rename, project archive and session revocation. Keep server-authorized operations and error reporting. No new permissions, business behavior, API routes, dependencies or design tokens.

## Evidence and scope

KNOWN: `ProjectsPage.tsx` uses `window.prompt` for rename and `window.confirm` for archive. `SettingsPage.tsx` uses `window.confirm` for revocation. Existing Elements `Modal`, `Button` and `TextInput` exports and CSS are available through the same local package aliases as `lazyRoute.tsx`. Modal delegates focus, Escape and scroll locking to shared `useDialog`.

KNOWN: `DELETE /account/sessions/:id` returns `revoked_session_id` after owner-scoped deletion. A current session cannot authenticate the subsequent inventory read; the current UI tries that read before logging out. Preserve other-session read-back; validate the exact deletion receipt and log out immediately for current-session revocation.

Inventory: three native dialogs become three uses of one business-level composition (one shared Modal, two shared footer Buttons, optional shared TextInput). No local renderer/CSS copy. Other existing account controls/drawers remain outside this bounded substitution and are not declared ON-SYSTEM. Visual authority: `xeno-elements/DESIGN_SYSTEM.md` §§7,11,12; element contract: `xeno-elements/SPEC.md` §§3–6. Upstream gap report records this measured scope.

## Invariants and tests

1. Opening/cancelling never calls an API. Named dialog, Escape, focus entry/return and Tab containment use shared behavior; real-DOM tests cover each.
2. Confirm performs at most one request while pending, including same-tick duplicate submit. Close, scrim and Escape cannot dismiss an in-flight operation as though it was cancelled. Pending controls are disabled, failure remains visible with retry, success alone closes.
3. Rename trims input, rejects empty/over-255-character values, and must receive the exact target ID/name in the server response before displaying success.
4. Project dialogs bind captured project/workspace identities. Workspace/selection changes remove drafts; late results cannot affect a new workspace, including A→B→A. Component/flow tests cover stale completions. Existing server scope checks remain authoritative.
5. Session revocation validates the exact receipt. Other-session revocation reloads inventory and requires absence; current-session revocation logs out without using the now-revoked authority to read inventory. Uncertain current-session failure offers explicit sign-in recovery, never a blind retry or confirmed-revocation claim. Other-session retries after a confirmed deletion repeat only the inventory check. Tests cover mismatch, request rejection, still-present rows and current-session flow.
6. No real account revocation, project archive, credentials or provider actions in automated fixtures. Browser smoke must distinguish component fixtures from authenticated backend journeys.

## Implementation and verification

Independent contract attack, minimal reusable business composition, three caller substitutions, real-DOM interaction/flow tests, default regression, typecheck/build, rendered smoke when local sign-in is available. Preserve workspace WIP; required shared Elements behavior additions are isolated on a branch from main, never a product-local fork.

Lenses: UI/accessibility, concurrency, request authority, compatibility. No new protocol/schema, billing or publication work. Rollback: only this continuation's exact source hunks; no data migration.

## Falsification and reconciliation

Accepted both MATERIAL findings. The shared Modal needs an additive dismissDisabled property; implemented on an isolated xeno-elements branch from main (no human WIP/CSS changes), then consumed as an exact source candidate in the platform's existing bundled snapshot. Default false preserves existing callers. Shift+Tab from initial panel focus must stay inside, including when action controls become disabled.

Current-session uncertain outcomes are terminal for that authority and expose explicit sign-in recovery. Other-session confirmed deletion caches that receipt while retrying failed read-back, avoiding a second DELETE. Archive uses the same confirmed-receipt retry distinction.

Final review found a same-workspace selection race in addition to workspace A→B→A. Accepted: an explicit selection-context generation invalidates late results and navigation, with a real-DOM regression. Eleven caller/dialog flow tests and seventeen health tests pass; shared renderer 324 tests/typecheck pass. Desktop and 390px dark/light dialog fixtures rendered successfully, including Enter submission and pending/keyboard behavior. A root-alias resolution bug found by rendering is fixed at the shared construction selector, without palette changes. See the September 8 continuation evidence. Authenticated actual caller journeys remain unverified until local sign-in.

# Responsive and keyboard qualification continuation

Date: 2026-09-04. Local dirty worktree only; not a release approval.

## Repairs and observed outcomes

- Account navigation hid its text on phones, leaving eight unnamed buttons in
  the accessibility tree. Explicit labels/tooltips and decorative icon hiding now
  preserve names. Live 390px browser inspection confirms all eight names.
- Dashboard command search also lost its name when compacted to an icon. Its
  name now survives at every breakpoint; opening the actual palette is verified.
- Mobile chat used `position: fixed; inset: 0` inside a relative interface slot,
  escaping the slot and painting underneath the platform navigation rail. It now
  uses absolute positioning inside the existing slot. At 390px the measured chat
  bounds are left 52, right 390, width 338; page scroll width is 390. The screenshot
  confirms the composer and conversation no longer begin beneath the rail.
- Existing mobile CSS hid session Revoke/Log out actions. Scoped session styles
  now wrap the row and preserve the buttons. Browser Tab navigation reached a
  visible Revoke button with a focus indicator. No session was revoked/logged out.
- Command palette dismissal lost opener focus, and search shortcuts intercepted
  button Enter. The palette now restores connected opener focus, wraps Tab at
  its boundaries, leaves native button activation alone and ignores composing
  input. Real browser Shift+Tab reached the last result, Tab returned to search,
  and Escape returned focus to the dashboard launcher.

## Test scope

- `npm run test:keyboard-dom`: 16 passed, zero skipped/failed. Added real-DOM
  account navigation and palette interaction tests; small source guards pin the
  responsive boundaries. DOM tests are not viewport/layout proof.
- `npm run test:chat-workspace-equilibrium`: 3 passed.
- TypeScript passed again after the final palette follow-up.
- Build after responsive fixes passed, 495 emitted files checked by the existing
  fixture scanner, 298 product pages prerendered. Large-chunk warnings remain.
  Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-responsive-build-20260904.log`.
- Phone: Settings, Billing, Dashboard and chat visually inspected at 390x844;
  Billing additionally at 320x740. Billing and Dashboard page scroll width equals
  viewport width. Account tabs intentionally scroll horizontally at small widths.
- Tablet: Settings inspected at 768x1024 with expanded navigation.
- Light, Dim and Dark presets visibly applied through Settings. Restored original
  System preference (brightness 0, Medium font) and reset viewport override.
  Original billing tab reports System/brightness 0 and default width 1023;
  temporary test tab closed. The original authenticated tab remains available.
- `/overview/welcome` redirected this completed account to `/overview`; this is
  not welcome-screen/new-user qualification. No onboarding state was reset.
- Chat currently opts into an existing development demo by default
  (`CHAT_DEMO_ENABLED`, `xeno_chat_demo`). Its rendered content is only layout
  evidence, not a generated/persisted conversation or provider-quality result.
  Existing demo work was not removed. The production scanner covers its listed
  signatures only; it is not a general proof of the absence of all sample data.
- Original preview instance `d50cd903c45891d47c26928ecfaa202d` remained ready at
  11:30:36Z: migrations, DB and Redis OK, background work disabled. No restart.

## Provider boundary and outstanding gates

Presence-only checks of the user secret store and root preview env files found
an email-provider key, not a Stripe/Google credential. The preview launcher uses
an explicit environment allowlist and does not load those provider secrets.
This is evidence about this local setup, not the production provider account.

Hosted Stripe checkout, actual webhook delivery, delayed payment, renewal,
cancellation/refund/receipt delivery and entitlement refresh still require a
qualified Stripe test environment. Real activation delivery needs an approved
test inbox; Google needs its configured test OAuth client/redirect. No external
email was sent, no provider object created, no live charge/deployment attempted.

The existing `scripts/paid-loop-proof.mjs` was inspected but not run: it omits
an explicit consent ID on its positive checkout call (the current service can
discover a usable consent, so this alone does not prove failure), does not cover
hosted Checkout, and its existing cleanup/error handling needed hardening before use.
It must not be treated as current passing end-to-end payment evidence.
The subsequent [provider preflight](2026-09-04-provider-qualification-preflight.md)
records the harness repair and read-only server configuration evidence.

All remaining rows in `../specs/platform-launch-closure.md` remain tracked. This
is a targeted responsive/keyboard slice, not all routes, every theme permutation,
new-account onboarding, production operation or public launch qualification.

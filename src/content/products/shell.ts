import type { ProductContent } from './_types';

/* XENO Shell — sourced from ../xeno-shell (README.md, CHANGELOG.md
 * v0.1.0-beta.2, PLAN.md §16, packages/ui + packages/core). Catalog: Develop,
 * status beta / delivery desktop. BOTH platforms are public on R2 under
 * apps/shell/v0.1.0-beta.2 (beta channel): the Windows installer and an x86_64
 * AppImage, built from the same commit.
 *
 * ⚠️ Platform claims on this page are the ones that rot first. This module said
 * "Windows only. macOS and Linux builds are not published" and answered the
 * "macOS and Linux?" FAQ with "Not published" for the whole day after the Linux
 * AppImage went live — because the release updated productCatalog.ts (the
 * schema.org/OS field) and nobody re-read the human-readable copy, which lives
 * here. When a product gains a platform, grep this file for the old one.
 *
 * HONESTY CONTRACT for this page — do not "improve" past it:
 *  · Shell today is a desktop WRAPPER with a real terminal (Fabric, node-pty)
 *    and a real permission-brokered file layer (Mounts / xmount://). That is
 *    the product.
 *  · NOTHING from XENO runs inside it yet. In the shipped build HubPreview is a
 *    hand-coded mock (its credit meter is a hardcoded number), Comms renders an
 *    empty state, and the only thing the embed loader actually loads is the
 *    bundled demo app. Never write "the desktop environment for every XENO app"
 *    — that is the ROADMAP, not the build.
 *  · The build is UNSIGNED and on the BETA channel. Say so, and say what
 *    SmartScreen does, everywhere a user could be surprised.
 *
 * UPDATED 2026-09-27 for v0.1.0-beta.6 (tag v0.1.0-beta.6, 941d10b): adds bringing open Windows
 * apps in (apps/desktop/src/main/hostWindows.ts + design/host-apps.js).
 * Earlier, for v0.1.0-beta.4 (tag v0.1.0-beta.4, 1655d54): the design delivery is
 * the desktop, shared sessions between two PCs (XENO-account identity, WebRTC, host-chosen
 * folders and terminals, activity log) and the sign-in door are real and verified. Comms,
 * Agents, Tasks and Hub inside the shell are STILL sample content — keep saying so. beta.4
 * shipped Windows-only: the Linux AppImage in the feed is beta.2, so this page names Windows
 * for the current version and says plainly that Linux is on the older beta.
 * Claims below trace to CHANGELOG Phase 1.5-A (host wrapper / displays),
 * 1.5-B (mounts + ACL + sandbox) and 1.5-C (installer, signing gate,
 * auto-update, crash spool, onboarding, perf, a11y).
 *
 * CORRECTED 2026-07-27 — the trust bullet read "195 tests and 3 CDP end-to-end
 * suites, run against the packaged installer". The conjunction was false: it
 * attached "run against the packaged installer" to BOTH halves. Verified:
 *   · 196 unit tests (24 vitest files) run under `vitest run` in Node/jsdom.
 *     They never touch a packaged build — no installer, no Electron binary.
 *   · The 3 CDP suites (host-shell, mounts, update) DO run against the
 *     packaged build, via run-packaged.mjs → release/win-unpacked/XENO Shell.exe.
 *     Note that is the unpacked output directory, not the NSIS installer.
 * Keep the two claims separate. */
const shell: ProductContent = {
  slug: 'shell',
  hero: {
    headline: 'A desktop you can share — with a real terminal and a lock on every folder.',
    sub: 'XENO Shell is a desktop of its own on top of Windows: windows, dock, files and genuine PTY terminals on your real PC. Invite someone on another PC with a code and they join with their own cursor — seeing only the windows, folders and terminals you choose.',
    media: { type: 'mockup', src: 'shell-hero', alt: 'XENO Shell — the per-display desktop running a Fabric ssh terminal and a mount-scoped Files window, with the shell-chrome consent sheet asking to grant a folder' },
    badges: ['Windows', 'Public beta', 'Unsigned build', 'Shared sessions', 'XENO account'],
    note: 'Beta channel · v0.1.0-beta.6 · UNSIGNED — on Windows SmartScreen will show “Windows protected your PC”; choose More info → Run anyway. Needs a XENO account to open. Comms, Agents, Tasks and Hub inside the shell are still sample content — see “What it is today”.',
  },
  trust: [
    'Two-PC sessions proven end to end: the host verifies each guest’s XENO account, and a forged identity is refused',
    'Boot p50 661 ms on the reference Windows machine',
    'No admin rights — a per-user installer on Windows',
  ],
  highlights: [
    { value: 'Real PTY', label: 'ConPTY / forkpty — not an emulator' },
    { value: 'xmount://', label: 'Host paths never cross the bridge' },
    { value: '661 ms', label: 'Boot p50, packaged build' },
    { value: 'Per display', label: 'One root per monitor, hotplug-aware' },
  ],
  features: [
    {
      eyebrow: 'Read this first',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'What it is today — and what it isn’t',
      desc: 'Shell is the XENO desktop, released early so you can use the parts that are finished: the desktop itself, terminals, a permission-brokered file manager, and sharing all of it with someone on another PC. The XENO apps inside it are still to come.',
      bullets: [
        'Real today: the desktop on your real disk, PTY terminals, Mounts, shared sessions with folders and terminals',
        'Not yet: Comms, Agents, Tasks and Hub inside the shell show sample content',
        'Guests see shared windows as frames, not their live contents; files over 8 MB are refused',
        'v0.1.0-beta.6 is Windows-only; Linux is on the older beta.2; macOS is not built yet',
      ],
    },
    {
      eyebrow: 'Shared sessions',
      icon: 'Users',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,190,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Someone on another PC, in your shell',
      desc: 'Start sharing, give the other person a code, and let them in. They sign in with their own XENO account, so you see who is really asking, and each of you has your own cursor. The two PCs connect directly, or through a XENO relay when a network blocks that — the platform introduces them and never sees the session.',
      bullets: [
        'The host verifies the guest’s XENO account before they can ask to join; a forged name is refused',
        'Windows stay private until you share them; lock, hand over or take back any window',
        'Share a folder view-only or editable — the guest works on your disk, inside it, nowhere else',
        'Share a terminal; the guest types only after you give them the keyboard, and you can take it back',
      ],
    },
    {
      eyebrow: 'Your apps, inside',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'Bring the apps you already have open',
      desc: 'When XENO Shell starts it offers to bring in the apps you already have open on Windows. Each one you pick becomes a XENO Shell window — in the dock, on your workspaces, snappable — showing the real app live, and when you click it you are using the app itself. It keeps running as itself: close its window here and it goes back to Windows exactly where it was.',
      bullets: [
        'Nothing is brought in unless you tick it',
        'Close its window here and the app goes back to Windows where it was; quit the app and its window closes',
        'If XENO Shell stops unexpectedly, its next start puts every app back',
        'An app running as administrator is listed with the reason it cannot be moved — Windows only',
      ],
    },
    {
      eyebrow: 'Fabric',
      icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,220,150,0.14), transparent 60%), linear-gradient(165deg,#0d1c14,#070707 74%)',
      title: 'A terminal that is actually a terminal',
      desc: 'Fabric runs on a real PTY — ConPTY on Windows, forkpty on POSIX — bridged to xterm.js in the shell. Full-screen editors, colours, job control and resize all behave, because nothing is being emulated.',
      bullets: [
        'ssh://user@host:port targets invoke the system ssh client inside the PTY',
        'local://shell opens your default shell',
        'Multiple concurrent terminal windows (Fabric → New window)',
        'Sessions are disposed with their window; resize propagates to the remote',
      ],
    },
    {
      eyebrow: 'Mounts',
      icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#15111f,#070707 74%)',
      title: 'Hand out a folder, not your disk',
      desc: 'Host folder access is a Mount: you grant one, and an app then needs its own per-app grant on top of it. Apps address files through an opaque xmount:// handle — the raw path never crosses into app or embed code, so there is nothing to leak, log or guess from.',
      bullets: [
        'Per-app × per-mount grants, consented in shell chrome — never by the app itself',
        'Two-layer canonicalisation rejects “..”, junctions and alternate data streams',
        'Revoke live: open handles die immediately with a typed XENO-FS[PermissionRevoked]',
        'Every call lands in an audit ring you can read in Settings → Privacy',
      ],
    },
    {
      eyebrow: 'Host wrapper',
      icon: 'MonitorSmartphone',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'One borderless root per display — not a kiosk',
      desc: 'Full-OS mode gives every monitor its own shell root, its own dock and its own set of workspaces. It is borderless-fullscreen, not kiosk, so F11 gets you out and your keyboard keeps working the way it should.',
      bullets: [
        'F11 toggles across all displays; tray, autostart (off by default), single-instance focus',
        'Per-display docks and workspace sets, DIP-space geometry, mixed-DPI correct',
        'Display hotplug: windows from a vanished monitor migrate to the primary with a toast',
        'Session restore from ~/.xeno/shell/state.json — atomic writes, corrupt file recovers',
      ],
    },
    {
      eyebrow: 'Embedding',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'A scoped bridge for apps that come later',
      desc: 'The loader gives each embedded app its own scoped window.xenoShell — permissions, notifications and commands are attributed to that app’s id, never pooled. Desktop loads modules in-realm; web gives each app a same-origin iframe with the scoped API installed inside it. The contract is published so an app can be built against it now.',
      bullets: [
        'Per-app scoped API — an app cannot act as, or see, another app',
        'Renderer hardening: sandbox flags, navigation + window-open interception, CSP',
        'The privileged xeno-app:// scheme for shell-native surfaces',
        'Today this loads the bundled demo embed — real XENO apps are still to come',
      ],
    },
    {
      eyebrow: 'Shipping honestly',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Unsigned, and it tells you so',
      desc: 'This build is not code-signed, so it says so — an Unsigned build badge on the sign-in screen and in the shell, which can only ever read “signed” with real signing configured. Updates are staged and reversible, and crash data stays on your machine.',
      bullets: [
        'Per-user NSIS installer — no admin rights required',
        'Staged auto-update on the beta channel, with a no-downgrade guard and a rollback marker',
        'An unreachable update server retries quietly and never blocks boot',
        'Crash minidumps spool locally, scrubbed of paths and identifiers; upload is off by default',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'shell-mounts', alt: 'XENO Shell — Settings, Privacy and access: mounts with per-app grants, live revoke, and the audit ring showing a rejected path escape' },
    { type: 'mockup', src: 'shell-displays', alt: 'XENO Shell — full-OS mode with one borderless root per display, per-display docks and workspaces, and a display-hotplug toast' },
  ],
  useCases: [
    { title: 'Keep the remote box on screen', icon: 'Terminal', desc: 'Park an ssh:// Fabric session on a second monitor in its own workspace, and have it come back exactly where it was after a reboot.' },
    { title: 'Give a tool one folder', icon: 'Lock', desc: 'Grant a single directory instead of your user profile. The tool gets a handle, you get an audit log, and revoking takes one click.' },
    { title: 'Build against the substrate early', icon: 'Layers', desc: 'The window, permission and mount contract is published and stable enough to develop an embed against — before the desktop around it is finished.' },
  ],
  howItWorks: [
    { step: '1', title: 'Install and sign in', desc: 'Run the per-user installer — no admin rights. It is unsigned, so SmartScreen warns once: More info → Run anyway. Then sign in with your XENO account; your browser handles the sign-in and Shell never sees your password.' },
    { step: '2', title: 'Share', desc: 'Open the share panel, choose Start sharing and give the code to the person joining. When their verified name appears, let them in.' },
    { step: '3', title: 'Work together', desc: 'Share a window, a folder or a terminal. Everything they do happens on your PC, and only where you allowed it — the session activity log shows what happened.' },
  ],
  comparison: {
    competitor: 'Windows Terminal + Explorer',
    rows: [
      { feature: 'Real PTY terminal with ssh:// targets', xeno: true, them: true },
      { feature: 'Invite someone into your desktop with their own cursor', xeno: true, them: false },
      { feature: 'Per-app folder grants, revocable while open', xeno: true, them: false },
      { feature: 'Apps see an opaque handle, never a host path', xeno: true, them: false },
      { feature: 'Audit log of every file call an app makes', xeno: true, them: false },
      { feature: 'Per-display docks and workspace sets', xeno: true, them: 'Taskbar' },
      { feature: 'Runs your existing Windows applications', xeno: false, them: true },
      { feature: 'A full app ecosystem inside it', xeno: 'Demo embed only', them: true },
      { feature: 'Code-signed and long-shipping', xeno: 'Unsigned beta', them: true },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows 10/11 x64 (per-user install) · Linux x64 on the older beta.2' },
    { label: 'Channel', value: 'Beta · v0.1.0-beta.6 · unsigned' },
    { label: 'Account', value: 'XENO account required to open' },
    { label: 'Terminal', value: 'node-pty (ConPTY) · ssh:// + local://' },
    { label: 'Status', value: 'Public beta — desktop, terminals, files and shared sessions' },
  ],
  faq: [
    { q: 'What is XENO Shell in one sentence?', a: 'A desktop of its own on top of Windows — windows, dock, files and real PTY terminals on your PC — that someone on another PC can join with their own cursor, on the windows, folders and terminals you choose.' },
    { q: 'How do I share it with someone?', a: 'Both of you install XENO Shell and sign in with a XENO account. You choose Start sharing and give them the code; they choose Join someone instead and enter it; you let them in when their verified name appears. See the documentation for folders, terminals and the activity log.' },
    { q: 'Can the person who joins see or change my files?', a: 'Only a folder you share, at the level you choose — view-only or editable — and only while you keep sharing it. Everything happens on your disk inside that folder; paths outside it are refused. They cannot copy files out to their own PC in this version.' },
    { q: 'Why does it need a XENO account?', a: 'XENO Shell opens only for a signed-in account the platform allows, like every XENO app. The same account is what proves to the host who is asking to join a shared session. If you are offline it keeps working for 14 days after it last confirmed your plan.' },
    { q: 'Do XENO apps run inside it yet?', a: 'Not yet. Comms, Agents, Tasks and Hub appear in the shell with sample content; they are not connected to your account in this build. The desktop, terminals, files and shared sessions are real. We would rather you know that before you download it than after.' },
    { q: 'It is unsigned — what will Windows do?', a: 'SmartScreen will show “Windows protected your PC” when you run the installer. Choose More info → Run anyway to continue, or wait for the signed build if that is not acceptable for your machine. The app itself also carries a visible Unsigned build badge, on the sign-in screen and in the shell, and that flag can only read “signed” when a real signing environment produced the build.' },
    { q: 'How do updates work on Linux?', a: 'Linux is on v0.1.0-beta.2 for now; v0.1.0-beta.6 shipped for Windows first. Keep the AppImage as an AppImage and it updates itself in place, exactly like the Windows build. If you extract it, or repackage it, self-update stops working — that is a limitation of the AppImage format, not a bug — and Shell will say so rather than pretend: the updater reports that updates are unavailable for this launch mode instead of retrying forever against something that cannot succeed. Download a new AppImage when you want to move forward.' },
    { q: 'Is this kiosk mode? Can I get out?', a: 'It is not kiosk. Full-OS mode is a borderless-fullscreen window per display, which is why F11 reliably toggles it and your keyboard shortcuts are not swallowed. Kiosk was rejected precisely because of its key-handling behaviour.' },
    { q: 'What is a Mount, and what is xmount://?', a: 'A Mount is a host folder you have granted to Shell. Apps do not get that path — they get an opaque xmount:// handle, and they additionally need their own per-app grant on that mount, consented in shell chrome. Paths are canonicalised twice before use, so “..”, junctions and alternate data streams are rejected rather than followed.' },
    { q: 'What happens if I revoke access while something is using it?', a: 'It dies immediately. Open handles fail with a typed XENO-FS[PermissionRevoked] error rather than silently reading stale data, and the revocation is written to the audit ring in Settings → Privacy alongside every allow and deny.' },
    { q: 'How do updates work, and can I go back?', a: 'Installed shells check the beta feed on startup and every 30 minutes, and roll out in stages by a deterministic machine bucket. A no-downgrade guard stops you sliding backwards accidentally; the only thing that overrides it is a deliberate rollback marker we publish if a build turns out bad. If the update server is unreachable, Shell retries quietly and boots as normal.' },
    { q: 'Is any data sent anywhere?', a: 'Crash minidumps and renderer errors spool to ~/.xeno/shell/crash/ on your own machine, scrubbed of paths, URIs, mount tokens and other identifiers — version and display topology only. Upload is off by default and doubly gated: it needs both your opt-in and a configured endpoint, and no endpoint ships in this build.' },
    { q: 'macOS and Linux?', a: 'v0.1.0-beta.6 is Windows-only; its Linux build has not been published yet, so Linux users are on v0.1.0-beta.2 — an x86_64 AppImage built from the same commit as the Windows installer, with the same packaged end-to-end evidence: the full mounts acceptance flow, junction and .. escapes rejected, live revocation, and a verified self-update. macOS is not built yet. The codebase is cross-platform and the terminal uses forkpty on POSIX, so it is a packaging and evidence gap rather than a porting one.' },
  ],
  seo: {
    title: 'XENO Shell — a desktop you can share, with a real terminal and folder-level permissions',
    description: 'XENO Shell is a desktop on top of Windows with real PTY terminals and a permission-brokered file manager — and shared sessions: someone on another PC joins with their own cursor and a verified XENO account, on the folders and terminals you choose. Bring the apps you already have open inside it. Public beta, v0.1.0-beta.6, unsigned. XENO apps inside it are still sample content.',
  },
};

export default shell;

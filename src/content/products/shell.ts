import type { ProductContent } from './_types';

/* XENO Shell — sourced from ../xeno-shell (README.md, CHANGELOG.md
 * v0.1.0-beta.1, PLAN.md §16, packages/ui + packages/core). Catalog: Develop,
 * status beta / delivery desktop (the Windows installer is public on R2 under
 * apps/shell/v0.1.0-beta.1, beta channel).
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
    headline: 'A desktop shell with a real terminal and a lock on every folder.',
    sub: 'XENO Shell wraps your monitors in a borderless desktop of its own — with Fabric, a genuine PTY terminal that speaks ssh://, and Files, a browser over folders you hand out one at a time. Apps never see a path on your disk, only a handle you can revoke mid-write.',
    media: { type: 'mockup', src: 'shell-hero', alt: 'XENO Shell — the per-display desktop running a Fabric ssh terminal and a mount-scoped Files window, with the shell-chrome consent sheet asking to grant a folder' },
    badges: ['Windows', 'Public beta', 'Unsigned build', 'Real PTY terminal', 'xmount:// broker'],
    note: 'Beta channel · v0.1.0-beta.1 · UNSIGNED — Windows SmartScreen will show “Windows protected your PC”; choose More info → Run anyway, or wait for the signed build. No XENO app runs inside Shell yet — see “What it is today”.',
  },
  trust: [
    '196 unit tests, plus 3 CDP end-to-end suites run against the packaged build',
    'Boot p50 661 ms on the reference Windows machine',
    'Per-user install — no admin rights, no system-wide changes',
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
      desc: 'Shell is the host layer of the XENO desktop, released early so you can use the parts that are finished. Two of them are real products in their own right: a terminal and a permission-brokered file manager. The rest of the desktop is still a plan.',
      bullets: [
        'Real today: the per-display window host, the Fabric terminal, Mounts + the ACL broker',
        'Not yet: XENO apps running inside it — Hub and Comms are placeholders in this build',
        'The embed loader works, but the only app it loads today is the bundled demo',
        'Windows only. macOS and Linux builds are not published',
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
      desc: 'This build is not code-signed, so it wears an UNSIGNED DEV BUILD watermark in the shell chrome and in Settings → About — the flag can only ever read “signed” with real signing configured. Updates are staged and reversible, and crash data stays on your machine.',
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
    { step: '1', title: 'Install', desc: 'Run the per-user installer — no admin rights. It is unsigned, so SmartScreen warns once: More info → Run anyway.' },
    { step: '2', title: 'Grant a folder', desc: 'First run asks, consent-first, what Shell may see. Nothing is mounted until you say so, and autostart stays off unless you turn it on.' },
    { step: '3', title: 'Open a terminal', desc: 'Launch Fabric on a local shell or an ssh:// target, arrange your displays and workspaces, and let session restore keep them.' },
  ],
  comparison: {
    competitor: 'Windows Terminal + Explorer',
    rows: [
      { feature: 'Real PTY terminal with ssh:// targets', xeno: true, them: true },
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
    { label: 'Platform', value: 'Windows 10/11 x64 — per-user install' },
    { label: 'Channel', value: 'Beta · v0.1.0-beta.1 · unsigned' },
    { label: 'Terminal', value: 'node-pty (ConPTY) · ssh:// + local://' },
    { label: 'Status', value: 'Public beta — host layer only' },
  ],
  faq: [
    { q: 'What is XENO Shell in one sentence?', a: 'A desktop shell for Windows: it takes over your displays with a borderless full-screen root each, and ships two working surfaces inside — Fabric, a real PTY terminal that speaks ssh://, and Files, a browser over folders you explicitly hand out.' },
    { q: 'Do XENO apps run inside it yet?', a: 'No. That is the roadmap, not this build. Hub and Comms appear in the shell as placeholders — the Hub view is a hand-built mock, not the real launcher — and the embed loader currently loads only the bundled demo app. Everything else on this page is real and running. We would rather you know that before you download it than after.' },
    { q: 'It is unsigned — what will Windows do?', a: 'SmartScreen will show “Windows protected your PC” when you run the installer. Choose More info → Run anyway to continue, or wait for the signed build if that is not acceptable for your machine. The app itself also carries a visible UNSIGNED DEV BUILD watermark in its chrome and in Settings → About, and that flag can only read “signed” when a real signing environment produced the build.' },
    { q: 'Is this kiosk mode? Can I get out?', a: 'It is not kiosk. Full-OS mode is a borderless-fullscreen window per display, which is why F11 reliably toggles it and your keyboard shortcuts are not swallowed. Kiosk was rejected precisely because of its key-handling behaviour.' },
    { q: 'What is a Mount, and what is xmount://?', a: 'A Mount is a host folder you have granted to Shell. Apps do not get that path — they get an opaque xmount:// handle, and they additionally need their own per-app grant on that mount, consented in shell chrome. Paths are canonicalised twice before use, so “..”, junctions and alternate data streams are rejected rather than followed.' },
    { q: 'What happens if I revoke access while something is using it?', a: 'It dies immediately. Open handles fail with a typed XENO-FS[PermissionRevoked] error rather than silently reading stale data, and the revocation is written to the audit ring in Settings → Privacy alongside every allow and deny.' },
    { q: 'How do updates work, and can I go back?', a: 'Installed shells check the beta feed on startup and every 30 minutes, and roll out in stages by a deterministic machine bucket. A no-downgrade guard stops you sliding backwards accidentally; the only thing that overrides it is a deliberate rollback marker we publish if a build turns out bad. If the update server is unreachable, Shell retries quietly and boots as normal.' },
    { q: 'Is any data sent anywhere?', a: 'Crash minidumps and renderer errors spool to ~/.xeno/shell/crash/ on your own machine, scrubbed of paths, URIs, mount tokens and other identifiers — version and display topology only. Upload is off by default and doubly gated: it needs both your opt-in and a configured endpoint, and no endpoint ships in this build.' },
    { q: 'macOS and Linux?', a: 'Not published. The codebase is cross-platform and the terminal uses forkpty on POSIX, but the only build released is Windows, and the packaged end-to-end evidence is Windows only.' },
  ],
  seo: {
    title: 'XENO Shell — a desktop shell with a real terminal and folder-level permissions',
    description: 'XENO Shell is a Windows desktop shell: one borderless root per display, Fabric (a real node-pty terminal with ssh:// targets), and Mounts — per-app folder grants over opaque xmount:// handles with live revoke and an audit log. Public beta, v0.1.0-beta.1, unsigned. No XENO apps run inside it yet.',
  },
};

export default shell;

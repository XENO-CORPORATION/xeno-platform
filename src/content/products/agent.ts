import type { ProductContent } from './_types';

/* XENO Agent — LIVE. Sourced from ../xeno-agent-interface (README.md,
 * CLAUDE.md, docs/ARCHITECTURE.md, docs/PRODUCT_STATUS.md), first verified
 * against main 6288ec3 on 2026-08-08 and re-verified against the published
 * 0.2.0 release (tag agent-v0.2.0, main 3992f5e) on 2026-08-14.
 *
 * BEFORE THIS GOES LIVE, know what is and is not true:
 *  · The product IS released. 0.1.0 shipped 2026-08-10; 0.2.0 shipped 2026-08-14.
 *    apps/agent/version.json serves 0.2.0 and /product/agent is a real page.
 *    (The three bullets that used to sit here said the opposite — "NEVER been
 *    released", "version.json 404s", "returns the SPA shell" — which was true
 *    the day this module was written and false four days later. A status
 *    assertion in a comment needs a date attached or it becomes a lie on a
 *    timer.)
 *  · delivery: DESKTOP INSTALLER on TWO platforms as of 0.2.0.
 *    `XENO Agent Setup 0.2.0.exe` (NSIS, per-user, x64) and
 *    `XENO-Agent-0.2.0.AppImage` (x64), both built from the same commit and
 *    both verified end-to-end through the live auto-update chain. The AppImage
 *    was launched as an ordinary non-root user before publishing.
 *    The macOS dmg target is CONFIGURED IN electron-builder.yml AND HAS NEVER
 *    BEEN BUILT — do not advertise it, and do not add a mac badge until an
 *    artifact exists. That rule is why Linux is only being added now.
 *  · UNSIGNED, shipped as EXPERIMENTAL — the standing company posture, decided
 *    2026-08-08, same as XENO Hub 0.6.0 and XENO Shell 0.1.0-beta.1.
 *    electron-builder logged "no signing info identified, signing is skipped".
 *    NOTHING in this module says so, deliberately. `experimentalNotice()` in
 *    src/lib/productCatalog.ts is "the one place this is written" — it derives
 *    the label ("Experimental · unsigned installer"), the SmartScreen
 *    paragraph, and the More info → Run anyway steps from `maturity` +
 *    `signing`, both of which fail safe when omitted from the catalog entry.
 *    Repeating any of it here (hero.note, downloadNotice, an FAQ) duplicates
 *    the page's own words AND leaves a stale copy behind the day signing lands
 *    and the derived notice disappears. hub.ts follows this; shell.ts repeats
 *    the SmartScreen line in hero.note and is the anti-pattern _types.ts warns
 *    about. Follow hub.
 *  · AUTO-UPDATE IS WIRED (2026-08-08). The app checks apps/agent/version.json,
 *    applies a channel / no-downgrade / staged-rollout / rollback policy, and
 *    downloads via electron-updater's generic provider. So `autoUpdates` is
 *    left at its default (true) and the download page may promise updates.
 *    Caveat worth keeping straight: electron-updater verifies signatures only
 *    for SIGNED builds, so today an update is authenticated by HTTPS plus the
 *    feed sha512 — the same trust level as the initial download. Do not write
 *    copy implying cryptographic publisher verification until signing lands.
 *  · The Hub Agent tab is the SAME product in a different surface by design,
 *    but as of 2026-08-08 Hub's main does not yet consume this repository. Do
 *    not write copy claiming "the same Agent in Hub" until that lands, or the
 *    page describes an integration users cannot observe.
 *  · Provider names (Claude, GPT, Gemini …) are reached through ACP and the
 *    XENO Cloud adapter and are NOT hardcoded — the UI builds its catalog from
 *    live provider descriptors. Keep copy provider-neutral for that reason.
 *
 * Voice per `XENO BRAND - BOILERPLATE.md`: contractions stay, fragments are
 * deliberate, US spelling, no pricing language, public register uses
 * "workspace" (not "harness"), "agent-native" is the differentiator. */
const agent: ProductContent = {
  slug: 'agent',
  hero: {
    headline: 'The agent-native workspace for building software.',
    sub: 'XENO Agent runs a real agent against a workspace you choose — it reads the code, proposes edits as diffs you approve, runs terminal commands, and keeps every session durable. Bring any provider. Nothing about the model is baked into the UI.',
    media: { type: 'mockup', src: 'agent-hero', alt: 'XENO Agent — conversation tabs, a diff review, and a terminal session in one workspace' },
    badges: ['Windows', 'Linux', 'Free', 'Any provider'],
    note: 'Free desktop app for Windows and Linux x64 · proprietary. A macOS build is not out yet.',
  },
  trust: [
    'Windows 10/11 x64 and Linux x64 (AppImage) · macOS not yet built',
    'Provider-neutral — the model catalog comes from the provider, not the UI',
    'Your workspace stays local; execution runs on your machine',
  ],
  highlights: [
    { value: 'Any provider', label: 'ACP · SDK-native · XENO Cloud' },
    { value: 'Diffs you approve', label: 'Nothing lands unreviewed' },
    { value: 'Durable sessions', label: 'Survive restarts' },
    { value: 'One authority', label: 'No competing writers' },
  ],
  features: [
    {
      eyebrow: 'Execution', icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'It reads, edits, and runs — with your permission',
      desc: 'A real agent loop against a workspace you pick. It explores the repo, proposes edits as diffs, and runs commands in an integrated terminal.',
      bullets: [
        'Workspace, terminal, and code-intelligence services',
        'Review edits file-by-file or hunk-by-hunk',
        'Checkpoints with hash-verified restore',
        'Cancel mid-turn and recover cleanly',
      ],
    },
    {
      eyebrow: 'Providers', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Bring any agent — the UI has no favorites',
      desc: 'Agents connect over the Agent Client Protocol, the XENO Agent SDK, or XENO Cloud hosted runs. Models, reasoning modes, and capabilities are read from the provider at runtime.',
      bullets: [
        'ACP providers · SDK-native · XENO Cloud hosted runs',
        'Model and reasoning catalogs discovered dynamically',
        'No model family hardcoded in the interface',
        'A text-only path fails closed instead of pretending',
      ],
    },
    {
      eyebrow: 'Sessions', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Conversations that survive a restart',
      desc: 'Session tabs in the Agent header with desktop-grade navigation. Close a tab without cancelling its work; reopen it where you left off.',
      bullets: [
        'Ctrl+T · Ctrl+W · Ctrl+Tab · Ctrl+1–9',
        'Reorder, restore, and close without deleting',
        'Runtime status projected per tab',
        'Workspace and conversation records in transactional SQLite',
      ],
    },
    {
      eyebrow: 'Integrity', icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'One authority owns your agent state',
      desc: 'Exactly one per-user host owns execution and durable state. Other surfaces attach as clients, so nothing races your workspace behind your back.',
      bullets: [
        'Single-authority election with local RPC',
        'The interface has no direct file, process, or credential access',
        'Runtime events are the source of truth; the UI is a projection',
        'Migration with hash backup, validation, and rollback',
      ],
    },
  ],
  useCases: [
    { title: 'Work a real repo', icon: 'GitBranch', desc: 'Point it at a workspace and describe the change. It explores, edits with diffs you approve, and runs the tests.' },
    { title: 'Long sessions', icon: 'Clock', desc: 'Multi-hour work that survives restarts — durable events, context compaction, and checkpoints you can return to.' },
    { title: 'Your provider, your terms', icon: 'Lock', desc: 'Connect the agent you already use over ACP, or run through XENO Cloud. The workspace and the execution stay on your machine.' },
  ],
  howItWorks: [
    { step: '1', title: 'Pick a workspace', desc: 'Choose the folder the agent may work in. It gets no authority beyond what you grant.' },
    { step: '2', title: 'Pick a provider', desc: 'Connect an ACP agent, the XENO Agent SDK, or XENO Cloud. Models and reasoning modes populate from the provider.' },
    { step: '3', title: 'Review before it lands', desc: 'Edits arrive as diffs. Accept a file, accept a hunk, or reject — then checkpoint and keep going.' },
  ],
  specs: [
    { label: 'Platform', value: 'Windows 10/11 x64 · Linux x64 AppImage (macOS not yet built)' },
    { label: 'Install', value: 'NSIS installer, per-user, installation directory changeable' },
    { label: 'Download size', value: '≈ 87 MB' },
    { label: 'Auto-update', value: 'Yes — staged, with channel and rollback support' },
    { label: 'Data location', value: '~/.xeno/agent (SQLite, WAL)' },
    { label: 'Providers', value: 'Agent Client Protocol · XENO Agent SDK · XENO Cloud hosted runs' },
    { label: 'License', value: 'Proprietary' },
  ],
  faq: [
    {
      q: 'Is this the same Agent that is in XENO Hub?',
      a: 'It is the same product built from one implementation — the interface, host protocol, and provider adapters live in a single place and are mounted by each surface. The standalone app is the one you install here.',
    },
    {
      q: 'Does it update itself?',
      a: 'Yes. It checks for new versions in the background, downloads them, and installs on restart. Releases can be rolled out in stages, and a bad release can be pulled back by repointing the feed at the previous version.',
    },
    {
      q: 'Which models can it use?',
      a: 'Whatever your connected provider exposes. The interface reads the model and reasoning catalog from the provider at runtime instead of hardcoding a list, so a provider that adds a model makes it available without an app update.',
    },
    {
      q: 'Where does my code go?',
      a: 'The workspace stays on your machine and execution runs locally. What reaches a provider is what that provider needs for the turn — and if you connect a local runtime, nothing leaves the machine at all.',
    },
    {
      q: 'How is this different from XENO Agent CLI?',
      a: 'Same family, different surface. The CLI is a terminal agent; XENO Agent is the desktop workspace — session tabs, diff review, an integrated terminal, and durable state across restarts.',
    },
  ],
  seo: {
    title: 'XENO Agent — the agent-native workspace for building software',
    description: 'Run a real coding agent against your own workspace. Diffs you approve, an integrated terminal, durable sessions, and any provider over ACP or XENO Cloud. Free preview for Windows and Linux.',
  },
  // No statusLabel: the catalog `status: 'beta'` pill plus the derived
  // `experimentalNotice()` label ("Experimental · unsigned installer") already
  // say it, in the house vocabulary. An invented word like "Preview" here would
  // compete with both.
  downloadNotice: 'Agent workspace and conversation state is stored under ~/.xeno/agent and may be migrated by a future version — treat anything created here as prerelease data.',
  // autoUpdates deliberately omitted: it defaults to true, and as of 2026-08-08
  // this build really does auto-update.
};

export default agent;

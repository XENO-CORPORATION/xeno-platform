import type { ProductContent } from './_types';

/* XENO Use — sourced from ../xeno-use (README + SPEC/ARCHITECTURE/ROADMAP).
 * Coming-soon framing, CTA is the waitlist (delivery: soon).
 *
 * CORRECTED 2026-07-27. The page was written in the PRESENT TENSE about device
 * classes that do not exist. A waitlist CTA does not license describing
 * unbuilt capability as if it were built. Verified against the repo:
 *   Drivers:   ONE — use-driver-desktop, LINUX/X11 only (~2,558 LOC).
 *              The other 8 (desktop-Win, desktop-mac, android, ios, web,
 *              visionos, quest, embedded) are SPEC §8.3 roadmap entries with
 *              no crate at all. So "Native swipe & long-press on mobile" and
 *              "Desktop · mobile · web · VR" described nothing.
 *   Sandboxes: ONE — use-sandbox-container (Docker/Podman). Every VM and cloud
 *              sandbox in the ROADMAP is an unchecked box.
 *   SDKs:      ONE — packages/sdk-node. There is no Python SDK and no Rust SDK.
 *   "Signed driver registry": does not exist. Two aspirational mentions only —
 *              an UNCHECKED roadmap item (registry.xeno-use.io) and a Level-2
 *              SPEC requirement.
 * The repo's own README is the honest source and this page now matches it:
 *   "active v0.1 implementation … not release-ready yet. The current runtime
 *    target is a Linux desktop in a container; other device classes remain
 *    roadmap work."
 * Rule for this file: the ONE-API-for-every-device thesis may be described as
 * the design (it is the point of the product). Individual device classes must
 * be in the future tense until their crate exists. */
const use: ProductContent = {
  slug: 'use',
  hero: {
    headline: 'Give your agent hands.',
    sub: 'XENO Use is one OpenAI-compatible API to see, click, type and replay on a screen — designed so a single `use.*` verb namespace reaches every device class through a swappable driver. Today one driver exists: Linux desktop, in a container. Every session records to a replayable `.xuse` tape.',
    media: { type: 'mockup', src: 'use-hero', alt: 'XENO Use Inspector — a sandboxed device viewport with the accessibility overlay and click crosshair, alongside the live use.* action stream' },
    badges: ['Linux desktop today', 'OpenAI-compatible + MCP', '.xuse record & replay', 'AGPL-3.0'],
    note: 'In active development, and not release-ready. What exists today: ONE driver (Linux/X11 desktop), ONE sandbox (container), ONE SDK (Node). Windows, macOS, Android, iOS, web and VR are designed for but not built. Join the waitlist for the first build.',
  },
  trust: ['One tool surface designed for every device class — one driver built so far', 'OpenAI-compatible HTTP + native MCP + Anthropic bridge', 'AGPL-3.0 · self-hostable, cloud is opt-in'],
  highlights: [
    { value: 'One namespace', label: 'use.* — device-independent by design' },
    { value: '.xuse tapes', label: 'Record · replay · diff' },
    { value: 'Any model', label: 'Claude · GPT · Gemini · local' },
    { value: 'Linux desktop', label: 'The one driver that exists today' },
  ],
  features: [
    {
      eyebrow: 'One namespace',
      icon: 'MonitorSmartphone',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'One verb, designed to reach every device',
      desc: 'The agent calls use.click, use.type and use.screenshot and never names a device. That indirection is the whole product: a driver implements the UseDriver trait, and the agent-facing schema never changes when a new device class is added. The schema is locked; the driver set is where the work is.',
      bullets: [
        'use.click · type · swipe · scroll · key · screenshot — one schema, already locked',
        'Built today: the Linux/X11 desktop driver, with an AT-SPI accessibility backend',
        'Designed and specified, NOT built: Windows, macOS, Android, iOS, web, VR',
        'Each driver implements the same UseDriver Rust trait — that contract is real now',
      ],
    },
    {
      eyebrow: 'Sandboxes',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Run it anywhere — safely.',
      desc: 'Agents don’t get host access by default. Pick a sandbox per session — from your own machine to a throwaway container or a snapshot VM — decoupled from the driver, so the same driver runs against an emulator or a real device.',
      bullets: [
        'Built today: the container sandbox (Docker/Podman), with egress control',
        'Specified, not built: local, VM (qemu/Hyper-V/Parallels), cloud, real-device',
        'Sandboxes are decoupled from drivers, so a driver gains a sandbox for free',
        'VM-snapshot anchored replay is the determinism design — it needs the VM sandbox first',
      ],
    },
    {
      eyebrow: 'Record & replay',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'A git commit for agent behavior.',
      desc: 'Every action records into a single self-contained `.xuse` file — screenshot, action, and accessibility snapshot per step. Replay it, scrub through it in the inspector, diff two runs, or train on it.',
      bullets: [
        'Deterministic replay against the same VM snapshot',
        'Each frame stores pixels + a11y tree + active-app context',
        'Diff two tapes to catch behavioral drift',
        'Ed25519-signed and forward-compatible — new engines read old tapes',
      ],
    },
    {
      eyebrow: 'Any model',
      icon: 'Bot',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Works with any agent.',
      desc: 'It’s the hands, not the brain. Point Claude, GPT, Gemini or a fully local model at the same tool surface over HTTP, MCP, or the Anthropic computer-use bridge — no vendor lock-in.',
      bullets: [
        'OpenAI-compatible HTTP: POST /v1/use/<verb>',
        'Native MCP server for Claude, Cursor and Claude Code',
        'Drop-in Anthropic computer-use bridge',
        'Node SDK today — Python and Rust SDKs are planned, not published',
      ],
    },
    {
      eyebrow: 'Trust & scope',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Self-hosted by default.',
      desc: 'Self-host the whole substrate on your own machine — cloud sandboxes are opt-in. A single-binary driver runs local desktop control with no Docker required, and it stays honestly scoped to the primitives.',
      bullets: [
        'AGPL-3.0 — no one can fork it into a closed competitor',
        'New device classes arrive via the driver SDK (a signed driver registry is planned)',
        'a11y-tree assertion each step — fails fast when the world drifts',
        'Configurable screenshot retention, down to delete-on-close',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'use-tape', alt: 'The .xuse tape inspector — a filmstrip of recorded frames, the selected action’s params and result, correct/incorrect labeling, and the Ed25519 signature line' },
  ],
  useCases: [
    { title: 'Computer-use agents', icon: 'Bot', desc: 'Give any LLM a real pair of hands against a Linux desktop today — written once against a tool surface that is meant to stay identical as mobile and web drivers land, instead of wiring a device-specific SDK per target.' },
    { title: 'Agent training & eval', icon: 'GitBranch', desc: 'Record real action trajectories as .xuse tapes, replay them against a fixed snapshot, and diff runs to measure drift — RL- and eval-ready data.' },
    { title: 'Self-hosted automation', icon: 'Lock', desc: 'Run the substrate on your own machine or a CI container — your screens, secrets and tapes never leave your infrastructure.' },
  ],
  howItWorks: [
    { step: '1', title: 'Self-host it', desc: 'Once v0.1 ships: curl the installer and run `xeno-use serve --port 7780` — no Docker needed for local desktop.' },
    { step: '2', title: 'Acquire a device', desc: 'Pick a device + sandbox. In v0.1 that is a Linux desktop in a container; further device classes and sandboxes follow.' },
    { step: '3', title: 'Act & record', desc: 'Call use.click / type / screenshot from any agent; record the session to a replayable .xuse tape.' },
  ],
  comparison: {
    competitor: 'most computer-use tools',
    rows: [
      { feature: 'One verb API across device classes', xeno: 'By design', them: 'Device-specific' },
      { feature: 'Desktop + mobile + web + VR', xeno: 'Linux desktop only so far', them: 'Usually one target' },
      { feature: 'Replayable, diffable recording format', xeno: '.xuse tapes', them: false },
      { feature: 'Self-host, not per-minute billed', xeno: true, them: 'Often cloud-metered' },
      { feature: 'Model-agnostic (HTTP · MCP · Anthropic bridge)', xeno: true, them: 'Often one vendor' },
      { feature: 'Shipping today, proven in production', xeno: 'In development', them: true },
    ],
  },
  specs: [
    { label: 'Status', value: 'Coming soon · v0.1 in dev, not release-ready' },
    { label: 'Drivers', value: 'Linux/X11 desktop (1 of 9 designed)' },
    { label: 'Sandboxes', value: 'Container (Docker/Podman)' },
    { label: 'Interface', value: 'HTTP /v1/use · MCP · Node SDK' },
    { label: 'Stack', value: 'Rust core · Node API' },
    { label: 'License', value: 'AGPL-3.0' },
  ],
  faq: [
    { q: 'When can I use it?', a: 'It’s in active development. The spec and tool schema are locked; v0.1.0 — Linux desktop driver, container sandbox, record/replay, and the Claude-Code MCP integration — targets 2026-07-30. Windows/macOS, then Android/iOS, then web and VR follow. Join the waitlist to get the first build.' },
    { q: 'What devices does it drive today?', a: 'One: a Linux desktop over X11, running in a container. That is the honest answer, and it is what our own README says. The architecture is one namespace across every device class — Windows, macOS, Android, iOS, headless web, and VR (Quest 3 / visionOS) — with each device a driver implementing the same UseDriver Rust trait so the tool surface never changes. Those other drivers are specified in detail but not written yet, so please read them as roadmap, not as capability you would get today.' },
    { q: 'Which models and agents can use it?', a: 'Any. XENO Use is the hands, not the brain — point Claude, GPT, Gemini or a fully local model at it over the OpenAI-compatible HTTP API, the native MCP server, or the Anthropic computer-use bridge. The Node SDK exists today; Python and Rust SDKs are planned and not yet published.' },
    { q: 'Is it safe to let an agent control my machine?', a: 'Agents don’t get host access by default. Today there is one sandbox — a Docker/Podman container with egress control — and that is where sessions run. Snapshot-VM, cloud and real-device sandboxes are specified but not built, and "local" (your real machine) is designed to be strictly opt-in. Each step is checked against the accessibility tree so replay fails fast on drift, and screenshot retention is configurable down to delete-on-close.' },
    { q: 'What is a `.xuse` tape?', a: 'A single self-contained file recording everything the agent did — a manifest, one action per line, a screenshot and accessibility snapshot per step, optionally video. It’s replayable against the same snapshot, shareable, diffable, and trainable: the closest thing to a git commit for agent behavior.' },
    { q: 'Is it open source?', a: 'Yes — AGPL-3.0. The substrate is copyleft so no one can fork it into a proprietary hosted competitor, but building agents on top of it is fine. You can self-host the whole thing; cloud sandboxes are opt-in.' },
  ],
  seo: {
    title: 'XENO Use — one API to control any device',
    description: 'The agent’s hands: one OpenAI-compatible verb namespace to see, click, type and replay, designed so the same schema reaches desktop, mobile, web and VR. v0.1 ships a Linux desktop driver in a container; other device classes are roadmap. Record replayable .xuse tapes. Self-hostable, AGPL-3.0. Coming soon.',
  },
};

export default use;

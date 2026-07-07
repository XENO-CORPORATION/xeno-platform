import type { ProductContent } from './_types';

/* XENO Use — sourced from ../xeno-use (README + SPEC/ARCHITECTURE/ROADMAP).
 * Honest coming-soon framing: v0.0.1 scaffolded, spec + tool schema locked, no
 * drivers shipping yet; v0.1.0 (Linux desktop + container + record/replay + MCP)
 * targets 2026-07-30. CTA is the waitlist (delivery: soon). Every claim traces to
 * the repo; nothing invented. */
const use: ProductContent = {
  slug: 'use',
  hero: {
    headline: 'Give your agent hands — on any device.',
    sub: 'XENO Use is one OpenAI-compatible API to see, click, type, swipe and replay on any screen — desktop, mobile, web, or VR. One `use.*` verb namespace, dispatched to the right driver behind the scenes, with every session recorded as a replayable `.xuse` tape.',
    media: { type: 'mockup', src: 'use-hero', alt: 'XENO Use Inspector — a sandboxed device viewport with the accessibility overlay and click crosshair, alongside the live use.* action stream' },
    badges: ['Desktop · mobile · web · VR', 'OpenAI-compatible + MCP', '.xuse record & replay', 'AGPL-3.0'],
    note: 'In active development — v0.1 (Linux desktop + container sandbox + record/replay + MCP) targets 2026-07-30. Join the waitlist for the first build.',
  },
  trust: ['One tool surface for every device class', 'OpenAI-compatible HTTP + native MCP + Anthropic bridge', 'AGPL-3.0 · self-hostable, cloud is opt-in'],
  highlights: [
    { value: 'One namespace', label: 'use.* on every device' },
    { value: '.xuse tapes', label: 'Record · replay · diff' },
    { value: 'Any model', label: 'Claude · GPT · Gemini · local' },
    { value: 'Self-hosted', label: 'Rust core, single binary' },
  ],
  features: [
    {
      eyebrow: 'One namespace',
      icon: 'MonitorSmartphone',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'One verb. Every device.',
      desc: 'The agent calls use.click, use.type and use.screenshot — it never cares whether the target is a Windows VM, a real Android phone, a headless Chromium tab, or a Quest 3. The substrate routes it to the right driver.',
      bullets: [
        'use.click · type · swipe · scroll · key · screenshot — one schema',
        'Desktop (Windows/macOS/Linux), Android, iOS, web, and VR next',
        'Native swipe & long-press on mobile, not faked mouse events',
        'Each driver implements the same UseDriver Rust trait',
      ],
    },
    {
      eyebrow: 'Sandboxes',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Run it anywhere — safely.',
      desc: 'Agents don’t get host access by default. Pick a sandbox per session — from your own machine to a throwaway container or a snapshot VM — decoupled from the driver, so the same driver runs against an emulator or a real device.',
      bullets: [
        'local · container · vm-hyperv/qemu/parallels · cloud · real device',
        'Container is the default for CI; local is opt-in only',
        'Same Android driver against an emulator or the phone on your desk',
        'VM-snapshot anchored replay for full determinism',
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
        'SDKs in Node, Python and Rust',
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
        'Signed driver registry; new device classes via the driver SDK',
        'a11y-tree assertion each step — fails fast when the world drifts',
        'Configurable screenshot retention, down to delete-on-close',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'use-tape', alt: 'The .xuse tape inspector — a filmstrip of recorded frames, the selected action’s params and result, correct/incorrect labeling, and the Ed25519 signature line' },
  ],
  useCases: [
    { title: 'Computer-use agents', icon: 'Bot', desc: 'Give any LLM a real pair of hands — one tool surface to operate desktop, mobile and web, instead of wiring a device-specific SDK per target.' },
    { title: 'Agent training & eval', icon: 'GitBranch', desc: 'Record real action trajectories as .xuse tapes, replay them against a fixed snapshot, and diff runs to measure drift — RL- and eval-ready data.' },
    { title: 'Self-hosted automation', icon: 'Lock', desc: 'Run the substrate on your own machine or a CI container — your screens, secrets and tapes never leave your infrastructure.' },
  ],
  howItWorks: [
    { step: '1', title: 'Self-host it', desc: 'curl the installer and run `xeno-use serve --port 7780` — no Docker needed for local desktop.' },
    { step: '2', title: 'Acquire a device', desc: 'Pick a device + sandbox — desktop/mobile/web against local, container or a snapshot VM.' },
    { step: '3', title: 'Act & record', desc: 'Call use.click / type / screenshot from any agent; record the session to a replayable .xuse tape.' },
  ],
  comparison: {
    competitor: 'most computer-use tools',
    rows: [
      { feature: 'One verb API across device classes', xeno: true, them: 'Device-specific' },
      { feature: 'Desktop + mobile + web + VR', xeno: true, them: 'Usually one target' },
      { feature: 'Replayable, diffable recording format', xeno: '.xuse tapes', them: false },
      { feature: 'Self-host, not per-minute billed', xeno: true, them: 'Often cloud-metered' },
      { feature: 'Model-agnostic (HTTP · MCP · Anthropic bridge)', xeno: true, them: 'Often one vendor' },
      { feature: 'Shipping today, proven in production', xeno: 'In development', them: true },
    ],
  },
  specs: [
    { label: 'Status', value: 'Coming soon · v0.1 in dev' },
    { label: 'Interface', value: 'HTTP /v1/use · MCP · SDKs' },
    { label: 'Stack', value: 'Rust core · Node API' },
    { label: 'License', value: 'AGPL-3.0' },
  ],
  faq: [
    { q: 'When can I use it?', a: 'It’s in active development. The spec and tool schema are locked; v0.1.0 — Linux desktop driver, container sandbox, record/replay, and the Claude-Code MCP integration — targets 2026-07-30. Windows/macOS, then Android/iOS, then web and VR follow. Join the waitlist to get the first build.' },
    { q: 'What devices will it drive?', a: 'One namespace across every device class: desktop (Windows, macOS, Linux), Android, iOS, headless web, and VR (Quest 3 / visionOS) later. Each device is a driver implementing the same UseDriver Rust trait, so the tool surface never changes.' },
    { q: 'Which models and agents can use it?', a: 'Any. XENO Use is the hands, not the brain — point Claude, GPT, Gemini or a fully local model at it over the OpenAI-compatible HTTP API, the native MCP server, or the Anthropic computer-use bridge. SDKs ship for Node, Python and Rust.' },
    { q: 'Is it safe to let an agent control my machine?', a: 'Agents don’t get host access by default — you choose a sandbox per session (container or a snapshot VM), and local (your real machine) is strictly opt-in. Each step is checked against the accessibility tree so replay fails fast on drift, and screenshot retention is configurable down to delete-on-close.' },
    { q: 'What is a `.xuse` tape?', a: 'A single self-contained file recording everything the agent did — a manifest, one action per line, a screenshot and accessibility snapshot per step, optionally video. It’s replayable against the same snapshot, shareable, diffable, and trainable: the closest thing to a git commit for agent behavior.' },
    { q: 'Is it open source?', a: 'Yes — AGPL-3.0. The substrate is copyleft so no one can fork it into a proprietary hosted competitor, but building agents on top of it is fine. You can self-host the whole thing; cloud sandboxes are opt-in.' },
  ],
  seo: {
    title: 'XENO Use — one API to control any device',
    description: 'The agent’s hands: one OpenAI-compatible verb namespace to see, click, type, swipe and replay on desktop, mobile, web or VR. Record replayable .xuse tapes. Self-hostable, AGPL-3.0. Coming soon.',
  },
};

export default use;

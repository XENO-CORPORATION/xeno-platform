import type { ProductContent } from './_types';

/* XENO Browser — sourced from ../xeno-browser (README.md + SPEC.md). A CONNECT,
 * Layer-3 product, catalog status beta / delivery desktop → download framing.
 * Public beta as of 0.2.0 (Windows build live; unsigned preview; macOS & Linux
 * to follow). The page sells the thesis (agent-native file I/O) and the design.
 * Every claim traces to SPEC §2 (file-I/O wall), §5 (verbs), §6 (.xbrowser),
 * §7 (security), §16 (locked decisions). */
const browser: ProductContent = {
  slug: 'browser',
  hero: {
    headline: 'The browser where your agent has hands, not just eyes.',
    sub: 'XENO Browser is real Chromium for you — and the first browser an AI agent can fully drive from a terminal. It browses, reads, clicks and types like any web agent, and — uniquely — uploads and downloads files by path, with no OS file dialog in the way.',
    media: { type: 'mockup', src: 'browser-hero', alt: 'XENO Browser — an AI agent attaches a file to a web composer by path while a scoped-consent prompt asks to approve the host-path upload' },
    badges: ['Real Chromium', 'Agentic file I/O', '.xbrowser Spaces', 'Private by default'],
    note: 'Public beta — download the Windows build now (unsigned preview; macOS & Linux coming soon). No CAPTCHA-solving, ever.',
  },
  trust: [
    'Part of the XENO platform — one sign-in',
    'Real Chromium via Electron — sites behave exactly as in Chrome',
    'Inherits the xeno-use safety model — bounded mounts, scoped consent',
  ],
  highlights: [
    { value: 'Upload by path', label: 'No OS file dialog' },
    { value: 'Terminal-drivable', label: 'Agents get real hands' },
    { value: 'Real Chromium', label: 'Sites just work' },
    { value: 'Private by default', label: 'No browsing telemetry' },
  ],
  features: [
    {
      eyebrow: 'The differentiator',
      icon: 'Upload',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Upload and download by path — no OS dialog',
      desc: 'Clicking “Attach” on Gmail, Slack, X or a job portal fires a native OS file-picker that no terminal or extension agent can reach. Because XENO Browser owns the engine, it injects files by path straight into the page — and captures downloads the same way in reverse.',
      bullets: [
        'attach_file by path — the native dialog never opens, no click-through',
        'Handles drag-and-drop-only widgets, not just <input type=file>',
        'download straight to an exact path — no native Save dialog',
        'Pipe artifacts from other XENO apps — Pixel PNG → tweet, Motion clip → YouTube',
      ],
    },
    {
      eyebrow: 'Agent-native',
      icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'A native operator, not a bolt-on',
      desc: 'The agent runs in the main process with a built-in CDP bridge — no debugger infobar, no detaching, no policy gate. It drives any tab, spoken to from xeno-agent-cli, the SDK, or XENO Hub.',
      bullets: [
        'Navigate, read (DOM / a11y / text / markdown), find, click, type, scroll',
        'Main-process CDP — never detaches mid-run',
        'Reaches pages an extension can’t (privileged / policy-gated)',
        'Implements xeno-use’s use-driver-web contract as a native driver',
      ],
    },
    {
      eyebrow: 'Spaces',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Your tabs, pins and agent context — saved',
      desc: 'A Space is a saved browsing context: its tabs, pins, profile, and the agent’s task plus the mount points it’s allowed to touch. Save it as a .xbrowser file, reopen it, or hand it off.',
      bullets: [
        'Saved sets of tabs + pins + profile (an Arc-Spaces analog)',
        'Per-Space agent context and allowed mount points',
        'Portable .xbrowser format with autosave + crash recovery',
        'Profile / multi-account isolation per Space',
      ],
    },
    {
      eyebrow: 'Safety',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'The dialog was a security feature — we kept the consent',
      desc: 'A browser that silently attaches any local file to any site is an exfiltration footgun. XENO Browser inherits the xeno-use capability model: the agent acts freely within scope, and stepping outside asks first.',
      bullets: [
        'Bounded mount points — file I/O stays inside what you allow',
        'No “..” path traversal or symlink escapes',
        'Confirmation prompts + budgets for host-path file ops',
        'No CAPTCHA bypass, ever — a hard refusal at the control plane',
      ],
    },
    {
      eyebrow: 'Engine & privacy',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Real Chromium, local-first, private',
      desc: 'Real Chromium so every site behaves exactly as in Chrome, with agent inference routed through xeno-rt for on-device models — and no telemetry on your browsing.',
      bullets: [
        'No telemetry on your browsing',
        'Agent inference routes through xeno-rt — local models where possible',
        'Built on the shared React 19 + Electron + Zustand XENO stack',
        'One XENO sign-in across the whole platform',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'browser-spaces', alt: 'XENO Browser — the Spaces switcher: saved .xbrowser Spaces with their tabs, pins and per-Space agent context, and a download-to-path confirmation' },
  ],
  useCases: [
    { title: 'Post & publish for you', icon: 'Sparkles', desc: 'Tell the agent to publish — it opens the composer, writes the caption, and attaches the file by path. No dragging through Finder.' },
    { title: 'Terminal & server agents', icon: 'Terminal', desc: 'Drive a real browser from xeno-agent-cli or an unattended server run — uploads and downloads finally work without a human at the OS dialog.' },
    { title: 'Cross-app pipelines', icon: 'Boxes', desc: 'Pixel exports a PNG, Motion renders a clip — pipe the artifact straight into a web upload. Something no third-party browser can do.' },
  ],
  howItWorks: [
    { step: '1', title: 'Open a Space', desc: 'Launch XENO Browser and pick a Space — its tabs, profile, and the mount points the agent may touch.' },
    { step: '2', title: 'Give the agent a task', desc: 'From the sidebar or your terminal: “post this render to X,” or “download the invoices.”' },
    { step: '3', title: 'Approve the reach', desc: 'The agent works within scope; a host-path file op asks first, so you stay in control.' },
  ],
  comparison: {
    competitor: 'most browsers',
    rows: [
      { feature: 'Real Chromium — sites just work', xeno: true, them: true },
      { feature: 'AI agent built into the browser', xeno: 'Native', them: 'Extensions' },
      { feature: 'Agent uploads/downloads files by path (no OS dialog)', xeno: true, them: false },
      { feature: 'Terminal / server-drivable agent', xeno: true, them: false },
      { feature: 'Saved Spaces with agent context (.xbrowser)', xeno: true, them: 'Some' },
      { feature: 'Mature extension & add-on ecosystem', xeno: 'Growing', them: true },
      { feature: 'Availability', xeno: 'Beta (Windows)', them: 'Shipping' },
    ],
  },
  specs: [
    { label: 'Engine', value: 'Electron + WebContentsView (Chromium)' },
    { label: 'Platforms', value: 'Windows · macOS · Linux' },
    { label: 'Project format', value: '.xbrowser (saved Spaces)' },
    { label: 'Status', value: 'Public beta · v0.2.0' },
  ],
  faq: [
    { q: 'What makes XENO Browser different from a normal browser?', a: 'It’s a real Chromium browser for you, but the AI agent is native to it — not a plugin. The headline capability is agentic file I/O: the agent uploads and downloads files by path, bypassing the native OS file-picker and Save dialogs that block every other web agent.' },
    { q: 'Why can’t a normal extension or terminal agent just upload a file?', a: 'Clicking “Attach” makes the browser ask the OS to open a native file-picker dialog, which is OS chrome — not web content. Page JavaScript can’t forge a file list from a path, and an extension’s debugger can detach or be policy-blocked. Because XENO Browser owns the engine, it sets the input’s files directly via main-process CDP, so the dialog never opens.' },
    { q: 'Is it safe to let an agent touch my files?', a: 'Yes — the native dialog is treated as a security feature we replace with scoped consent, not remove. File I/O is confined to bounded mount points, “..” path traversal is rejected, and host-path operations ask for confirmation or run on a capability budget. And it never bypasses CAPTCHAs.' },
    { q: 'What is a Space / the .xbrowser format?', a: 'A Space is a saved browsing context — its tabs, pins, profile, and the agent’s task plus allowed mount points (an Arc-Spaces analog). It serializes to a portable .xbrowser file with autosave and crash recovery. Secrets like cookies and tokens live in the profile store, never in a shareable Space file.' },
    { q: 'Does it replace the XENO browser extension?', a: 'No — they complement each other. xeno-extension puts the agent inside your existing Chrome/Edge/Firefox; XENO Browser is the agent inside our own browser, with the full control an extension can’t get. Both implement xeno-use’s use-driver-web contract.' },
    { q: 'When can I use it?', a: 'Now — it’s in public beta. Download the Windows build (v0.2.0, an unsigned preview; macOS & Linux are coming). It ships the file-I/O differentiator working end-to-end from xeno-agent-cli.' },
  ],
  seo: {
    title: 'XENO Browser — the agent-native web browser',
    description: 'Real Chromium for you, and the first browser an AI agent can fully drive from a terminal — uploading and downloading files by path with no OS dialog. Saved Spaces (.xbrowser), scoped consent, private by default. In public beta — download for Windows.',
  },
};

export default browser;

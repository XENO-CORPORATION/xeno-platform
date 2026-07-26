import type { ProductContent } from './_types';

/* XENO Hub — sourced from ../xeno-hub (README + the real Electron renderer:
 * HubInterface, CreativeAppsContent, TitleBar, StorePage, creativeAppsStore,
 * marketplaceStore, updater). Shipping desktop launcher (v0.5.x). Honest note:
 * a couple of panels (OS/containers, home Showcase) are still preview/mock.
 * PLATFORMS: only a Windows installer is published — every release in the R2
 * feed is windows-only. Do not claim macOS/Linux until those builds ship. */
const hub: ProductContent = {
  slug: 'hub',
  hero: {
    headline: 'One home for every XENO app.',
    sub: 'XENO Hub installs, updates, and launches the whole XENO stack from a single window — your creative apps, a built-in agent, a marketplace of apps, agents and models, and one credit balance that follows you everywhere.',
    media: { type: 'mockup', src: 'hub-hero', alt: 'XENO Hub desktop launcher — the Studio app list with Pixel, Motion, Sound install/launch states, credits and auto-update in the title bar' },
    badges: ['Windows desktop', 'Free', 'Auto-updating', 'Marketplace built in'],
    note: 'Free desktop app for Windows · signs in with your XENO account. macOS and Linux builds are not out yet. A few panels (OS/containers, Showcase) are still preview.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Local-first: your ~/.xeno cache works offline', 'Electron · React 19 · open update feed'],
  highlights: [
    { value: 'One launcher', label: 'Every XENO app' },
    { value: 'Apps · agents · models', label: 'One marketplace' },
    { value: 'Auto-updates', label: 'Hub + every app' },
    { value: 'Free', label: 'Windows desktop' },
  ],
  features: [
    {
      eyebrow: 'App launcher',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Install, update and launch — in one place',
      desc: 'Every XENO desktop app, organized into Studio, Office and Corpo. One click installs, launches, or stops an app; the Hub tracks versions and surfaces updates for you.',
      bullets: [
        'Install / launch / stop / uninstall from a single list',
        'Live install progress with speed and ETA',
        'Per-app settings: open location, check updates, disk usage',
        'Studio · Office · Corpo — apps grouped the way you work',
      ],
    },
    {
      eyebrow: 'Marketplace',
      icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'A store for apps, agents, plugins and models',
      desc: 'The built-in Store is one content-typed marketplace — not three. Browse native and sandboxed apps, agents, workbench panels & plugins, and inference models.',
      bullets: [
        'Shelves: XENO apps, community apps, agents, plugins, models',
        'Official · Verified · Community trust tiers',
        'Buy, subscribe, rent, or pay-per-use — metered on credits',
        'Capability consent before an agent or plugin gets access',
      ],
    },
    {
      eyebrow: 'Work surfaces',
      icon: 'Bot',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'An agent, a workbench, and tools — in tabs',
      desc: 'Beyond launching apps, the Hub is a workspace: switch between Hub, Agent, Code, IDE and Chat tabs, and open a drawer of built-in media tools.',
      bullets: [
        'Hub · Agent · Code · IDE · Chat tabs, duplicate or close',
        'Tools: image-gen, upscale, background removal, capture, Whisper, LaTeX…',
        'Command palette on Ctrl+K, keyboard-driven throughout',
        'System tray, global hotkeys for screenshot & voice',
      ],
    },
    {
      eyebrow: 'Always current',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Updates that just happen',
      desc: 'The Hub keeps itself and every installed app up to date from the XENO update feed — checking in the background and letting you update on your terms.',
      bullets: [
        'Background update checks from updates.xenostudio.ai',
        'Download progress in the title bar; restart-to-install',
        'Per-app "update available" with the changelog inline',
        'Open version feed — the same one the website reads',
      ],
    },
    {
      eyebrow: 'Credits, built in',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'One balance for cloud models',
      desc: 'Your credit balance lives in the title bar and fuels cloud AI across every XENO tool. Top up, see history, and get warned before you run dry.',
      bullets: [
        'Live balance always in view',
        'Buy usage with a saved card; full transaction history',
        'Low-balance warnings before you hit a limit',
        'Powers cloud models via api.xenostudio.ai',
      ],
    },
    {
      eyebrow: 'Yours & local-first',
      icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.14), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'One account, offline-ready',
      desc: 'Sign in once with a device-flow + QR flow; your data lives in ~/.xeno and stays authoritative offline. Dark or light, synced across restarts.',
      bullets: [
        'OAuth device-flow sign-in with QR code',
        'Local ~/.xeno cache: settings, workspaces, agent chats',
        'Works offline; syncs when you reconnect',
        'Dark & light themes, preferences that persist',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'hub-store', alt: 'XENO Hub Marketplace — the Store tab with shelves for apps, agents, plugins and models, trust tiers, and credit-metered pricing' },
  ],
  useCases: [
    { title: 'Creators & studios', icon: 'Sparkles', desc: 'Install Pixel, Motion and Sound, keep them current, and launch them all from one window — no scattered installers.' },
    { title: 'Builders & agents', icon: 'Bot', desc: 'Run the built-in agent, Code and IDE, then pull panels, plugins and models straight from the marketplace.' },
    { title: 'One account, one balance', icon: 'Cpu', desc: 'Sign in once and spend a single credit balance across every cloud model in the ecosystem.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & sign in', desc: 'Grab the Windows build and sign in with your XENO account — device flow with a QR code.' },
    { step: '2', title: 'Install your apps', desc: 'Open Studio, Office or Corpo and install the apps you want; watch progress and launch when ready.' },
    { step: '3', title: 'Launch & stay current', desc: 'Run apps, browse the marketplace, top up credits — the Hub keeps everything up to date.' },
  ],
  comparison: {
    competitor: 'most app stores',
    rows: [
      { feature: 'Installs, updates & launches desktop apps', xeno: true, them: true },
      { feature: 'Built-in AI agent, IDE & media tools', xeno: true, them: false },
      { feature: 'Marketplace of apps, agents, plugins & models', xeno: true, them: 'Apps only' },
      { feature: 'Credits & cloud-model billing built in', xeno: true, them: false },
      { feature: 'Local-first, works offline', xeno: true, them: 'Varies' },
      { feature: 'Huge existing catalog', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free', them: 'Free / paid' },
    ],
  },
  specs: [
    { label: 'Platforms', value: 'Windows (x64)' },
    { label: 'Engine', value: 'Electron 33 · React 19' },
    { label: 'Account', value: 'XENO sign-in (device flow)' },
    { label: 'Status', value: 'Shipping · v0.5.x' },
  ],
  faq: [
    { q: 'What is XENO Hub?', a: 'It’s the desktop launcher for the whole XENO ecosystem — one window to install, update and launch every XENO app, run a built-in agent and tools, browse the marketplace, and manage your credits.' },
    { q: 'Is it free?', a: 'Yes, the Hub itself is a free download. Some cloud AI features spend credits, and paid marketplace items (agents, models, subscriptions) meter on your credit balance.' },
    { q: 'Which platforms are supported?', a: 'Windows today — that’s the only build we publish. macOS and Linux are planned; the download page lists every build and past version we actually ship, so it will show them as soon as they exist.' },
    { q: 'How do updates work?', a: 'The Hub checks the XENO update feed in the background and updates itself, and it detects when your installed apps have a new version — you update with one click and a restart. It’s the same open version feed the website reads.' },
    { q: 'What’s in the marketplace?', a: 'One store with shelves for native XENO apps, sandboxed community apps, agents (Minds and swarms), workbench panels & plugins, and inference models — each tagged Official, Verified or Community, with capability consent before anything gets access.' },
    { q: 'Does it work offline?', a: 'The Hub is local-first: your settings, workspaces and agent chats live in ~/.xeno and stay authoritative offline. Cloud features (models, marketplace, sign-in) reconnect when you’re back online.' },
  ],
  seo: {
    title: 'XENO Hub — the launcher for every XENO app',
    description: 'One desktop app to install, update and launch every XENO tool — with a built-in agent, a marketplace of apps, agents and models, and one credit balance. Free for Windows.',
  },
};

export default hub;

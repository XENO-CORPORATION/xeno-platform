import type { ProductContent } from './_types';

/* XENO Canvas — sourced from ../xeno-canvas (README + SPEC + the real renderer
 * in src/renderer/src). v0.3.0 is the first public release (Windows beta) —
 * the CTA is a real download. Every feature
 * claim maps to shipped code in CHANGELOG.md; cross-repo-gated work (networked
 * multiplayer, boolean geometry, AI, prototyping) is called out as such. */
const canvas: ProductContent = {
  slug: 'canvas',
  hero: {
    headline: 'Design the whole system, together, in real time.',
    sub: 'A multiplayer product- and UI-design tool — components, variants, design tokens, auto-layout, and dev handoff that actually compiles. Built multiplayer-native from the first commit, on the same vector engine as the rest of the XENO platform.',
    media: { type: 'mockup', src: 'canvas-hero', alt: 'XENO Canvas editor — layers and pages, an auto-layout sign-up frame with a token-bound button, live multiplayer cursors, and a CSS dev-handoff panel' },
    badges: ['Windows (beta)', 'Real-time multiplayer', 'Components + tokens', 'v0.3.0'],
    note: 'First public beta — download for Windows. macOS and Linux builds follow.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Built on @xeno/core, the shared vector engine', 'Multiplayer-native from the first commit'],
  highlights: [
    { value: 'Two designers, one file', label: 'Live multiplayer' },
    { value: 'Components + tokens', label: 'One source of truth' },
    { value: 'CSS & Tailwind', label: 'Handoff that compiles' },
    { value: '.xcanvas', label: 'Open single-file format' },
  ],
  features: [
    {
      eyebrow: 'Collaborate',
      icon: 'Users',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Multiplayer, not bolted on',
      desc: 'Single-user is just the one-person case of multi-user. The document, history, and every edit are CRDT-compatible from the ground up — so two people in one file is the default, not a feature flag.',
      bullets: [
        'Live cursors, name tags, and selection presence',
        'Every edit is an op that replicates and merges',
        'Multiplayer-aware undo — you undo only your own work',
        'Local cross-window transport works today; networked xeno-comms is next',
      ],
    },
    {
      eyebrow: 'Systematize',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Components, variants & instances',
      desc: 'Build a button once, reuse it everywhere. Edit the main component and every instance updates; override per instance without breaking the link; swap variants from a dropdown.',
      bullets: [
        'Create components and component sets with variants',
        'Per-instance overrides that survive main-component edits',
        'Variant switching from the inspector',
        'Detach an instance to break the link when you need to',
      ],
    },
    {
      eyebrow: 'Style',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Design tokens & auto-layout',
      desc: 'Define color, typography, and spacing once and reference them everywhere. Change a token and every bound node recolors live. Lay out with a real flexbox engine that reflows as content changes.',
      bullets: [
        'Color / number / typography / shadow tokens with modes + aliasing',
        'Bind any fill or text style to a token — edits propagate instantly',
        'Auto-layout with flex-wrap, per-side padding, and hug/fill sizing',
        'Per-child Fill and Absolute controls, nested reflow',
      ],
    },
    {
      eyebrow: 'Draw',
      icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Real design fidelity',
      desc: 'Everything you need to build a screen at real fidelity: text and stroke controls, gradients and effects, image fills, masks, and a pen tool with editable vector anchors.',
      bullets: [
        'Text, stroke, gradient (linear/radial) and shadow/blur effects',
        'Drag-drop image fills with fit/crop/tile modes',
        'Masks that clip, and a pen tool with draggable anchor points',
        'Boolean geometry lands via the @xeno/core path kernel',
      ],
    },
    {
      eyebrow: 'Hand off',
      icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Inspect → code that compiles',
      desc: 'Select any layer and copy CSS or Tailwind that actually runs — token-aware, so bound values emit as var(--token) instead of a frozen hex.',
      bullets: [
        'Per-node CSS and Tailwind output',
        'Token-aware: emits var(--token), not a baked value',
        'Export selections or whole pages to PNG (2×) and SVG',
        'Compose / SwiftUI / Style-Dictionary output on the roadmap',
      ],
    },
    {
      eyebrow: 'Extend',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'AI and agents, on your platform',
      desc: 'An Agent panel is wired into the shell for the design-assist work the XENO stack makes possible — generate a form, refactor a token system, audit accessibility — with inference through the XENO runtime.',
      bullets: [
        'Agent panel embedded in the editor (xeno-agent-sdk)',
        'Generate / refactor / audit via the xeno-rt runtime',
        'Pen, tokens, components and handoff already shipping',
        'AI features and prototyping are the next milestones',
      ],
    },
  ],
  useCases: [
    { title: 'Product & UI designers', icon: 'Users', desc: 'Draw real screens with auto-layout, style them with tokens, and wire components — the full daily design loop in one desktop app.' },
    { title: 'Design-system teams', icon: 'Boxes', desc: 'Keep components, variants, and tokens as the single source of truth, and reuse them across every file and page.' },
    { title: 'Design → dev handoff', icon: 'Terminal', desc: 'Hand engineers CSS/Tailwind that compiles and tokens that map to variables — no more pixel-guessing from a static export.' },
  ],
  howItWorks: [
    { step: '1', title: 'Design', desc: 'Draw frames, lay them out with auto-layout, and style with tokens at real fidelity.' },
    { step: '2', title: 'Systematize', desc: 'Turn selections into components with variants, and reuse them as instances with overrides.' },
    { step: '3', title: 'Hand off', desc: 'Open Inspect, copy CSS/Tailwind that compiles, and export assets to PNG or SVG.' },
  ],
  comparison: {
    competitor: 'most design tools',
    rows: [
      { feature: 'Components, variants & instances', xeno: true, them: true },
      { feature: 'Design tokens with modes', xeno: true, them: 'Add-on / limited' },
      { feature: 'Dev handoff → CSS/Tailwind that compiles', xeno: true, them: 'Partial' },
      { feature: 'Open single-file project format', xeno: '.xcanvas (JSON)', them: false },
      { feature: 'Runs on the desktop, offline', xeno: true, them: 'Browser-first' },
      { feature: 'Networked real-time multiplayer today', xeno: 'In progress', them: true },
      { feature: 'Mature plugin & template ecosystem', xeno: 'Coming', them: true },
    ],
  },
  specs: [
    { label: 'Platforms', value: 'Windows (beta) · macOS & Linux coming' },
    { label: 'Project format', value: '.xcanvas (single-file JSON)' },
    { label: 'Built on', value: 'Electron · React 19 · @xeno/core' },
    { label: 'Status', value: 'v0.3.0 · first public beta' },
  ],
  faq: [
    { q: 'Can I use XENO Canvas yet?', a: 'Yes — v0.3.0 is the first public beta, available now for Windows. The design core is real: components with variants, design tokens with modes, auto-layout, pen/vector editing, pages, PNG/SVG export, CSS/Tailwind dev handoff, and local multiplayer. Networked multiplayer, prototyping, and rich text are the next milestones — expect beta rough edges.' },
    { q: 'What already works today?', a: 'The design core: drawing tools, undo/redo, components with variants and per-instance overrides, design tokens with modes, an auto-layout flexbox engine, text/stroke/gradient/effect controls, image fills and masks, a pen tool with editable anchors, multi-page files, PNG/SVG export, and CSS/Tailwind dev handoff.' },
    { q: 'Is it really multiplayer?', a: 'The architecture is multiplayer-native: the document and history are CRDT-compatible and every edit is an op that replicates. A local cross-window transport proves it end-to-end today; the networked transport over xeno-comms is the next milestone.' },
    { q: 'How is it different from XENO Pixel?', a: 'Pixel is raster and Illustrator-style print vector — single-author, mostly static. Canvas is the live, multi-author, component-driven product-design surface that Figma defined. Canvas can place rasters but won’t ship a brush engine.' },
    { q: 'Will my Figma files import?', a: 'A best-effort Figma import is planned, but it’s a post-1.0 item — it won’t be in the first releases. The native format is .xcanvas, a single-file JSON project with autosave and crash recovery.' },
    { q: 'What will it cost?', a: 'Pricing will be announced closer to release. It’s part of the XENO platform and uses one sign-in across the ecosystem.' },
  ],
  seo: {
    title: 'XENO Canvas — multiplayer product & UI design',
    description: 'A multiplayer product- and UI-design tool with components, variants, design tokens, auto-layout, and dev handoff that compiles. Multiplayer-native, desktop, .xcanvas format. Coming soon — join the waitlist.',
  },
};

export default canvas;

import type { ProductContent } from './_types';

/* XENO Motion — sourced from ../xeno-motion (README + the real renderer under
 * src/renderer/src: App.tsx Dockview workspace, Timeline, Viewer/ProgramMonitor,
 * ColorPanel + scopes, AgentSidebar, engine/*). A `delivery: desktop`, beta
 * product: it unifies an NLE and a motion-graphics toolset in one app, on
 * WebCodecs + Web Audio with a WebGPU fast path for colour, with AI built in. Honest
 * beta framing — real features, but a public test, not a decade-old suite. */
const motion: ProductContent = {
  slug: 'motion',
  hero: {
    headline: 'One timeline for editing and motion graphics.',
    sub: 'XENO Motion unifies the cut and the composite — a hardware-accelerated editor and a motion-graphics toolset in a single app. Grade with 3D LUTs and broadcast scopes, keyframe, key, track, and let AI find your scene cuts, reframe for vertical and balance a shot — without round-tripping between two programs.',
    media: { type: 'mockup', src: 'motion-hero', alt: 'XENO Motion editor — media bin, program monitor, the inspector and a multi-track timeline with clips, a cross-dissolve, keyframes and a playhead' },
    badges: ['Windows desktop', 'WebCodecs + WebGPU', 'AI built in', 'Free tier + credits'],
    note: 'Beta (public test) · unsigned installer, so Windows shows a SmartScreen warning. Colour effects use your GPU when available and fall back to the CPU. Some AI runs in the cloud through your XENO credits.',
  },
  trust: [
    'Part of the XENO platform — one sign-in',
    'Hardware decode and encode through WebCodecs',
    'Reads H.264, H.265, VP9 and AV1',
  ],
  highlights: [
    { value: 'Edit + motion', label: 'One unified app' },
    { value: 'WebGPU', label: 'GPU colour effects' },
    { value: 'AI built in', label: 'Scene cuts · reframe · auto color' },
    { value: '< 2s', label: 'Cold start' },
  ],
  features: [
    {
      eyebrow: 'Unified',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Cut and composite in one place',
      desc: 'No more bouncing a sequence between an editor and a compositor. One project, one timeline, one render — the edit and the motion graphics live together.',
      bullets: [
        'Multi-track timeline with a full pro toolset',
        'Razor, ripple, roll, slip, slide and speed-ramp editing',
        'J/K/L shuttle, snapping, markers and multicam',
        'Dockable, savable workspaces (editing, color, audio, effects…)',
      ],
    },
    {
      eyebrow: 'GPU pipeline',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Hardware decode, GPU colour',
      desc: 'Frames decode on your GPU through WebCodecs, and per-pixel colour work runs as a WebGPU compute shader with a bit-exact CPU fallback — so the result is the same on any machine, just faster on a capable one.',
      bullets: [
        'WebCodecs hardware decode: H.264, H.265, VP9, AV1',
        'Colour: lift/gamma/gain, curves, 3D LUTs (.cube)',
        'WebGPU compute for per-pixel colour, CPU fallback',
        'Effects: chroma key, blur, sharpen, keying',
      ],
    },
    {
      eyebrow: 'Compositing',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#101a17,#070707 74%)',
      title: 'Animate on the same timeline',
      desc: 'Motion graphics are not a second document. Every clip property is keyframeable in place, with a curve editor, so titles, transforms and effects animate beside the cut instead of in another app.',
      bullets: [
        'Bezier keyframes with a curve editor',
        'Per-character text animators for titles',
        'Shape layers, particles and a 3D camera',
        'Speed ramps as a time-remap curve',
      ],
    },
    {
      eyebrow: 'AI',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI that does the tedious parts',
      desc: 'Find the cuts in a long take, reframe for vertical and balance a shot’s color — one click each, from the same app.',
      bullets: [
        'Scene-cut detection on any video clip',
        'Auto-reframe to the sequence aspect ratio',
        'Auto color — a histogram-based starting grade',
        'A built-in agent that can drive the timeline for you',
      ],
    },
    {
      eyebrow: 'Media & export',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Ingest anything, export fast',
      desc: 'Hardware decode via WebCodecs, hardware encode on export, and MP4 written by our own muxer — no FFmpeg in the app, and every build is checked by decoding its own output.',
      bullets: [
        'WebCodecs decode: H.264 / H.265 / VP9 / AV1',
        'Hardware-accelerated encode, using whatever the OS provides',
        'MP4 out (H.264, H.265, AV1) with AAC audio',
        'Background render queue — keep editing while it runs',
      ],
    },
    {
      eyebrow: 'Finishing',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Color and audio, room to finish',
      desc: 'Professional scopes and a real color page, plus a proper audio mixer and effects — the finishing tools that usually mean a second app.',
      bullets: [
        'Waveform, vectorscope, RGB parade and histogram',
        '3D-LUT grading (.cube) with a full primary grade',
        'Audio mixer with per-track EQ, compression and LUFS metering',
        'Round-trip audio to XENO Sound',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'motion-color', alt: 'XENO Motion color page — a graded program monitor, Lift/Gamma/Gain color wheels and waveform + vectorscope video scopes' },
    { type: 'mockup', src: 'motion-agent', alt: 'XENO Motion agent — an AI assistant importing, cutting and arranging a highlight edit on the timeline' },
  ],
  useCases: [
    { title: 'Editors & filmmakers', icon: 'Layers', desc: 'Assemble, trim and finish long-form and short-form on one timeline — with proxies, scopes and hardware export built in.' },
    { title: 'Motion & VFX artists', icon: 'Sparkles', desc: 'Keyframe, key, track and composite on the edit timeline without exporting to a separate motion-graphics tool.' },
    { title: 'Creators at volume', icon: 'Bot', desc: 'Hand the agent your rushes — it imports, cuts, arranges a rough assembly and reframes for every platform, and you review the result.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & open', desc: 'Get the Windows app, then create a sequence or open an .xmotion project.' },
    { step: '2', title: 'Cut & composite', desc: 'Import footage, edit on the timeline, add effects, grade and keyframe — with hardware decode throughout.' },
    { step: '3', title: 'Render or delegate', desc: 'Export with hardware encode, or ask the built-in agent to assemble, subtitle and reframe.' },
  ],
  comparison: {
    competitor: 'most pro video suites',
    rows: [
      { feature: 'Edit + motion graphics in one app', xeno: true, them: 'Two apps' },
      { feature: 'Hardware decode + GPU colour', xeno: 'WebCodecs + WebGPU', them: 'Partial' },
      { feature: 'Agent can drive the app directly', xeno: '250+ capabilities', them: false },
      { feature: 'AI: scene cuts · reframe · auto color', xeno: 'Built in', them: 'Add-ons' },
      { feature: 'Hardware-accelerated encode', xeno: true, them: true },
      { feature: 'Cold-start time', xeno: 'Under a second', them: 'Varies' },
      { feature: 'Mature plugin ecosystem', xeno: false, them: true },
      { feature: 'Price', xeno: 'Free tier + credits', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64)' },
    { label: 'Engine', value: 'WebCodecs · WebGPU · Web Audio (no FFmpeg)' },
    { label: 'Project format', value: '.xmotion (JSON)' },
    { label: 'Status', value: 'Beta (public test)' },
  ],
  faq: [
    { q: 'Is XENO Motion ready for production work?', a: 'It’s a public test build. The core editor — multi-track timeline, compositing, color, effects, audio and export — works today, and it’s honest beta: expect rough edges and missing polish next to a decade-old suite. Bring feedback.' },
    { q: 'Do I really not need a separate motion-graphics app?', a: 'That’s the core idea. Editing and motion graphics share one project and one timeline, so you keyframe, mask and composite without exporting to a second program.' },
    { q: 'What formats and codecs can it handle?', a: 'Hardware decode via WebCodecs for H.264, H.265, VP9 and AV1. Export is hardware-accelerated through WebCodecs to MP4, with AAC audio — Chromium hands the frames to whatever the OS provides, so on a capable Windows machine that is your GPU's encoder. Professional codecs such as ProRes and DNxHR are not supported yet, and MP4 is the only container written today.' },
    { q: 'What can the AI actually do?', a: 'Three one-click operations on a selected clip: scene-cut detection, auto-reframe to your sequence’s aspect ratio, and auto color (a histogram-based starting grade you then refine by hand). A built-in agent can drive the timeline for you — importing, cutting, arranging, applying effects and opening the export flow. Speech-to-text and stem separation are in development and not yet available.' },
    { q: 'Do I need a powerful computer?', a: 'Not especially. A WebGPU-capable GPU makes colour effects faster, but there is a bit-exact CPU fallback, so results are identical either way. A hardware encoder speeds up export a lot; without one it falls back to software and is slower.' },
    { q: 'How much does it cost?', a: 'There’s a free tier; heavier AI and cloud features draw on XENO platform credits. Full pricing is announced separately as it leaves beta.' },
  ],
  seo: {
    title: 'XENO Motion — video editing and motion graphics in one app',
    description: 'A video editor and motion-graphics toolset in a single app. Hardware decode and encode, GPU colour effects, 3D-LUT grading with broadcast scopes, and AI that finds scene cuts, reframes and grades. Beta on Windows — free tier + credits.',
  },
};

export default motion;

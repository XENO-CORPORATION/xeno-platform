import type { ProductContent } from './_types';

/* XENO Motion — sourced from ../xeno-motion (README + the real renderer under
 * src/renderer/src: App.tsx Dockview workspace, Timeline, Viewer/ProgramMonitor,
 * ColorPanel + scopes, AgentSidebar, engine/*). A `delivery: desktop`, beta
 * product: it unifies an NLE and a node-based motion-graphics engine in one app,
 * GPU-accelerated (WebGPU + WebCodecs + FFmpeg N-API), with AI built in. Honest
 * beta framing — real features, but a public test, not a decade-old suite. */
const motion: ProductContent = {
  slug: 'motion',
  hero: {
    headline: 'One timeline for editing and motion graphics.',
    sub: 'XENO Motion unifies the cut and the composite — a GPU-accelerated editor and a node-based motion-graphics engine in a single app. Grade with ACES, keyframe, key, track, and let AI transcribe, reframe and isolate — without round-tripping between two programs.',
    media: { type: 'mockup', src: 'motion-hero', alt: 'XENO Motion editor — media bin, program monitor, the inspector and a multi-track timeline with clips, a cross-dissolve, keyframes and a playhead' },
    badges: ['Windows desktop', 'WebGPU + WebCodecs', 'AI built in', 'Free tier + credits'],
    note: 'Beta (public test) · GPU features need a WebGPU-capable graphics card. Some AI runs in the cloud through your XENO credits.',
  },
  trust: [
    'Part of the XENO platform — one sign-in',
    'Hardware-accelerated: WebGPU · WebCodecs · NVENC / QSV',
    'Reads ProRes, DNxHR, BRAW, H.264 / H.265 and AV1',
  ],
  highlights: [
    { value: 'Edit + motion', label: 'One unified app' },
    { value: 'WebGPU', label: 'GPU compositing & color' },
    { value: 'AI built in', label: 'Transcribe · reframe · isolate' },
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
      title: 'GPU-accelerated, top to bottom',
      desc: 'WebGPU compute shaders composite every track, run every effect and grade every frame — with zero-copy VideoFrame import, so playback stays fluid.',
      bullets: [
        'WebGPU compositing: blend modes, transforms, masks',
        'Color: lift/gamma/gain, curves, 3D LUTs, ACES 2.0',
        'Effects: chroma key, blur, glow, GPU particles',
        'Cold start under 2 seconds',
      ],
    },
    {
      eyebrow: 'Compositing',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#101a17,#070707 74%)',
      title: 'A real node graph, not just layers',
      desc: 'Effects and compositing evaluate as a render-graph DAG — topologically sorted with dead-code elimination — so complex shots stay fast and predictable.',
      bullets: [
        'Node-based compositing graph (RenderGraph DAG)',
        'Transform, blend and mask nodes',
        'Bezier keyframes with curve editing',
        'Shape layers, kinetic type and 3D camera',
      ],
    },
    {
      eyebrow: 'AI',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI that does the tedious parts',
      desc: 'Transcribe interviews into a searchable, subtitle-ready timeline, reframe for vertical, isolate a voice, track an object or upscale old footage — from the same app.',
      bullets: [
        'Speech-to-text & subtitles (Whisper)',
        'Auto-reframe, scene detection, object tracking',
        'Voice isolation and audio denoise',
        'A built-in agent that can assemble a rough cut for you',
      ],
    },
    {
      eyebrow: 'Media & export',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Ingest anything, export fast',
      desc: 'Hardware decode via WebCodecs with an FFmpeg fallback for pro codecs, ALL-Intra proxies for instant seeking, and direct hardware encode on export.',
      bullets: [
        'WebCodecs H.264 / H.265 / VP9 / AV1 + FFmpeg for ProRes, DNxHR, BRAW',
        'Lazy ALL-Intra proxies — scrub without GOP lag',
        'Direct NVENC / QSV / VideoToolbox encode',
        'MP4, MOV, MKV and WebM out',
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
        'Node-based grading with 3D-LUT support',
        'Audio mixer, ducking and AudioWorklet effects',
        'Round-trip audio to XENO Sound',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'motion-color', alt: 'XENO Motion color page — a graded program monitor, Lift/Gamma/Gain color wheels and waveform + vectorscope video scopes' },
    { type: 'mockup', src: 'motion-agent', alt: 'XENO Motion agent — an AI assistant transcribing, arranging, subtitling and reframing a highlight edit on the timeline' },
  ],
  useCases: [
    { title: 'Editors & filmmakers', icon: 'Layers', desc: 'Assemble, trim and finish long-form and short-form on one timeline — with proxies, scopes and hardware export built in.' },
    { title: 'Motion & VFX artists', icon: 'Sparkles', desc: 'Keyframe, key, track and composite in a node graph without exporting to a separate motion-graphics tool.' },
    { title: 'Creators at volume', icon: 'Bot', desc: 'Hand the agent your rushes — it transcribes, picks the beats, arranges a cut, subtitles and reframes for every platform.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & open', desc: 'Get the Windows app, then create a sequence or open an .xmotion project.' },
    { step: '2', title: 'Cut & composite', desc: 'Import footage, edit on the timeline, add effects, grade and keyframe — all GPU-accelerated.' },
    { step: '3', title: 'Render or delegate', desc: 'Export with hardware encode, or ask the built-in agent to assemble, subtitle and reframe.' },
  ],
  comparison: {
    competitor: 'most pro video suites',
    rows: [
      { feature: 'Edit + motion graphics in one app', xeno: true, them: 'Two apps' },
      { feature: 'GPU compositing pipeline', xeno: 'WebGPU (full)', them: 'Partial' },
      { feature: 'Node-based compositing graph', xeno: true, them: 'Layers only' },
      { feature: 'AI: transcribe · reframe · isolate · track', xeno: 'Built in', them: 'Add-ons' },
      { feature: 'Direct hardware encode (NVENC / QSV)', xeno: true, them: 'Via encoder' },
      { feature: 'Cold-start time', xeno: '< 2s', them: '8–15s' },
      { feature: 'Mature plugin & format ecosystem', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free tier + credits', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64)' },
    { label: 'Engine', value: 'WebGPU · WebCodecs · FFmpeg (N-API)' },
    { label: 'Project format', value: '.xmotion (JSON)' },
    { label: 'Status', value: 'Beta (public test)' },
  ],
  faq: [
    { q: 'Is XENO Motion ready for production work?', a: 'It’s a public test build. The core editor — multi-track timeline, GPU compositing, color, effects, audio and export — works today, and it’s honest beta: expect rough edges and missing polish next to a decade-old suite. Bring feedback.' },
    { q: 'Do I really not need a separate motion-graphics app?', a: 'That’s the core idea. Editing and motion graphics share one project and one timeline — the compositor is a node-based render graph, so you keyframe, mask and composite without exporting to a second program.' },
    { q: 'What formats and codecs can it handle?', a: 'Hardware decode via WebCodecs for H.264, H.265, VP9 and AV1, with an FFmpeg fallback for pro codecs like ProRes, DNxHR and BRAW. Export is direct hardware encode (NVENC / QSV / VideoToolbox) to MP4, MOV, MKV or WebM.' },
    { q: 'What can the AI actually do?', a: 'Speech-to-text and subtitles (Whisper), auto-reframe, scene detection, object tracking, voice isolation and denoise, and footage upscaling. A built-in agent can go further — transcribe your clips, pick the best moments and assemble a rough cut you review.' },
    { q: 'Do I need a powerful computer?', a: 'You need a WebGPU-capable GPU for the compositing, color and effects pipeline. Hardware encoders (NVENC / QSV) speed up export a lot; without one, export falls back to software and is slower.' },
    { q: 'How much does it cost?', a: 'There’s a free tier; heavier AI and cloud features draw on XENO platform credits. Full pricing is announced separately as it leaves beta.' },
  ],
  seo: {
    title: 'XENO Motion — video editing and motion graphics in one app',
    description: 'A GPU-accelerated video editor and node-based motion-graphics engine in a single app. WebGPU compositing, ACES color, hardware encode, and AI that transcribes, reframes and isolates. Beta on Windows — free tier + credits.',
  },
};

export default motion;

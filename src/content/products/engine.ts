import type { ProductContent } from './_types';

/* XENO Engine — sourced from ../xeno-engine (README.md + src/renderer/editor).
 * A `delivery: soon` / `status: coming-soon` product: CTA is the waitlist.
 * Honest framing — the engine is scaffolded and in active development: the editor
 * currently previews scenes in Three.js/WebGL while the Rust wgpu deferred
 * pipeline is built; networking and GPU skinning are planned. No inflated claims:
 * performance figures are stated as design targets, not measured benchmarks. */
const engine: ProductContent = {
  slug: 'engine',
  hero: {
    headline: 'A game engine, rebuilt from zero for AI.',
    sub: 'XENO Engine pairs a Rust + wgpu core, an archetype ECS and TypeScript scripting with an agent that designs levels, writes NPC dialogue and playtests while you sleep. Model in XENO 3D, texture in Pixel, score in Sound — one pipeline, no export hell. Build once, ship to web and native. In active development.',
    media: { type: 'mockup', src: 'engine-hero', alt: 'XENO Engine editor — hierarchy, a 3D scene viewport with a transform gizmo, the inspector, and the asset browser' },
    badges: ['Rust + wgpu core', 'TypeScript scripting', 'AI-native', 'Web + native export', '0% revenue share'],
    note: 'In active development — not yet released. Join the waitlist for early access. The editor previews scenes in WebGL today while the Rust wgpu pipeline lands.',
  },
  trust: [
    'Part of the XENO ecosystem — one account, one asset pipeline',
    'Rust core: wgpu · Rapier · kira',
    'Script in TypeScript — no C++, no C#',
    '0% revenue share · no runtime fees',
  ],
  highlights: [
    { value: 'Rust + wgpu', label: 'Vulkan · Metal · DX12 core' },
    { value: 'AI-native', label: 'NPCs, generation & playtesting' },
    { value: 'TypeScript', label: 'Plus visual scripting' },
    { value: '0% rev share', label: 'No runtime fees, ever' },
  ],
  features: [
    {
      eyebrow: 'Scene & ECS',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'A scene editor on an archetype ECS',
      desc: 'A real-time 3D viewport with translate/rotate/scale gizmos, a scene-graph hierarchy and a live inspector — over a column-major, archetype-based ECS written in Rust.',
      bullets: [
        'Hierarchy, inspector, gizmos, snapping, multi-select',
        'Archetype SoA storage with a parallel system scheduler',
        'Filtered queries — With / Without / Changed semantics',
        'Prefabs, nested prefabs and variant overrides',
        'Play-in-editor with instant enter/exit',
      ],
    },
    {
      eyebrow: 'Rendering',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Physically based, deferred rendering',
      desc: 'PBR metallic-roughness with shadows, bloom, SSAO, depth of field and ACES/AgX tonemapping. A WebGL preview drives the editor today while the Rust wgpu deferred pipeline is built.',
      bullets: [
        'glTF 2.0 PBR metallic-roughness workflow',
        'Shadow maps, HDR bloom, SSAO, depth of field',
        'wgpu deferred G-buffer, cascaded shadows, SSR, GI, volumetrics (in progress)',
        'GPU-compute particles and a node-based VFX graph',
      ],
    },
    {
      eyebrow: 'Simulation',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Physics, animation & audio in Rust',
      desc: 'Rapier physics, a state-machine animation runtime and kira spatial audio — the simulation core runs on a fixed 60 Hz timestep, decoupled from an uncapped render loop.',
      bullets: [
        'Rigid bodies, colliders, joints and a character controller',
        'Animator state machines, 1D/2D blend trees and IK',
        'kira spatial 3D audio with reverb zones and adaptive music',
        'Behavior trees, GOAP and NavMesh A* pathfinding',
      ],
    },
    {
      eyebrow: 'AI-native',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Your agent is part of the engine',
      desc: 'AI is the foundation, not a plugin. NPCs converse with memory and personality via the XENO agent runtime, and agents generate assets, design levels and playtest your game.',
      bullets: [
        'LLM NPC dialogue via xeno-agent-sdk — memory & context',
        'Asset, texture and terrain generation via xeno-lib',
        '"Generate a medieval village" level-design agent',
        'Automated playtest agent that stress-tests gameplay',
      ],
    },
    {
      eyebrow: 'Scripting',
      icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'TypeScript and visual scripting',
      desc: 'Write game logic in TypeScript on a V8 runtime with hot reload — no C++, no C#, no new language — or wire a Blueprints-style node graph that compiles straight to TypeScript.',
      bullets: [
        'TypeScript scripts on V8 (deno_core / rusty_v8) with hot reload',
        'Component scripts attach to entities; async/await game logic',
        'Node-based visual scripting → compiles to TypeScript',
        'Sandboxed execution with a typed engine API surface',
      ],
    },
    {
      eyebrow: 'Ship anywhere',
      icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'One project, web and native',
      desc: 'First-class web export via WASM + WebGPU, native binaries for Windows, macOS and Linux, and WebXR with no separate SDK — from a single project, with per-platform asset optimization.',
      bullets: [
        'Web build: WASM + WebGPU (no plugin)',
        'Native desktop binaries — Windows, macOS, Linux',
        'WebXR VR/AR without a separate toolkit',
        'Unified asset database — UUID refs never break on move/rename',
      ],
    },
  ],
  useCases: [
    { title: 'Indie & studio game dev', icon: 'Boxes', desc: 'A full editor pipeline — scene, physics, animation, audio, scripting — with no runtime fees and no revenue share taken from what you ship.' },
    { title: 'AI-native games', icon: 'Bot', desc: 'NPCs that hold real conversations with memory and personality, plus levels, terrain and props generated from a prompt.' },
    { title: 'Web-first games', icon: 'Globe', desc: 'Ship to the browser with WASM + WebGPU and to native desktop from one project — assets flow in from XENO 3D, Pixel and Sound.' },
  ],
  howItWorks: [
    { step: '1', title: 'Join the waitlist', desc: 'Sign in with your XENO account to get early access as builds roll out.' },
    { step: '2', title: 'Compose your scene', desc: 'Use the hierarchy, inspector and gizmos; import meshes, textures and audio straight from XENO 3D, Pixel and Sound.' },
    { step: '3', title: 'Script & export', desc: 'Write TypeScript or wire a visual graph, then export to web and native in one click.' },
  ],
  comparison: {
    competitor: 'most game engines',
    rows: [
      { feature: 'Rust, memory-safe engine core', xeno: true, them: false },
      { feature: 'Script in TypeScript', xeno: true, them: 'C++ / C#' },
      { feature: 'AI NPCs & generation built in', xeno: 'Native', them: 'Plugins' },
      { feature: 'First-class web (WASM + WebGPU) export', xeno: true, them: 'Partial' },
      { feature: 'Runtime fees / revenue share', xeno: 'None', them: 'Common' },
      { feature: 'Mature ecosystem, asset store & docs', xeno: 'Early', them: true },
      { feature: 'Proven on shipped titles', xeno: false, them: true },
    ],
  },
  specs: [
    { label: 'Engine core', value: 'Rust · wgpu · Rapier · kira' },
    { label: 'Scripting', value: 'TypeScript (V8) + Visual Script' },
    { label: 'Targets', value: 'Web (WASM+WebGPU) · Win · macOS · Linux' },
    { label: 'Status', value: 'In development · coming soon' },
  ],
  faq: [
    { q: 'When can I use XENO Engine?', a: 'It’s in active development — the architecture is defined and the editor is being built. It isn’t released yet; join the waitlist and you’ll get early access as builds roll out.' },
    { q: 'What language do I script in?', a: 'TypeScript, running on a V8 runtime with hot reload — no C++ or C# required. You can also wire a Blueprints-style visual node graph that compiles to TypeScript.' },
    { q: 'Is the renderer really Rust and wgpu?', a: 'That’s the design. The editor currently previews scenes with a Three.js/WebGL pipeline (PBR, shadows, bloom, SSAO, DOF, tonemapping). The Rust wgpu deferred pipeline — G-buffer, cascaded shadows, SSR, GI and volumetrics — is being built to replace it.' },
    { q: 'What makes it “AI-native”?', a: 'AI is built into the engine, not bolted on: NPC dialogue runs through the XENO agent runtime with memory and context, and agents generate assets and terrain (via xeno-lib), design levels and playtest your game. Some of these capabilities are still landing.' },
    { q: 'Are there runtime fees or revenue share?', a: 'No. There are no runtime fees and no revenue share — what you ship is yours.' },
    { q: 'What can it export to?', a: 'Web via WASM + WebGPU, native binaries for Windows, macOS and Linux, and WebXR for VR/AR — all from one project, with automatic per-platform asset optimization.' },
  ],
  seo: {
    title: 'XENO Engine — the AI-native game engine',
    description: 'A game engine built from zero for AI: a Rust + wgpu core, an archetype ECS, Rapier physics, TypeScript scripting, and an agent that designs levels and writes NPC dialogue. Web + native export, 0% revenue share. Join the waitlist.',
  },
};

export default engine;

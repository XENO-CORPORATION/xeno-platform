import type { ProductContent } from './_types';

/* XENO 3D — sourced from ../xeno-3d (README.md + the renderer UI in
 * src/renderer/src/components). A full 3D DCC (Blender / Maya / C4D / ZBrush /
 * Houdini class) with a native Rust + wgpu engine. Status is honest: it is
 * in active development (early v0.x builds), NOT released — coming-soon /
 * waitlist framing throughout. Claims are drawn only from the real repo. */
const threeD: ProductContent = {
  slug: '3d',
  hero: {
    headline: 'The whole 3D pipeline, in one native app.',
    sub: 'Modeling, sculpting, UV, materials, procedural nodes, animation, simulation and rendering — unified in a single tool, driven by a native Rust + wgpu engine. AI-native, USD-first, and free to start. In active development.',
    media: { type: 'mockup', src: '3d-hero', alt: 'XENO 3D — the viewport with a selected mesh, transform gizmo, scene outliner, properties, timeline and status bar' },
    badges: ['Windows · macOS · Linux', 'Rust + wgpu engine', 'USD-first', 'AI text-to-3D', 'In development'],
    note: 'In active development — not yet released. Early builds already run modeling, sculpting, UV, materials, animation and a path tracer. Join the waitlist for the first public build.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Native engine: Rust · wgpu (Vulkan / Metal / DX12)', 'USD-first, open formats'],
  highlights: [
    { value: 'Six tools in one', label: 'Model · sculpt · animate · sim · render' },
    { value: 'wgpu native', label: 'Vulkan · Metal · DX12' },
    { value: '20M+ polys', label: 'GPU sculpting engine' },
    { value: 'Free tier', label: 'No multi-thousand-dollar subscription' },
  ],
  features: [
    {
      eyebrow: 'Modeling & sculpting', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Model and sculpt in one place',
      desc: 'A half-edge polygon core with O(1) adjacency, a full non-destructive modifier stack, and a GPU sculpting engine — box-modeling to detail sculpt without switching apps.',
      bullets: [
        'Extrude, bevel, inset, loop cut, knife, bridge on real geometry',
        'Modifier stack: mirror, array, solidify, boolean, remesh, decimate (30+)',
        'Catmull-Clark subdivision with crease weights, real-time preview',
        'Multi-resolution sculpting: 50+ brushes, dynamic topology, layers & masks',
      ],
    },
    {
      eyebrow: 'Procedural & nodes', icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.15), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Non-destructive, node by node',
      desc: 'A Houdini-style DAG for procedural geometry and a visual PBR shader graph — build once, tweak inputs, and the whole result rebuilds.',
      bullets: [
        'Geometry nodes: scatter, instance on points, merge, noise deform',
        'Math / logic nodes, loops and conditional branching',
        'Node-based PBR shader graph compiled to GLSL',
        'Custom node API for plugin authors',
      ],
    },
    {
      eyebrow: 'Rendering', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Real-time PBR and an offline path tracer',
      desc: 'A wgpu deferred renderer for the viewport and an unbiased path tracer for finals — with render passes ready for compositing.',
      bullets: [
        'Deferred PBR: Cook-Torrance, IBL, cascaded shadows, SSAO, bloom, ACES',
        'Unbiased path tracer with BVH acceleration and progressive samples',
        'Render passes / AOVs: beauty, depth, normal, AO, object & material ID',
        'Optional CUDA backend for the path tracer',
      ],
    },
    {
      eyebrow: 'Animation & simulation', icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Rig, animate, and simulate',
      desc: 'Keyframe curves, a real rigging system, and GPU simulation — all baking down to caches you can render.',
      bullets: [
        'Graph & NLA editors, bezier / linear / stepped interpolation',
        'Skeletal rig with IK/FK (CCD, FABRIK), blend shapes, retargeting',
        'GPU particles, hair & fur, force fields',
        'Rapier physics: rigid / soft body, XPBD cloth, Voronoi fracture',
      ],
    },
    {
      eyebrow: 'AI 3D', icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.15), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'AI where it actually helps',
      desc: 'Generate a starting point from a prompt or a photo, then refine it by hand — the AI produces geometry you own, not a black box.',
      bullets: [
        'Text-to-3D mesh (multi-view diffusion + reconstruction)',
        'UV-aware AI texturing from a text prompt',
        'Auto-rigging: joint prediction + automatic weight painting',
        'AI retopology / quad remesh for mesh cleanup — native in Rust',
      ],
    },
    {
      eyebrow: 'Native engine & formats', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Built native, opens everything',
      desc: 'The 3D engine is Rust compiled to a native N-API module — Electron draws the panels and never touches a render frame.',
      bullets: [
        'wgpu rendering (Vulkan / Metal / DX12), not WebGL in a tab',
        'USD-first, plus glTF / GLB, OBJ and STL (FBX & Alembic planned)',
        'Python 3.12 scripting via PyO3 for addons & pipeline tools',
        'Cross-platform Electron shell — sub-1.5s startup target',
      ],
    },
  ],
  useCases: [
    { title: '3D generalists & artists', icon: 'Boxes', desc: 'Model, sculpt, UV, texture, rig and render without hopping between six different tools and their file formats.' },
    { title: 'Studios & pipelines', icon: 'Users', desc: 'USD-first with Python scripting and open formats — drop it into an existing pipeline instead of fighting it.' },
    { title: 'AI-first creators', icon: 'Sparkles', desc: 'Start from a prompt or a photo: generate a base mesh, auto-rig it, AI-texture it, then refine every detail by hand.' },
  ],
  howItWorks: [
    { step: '1', title: 'Join the waitlist', desc: 'Sign in with your XENO account and request early access to the first public build.' },
    { step: '2', title: 'Model or generate', desc: 'Start from a primitive, import USD / glTF / OBJ, or generate a base mesh from a text prompt.' },
    { step: '3', title: 'Sculpt, rig, render', desc: 'Refine with sculpting and modifiers, rig and animate, then render in the viewport or the path tracer.' },
  ],
  comparison: {
    competitor: 'most 3D suites',
    rows: [
      { feature: 'Modeling + sculpt + animation, unified', xeno: true, them: 'Partial' },
      { feature: 'GPU-native viewport (Vulkan / Metal / DX12)', xeno: 'wgpu', them: 'OpenGL' },
      { feature: 'AI text-to-3D, auto-rig & texturing', xeno: true, them: false },
      { feature: 'Procedural node graph', xeno: true, them: 'Some' },
      { feature: 'Python scripting', xeno: true, them: true },
      { feature: 'Mature plugin ecosystem', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free tier + credits', them: 'Free–$2k/yr' },
      { feature: 'Availability', xeno: 'In development', them: 'Shipping' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows · macOS · Linux (Electron)' },
    { label: 'Engine', value: 'Rust · wgpu · N-API (napi-rs)' },
    { label: 'Formats', value: 'USD · glTF · OBJ · STL (FBX/ABC planned)' },
    { label: 'Status', value: 'In development (pre-release)' },
  ],
  faq: [
    { q: 'Is XENO 3D available yet?', a: 'Not yet — it’s in active development (early v0.x builds). Modeling, sculpting, UV, materials, a node-based material editor, animation timeline and a path tracer already work. Join the waitlist and we’ll notify you when the first public build is ready.' },
    { q: 'What does it replace?', a: 'It aims to unify what you’d normally split across a modeling/sculpt/animation suite and a separate renderer — polygon modeling, sculpting, UV, procedural nodes, animation, simulation and rendering, all in one app.' },
    { q: 'Is it really native, or just web tech?', a: 'The 3D engine is Rust compiled to a native N-API module and renders through wgpu (Vulkan / Metal / DX12). Electron only draws the UI panels — it never touches render frames.' },
    { q: 'Which file formats does it support?', a: 'USD is the primary format, with glTF/GLB, OBJ and STL supported today. FBX and Alembic are planned.' },
    { q: 'How does the AI 3D work?', a: 'Text-to-3D, AI texturing and auto-rigging run through xeno-lib (on-device) and cloud models on api.xenostudio.ai, while retopology / remeshing runs natively in Rust. They generate editable starting points — real geometry you refine by hand, not a locked black box.' },
    { q: 'How much will it cost?', a: 'A free tier plus credits for heavy AI and cloud work — no multi-thousand-dollar yearly subscription. Final pricing will be announced at launch.' },
  ],
  seo: {
    title: 'XENO 3D — modeling, sculpting, animation & rendering',
    description: 'A full 3D app — polygon modeling, GPU sculpting, procedural nodes, animation, simulation and PBR + path-traced rendering — on a native Rust + wgpu engine. AI-native, USD-first, free to start. In development; join the waitlist.',
  },
};

export default threeD;

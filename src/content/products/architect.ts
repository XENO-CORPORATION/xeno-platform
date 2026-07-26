import type { ProductContent } from './_types';

/* XENO Architect — sourced from ../xeno-architect (README + the real Revit-style
 * renderer in src/renderer/src). A coming-soon product: CTA is the waitlist
 * ("Get notified"). Honest preview framing — v0.2.0, active development; the BIM
 * model, parametric elements, real-time WebGL viewport, auto 2D docs, MEP,
 * sun study and IFC/DXF/PDF I/O are real in the build (TypeScript + Three.js;
 * the Rust/wgpu engine in the README is aspirational, not shipped), while
 * worksharing and the deep ecosystem are still ahead. */
const architect: ProductContent = {
  slug: 'architect',
  hero: {
    headline: 'One model, concept to construction.',
    sub: 'An AI-native BIM and CAD tool that carries a building from massing to construction documents in a single, IFC-native model — parametric elements, a real-time 3D viewport, and 2D drawings generated straight from the 3D. No round-tripping between five apps.',
    media: { type: 'mockup', src: 'architect-hero', alt: 'XENO Architect — a professional BIM workspace: contextual ribbon, tool sidebar, a 3D building massing with a selected wall, project browser and IFC properties' },
    badges: ['BIM-native (IFC)', 'Parametric', 'Real-time 3D', 'Windows · macOS · Linux'],
    note: 'Coming soon — no public build yet. Early preview (v0.2.0) in active development; the model, drawings and formats below are real, worksharing is still ahead.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'IFC-native BIM · real-time WebGL viewport · progressive path tracer', 'Open formats: IFC · DXF · PDF · gbXML'],
  highlights: [
    { value: 'One model', label: 'Massing → construction docs' },
    { value: 'IFC-native', label: 'BIM from the ground up' },
    { value: 'Auto drawings', label: 'Plans, sections, elevations from 3D' },
    { value: 'AI-native', label: 'Generate · furnish · analyze' },
  ],
  features: [
    {
      eyebrow: 'BIM engine',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Intelligent building elements, not dumb geometry',
      desc: 'Every wall, floor, roof, door, window and stair is a parametric object with real relationships — so the model behaves like a building, not a pile of lines.',
      bullets: [
        'Walls auto-join, stairs auto-calculate, windows and doors cut their host',
        'IFC class hierarchy with property sets and per-element metadata',
        'Rooms auto-bound by walls with computed area and volume',
        'Levels, grids, phases and multi-layer wall/floor types',
      ],
    },
    {
      eyebrow: 'Viewport & rendering',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'A real-time 3D viewport, with final renders built in',
      desc: 'Orbit, pan, walk and section your model in real time with PBR materials and sun studies — then push a button for a progressive, path-traced still. No render plugin to buy.',
      bullets: [
        'Real-time PBR viewport with orbit / pan / zoom and section views',
        'Sun study with shadow casting and time-of-day control',
        'Render-to-image at 1920×1080 with one click',
        'Progressive path tracer: soft shadows, indirect light, ACES tone mapping',
      ],
    },
    {
      eyebrow: '2D documentation',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Drawings that come from the model',
      desc: 'Floor plans, sections and elevations are generated from the 3D model and stay in sync — annotate, dimension, schedule, place on sheets and export to PDF.',
      bullets: [
        'Auto plans, sections and elevations from the 3D model',
        'Dimensioning, tags, keynotes and door/window/room schedules',
        'Drawing sheets with title blocks and revision tracking',
        'Construction-document PDF export',
      ],
    },
    {
      eyebrow: 'Parametric design',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Drive the design with rules, not repetition',
      desc: 'A constraint solver and expression-driven parameters propagate through a dependency graph, so facades, curtain walls and families update everywhere at once.',
      bullets: [
        'Geometric constraint solver with a parameter dependency graph',
        'Expression-based parameters (drive one value, update the model)',
        'Curtain-wall systems: mullions, panels and grids',
        'Parametric component families',
      ],
    },
    {
      eyebrow: 'AI architecture',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'AI that understands buildings',
      desc: 'Generate a floor-plan layout from a prompt, auto-furnish rooms, optimize space, and get material, energy and MEP-routing suggestions — built to run on-device and in the cloud.',
      bullets: [
        'Floor-plan generation from a text description',
        'Auto-furnish rooms with material and finish suggestions',
        'Space optimization plus energy and code-compliance suggestions',
        'Built for the XENO AI stack (xeno-lib on-device + xeno-rt local models) and cloud',
      ],
    },
    {
      eyebrow: 'Site · MEP · analysis',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'The whole project, not just the shell',
      desc: 'Terrain and topography, MEP routing across electrical, plumbing and HVAC, clash detection between disciplines, and building-performance checks — all in the one model.',
      bullets: [
        'Terrain and topography from site contours and points',
        'MEP layout with A* auto-routing for electrical circuits',
        'Clash detection between disciplines via spatial indexing',
        'Energy modeling and accessibility-compliance checks',
      ],
    },
  ],
  useCases: [
    { title: 'Architecture studios', icon: 'Boxes', desc: 'Take a project from concept massing to permit set in one tool — model, document, render and export without exporting between five packages.' },
    { title: 'BIM & IFC coordination', icon: 'Globe', desc: 'Exchange a real IFC model with structural and MEP engineers, then run clash detection to catch conflicts before they reach the site.' },
    { title: 'Feasibility & concept', icon: 'Sparkles', desc: 'Sketch massing fast, generate a floor plan from a brief, and test sun, shadow and site fit in minutes — before committing to the design.' },
  ],
  howItWorks: [
    { step: '1', title: 'Model the building', desc: 'Place parametric walls, floors, roofs, stairs and openings — they auto-join and carry IFC data as you go.' },
    { step: '2', title: 'Generate the drawings', desc: 'Plans, sections, elevations and schedules come straight from the 3D model; annotate and lay them out on sheets.' },
    { step: '3', title: 'Render & export', desc: 'Real-time PBR and path-traced stills, then export IFC and DXF, or construction-document PDFs.' },
  ],
  comparison: {
    competitor: 'most BIM tools',
    rows: [
      { feature: 'BIM with native IFC exchange', xeno: true, them: true },
      { feature: 'Real-time rendering + path tracer, no plugin', xeno: 'Built in', them: 'Plugin' },
      { feature: 'Parametric visual scripting built in', xeno: true, them: 'Add-on' },
      { feature: 'Auto 2D drawings from the 3D model', xeno: true, them: true },
      { feature: 'AI generate / furnish / analyze', xeno: true, them: false },
      { feature: 'Cross-platform (Windows · macOS · Linux)', xeno: true, them: 'Windows-only' },
      { feature: 'Real-time multi-user worksharing', xeno: 'Planned', them: true },
      { feature: 'Mature ecosystem, families & plugins', xeno: 'Early', them: true },
      { feature: 'Price', xeno: 'Free tier + credits', them: '$2–4k / yr' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows · macOS · Linux' },
    { label: 'Engine', value: 'Electron · TypeScript · Three.js / WebGL' },
    { label: 'Formats', value: 'IFC · DXF · PDF · gbXML' },
    { label: 'Status', value: 'Coming soon (v0.2 preview)' },
  ],
  faq: [
    { q: 'When can I use XENO Architect?', a: 'Not yet — there is no public build to download. It’s in active development (v0.2.0): the BIM model, parametric elements, real-time viewport, auto 2D drawings, MEP layout, sun study and IFC/DXF/PDF I/O run in our development builds; worksharing and the wider ecosystem are still being built. Get notified and we’ll tell you when the first public build is ready.' },
    { q: 'Is it really BIM and IFC-native?', a: 'Yes. Elements carry IFC classes and property sets, and it imports and exports IFC alongside DXF, PDF and gbXML — so it fits an existing BIM workflow rather than trapping your model. (More formats like DWG, USD and glTF are on the roadmap.)' },
    { q: 'Does it replace Revit, ArchiCAD or SketchUp?', a: 'That’s the goal: BIM, parametric design, real-time rendering and 2D documentation in one tool instead of separate apps and plugins. Being honest — the ecosystem, family libraries and cloud worksharing that mature tools have are still ahead of us.' },
    { q: 'What about parametric / Grasshopper-style design?', a: 'There’s a constraint solver, expression-based parameters with a dependency graph, and parametric families and curtain-wall systems — so changing one value ripples through the model.' },
    { q: 'What can the AI actually do?', a: 'Generate a floor-plan layout from a text brief, auto-furnish rooms, optimize space, and offer material, energy and MEP-routing suggestions. It’s built for the XENO AI stack — xeno-lib on-device and local models via xeno-rt, as well as the cloud.' },
    { q: 'How much will it cost?', a: 'There’s a free tier, with credits for heavier AI and rendering work. Full pricing will be announced at launch.' },
  ],
  seo: {
    title: 'XENO Architect — AI-native BIM & CAD',
    description: 'One IFC-native model from massing to construction documents: parametric BIM, a real-time 3D viewport with a built-in path tracer, auto-generated drawings, MEP and AI. Windows, macOS and Linux — coming soon.',
  },
};

export default architect;

import type { ProductContent } from './_types';

/* XENO Workflow — sourced from ../xeno-workflow (README + the real Electron
 * renderer: Toolbar, NodePalette, WorkflowNode, NodeInspector, ExecutionLog,
 * node definitions, the Rust engine notes). Honest "coming-soon" framing: the
 * desktop app + node graph are in active development, not yet released, so the
 * CTA is a waitlist ("Get notified") and the copy speaks to what it will do. */
const workflow: ProductContent = {
  slug: 'workflow',
  hero: {
    headline: 'Automate anything — with AI that runs on your machine.',
    sub: 'A visual, node-based automation studio that wires triggers, 22+ local AI models, your creative apps, logic and APIs into pipelines — executed by a Rust engine with durable runs and time-travel debugging. Fully local. No cloud required.',
    media: { type: 'mockup', src: 'workflow-hero', alt: 'XENO Workflow — a node graph wiring a file trigger through a local AI model to a save step, with the node palette, inspector and live execution log' },
    badges: ['Local-first', '22+ local AI models', 'Rust engine', 'Free waitlist'],
    note: 'In active development — not yet released. Join the waitlist for the first build.',
  },
  trust: ['Runs locally — your data never leaves your machine', 'Rust execution engine via napi-rs', 'Part of the XENO platform — one sign-in'],
  highlights: [
    { value: '22+', label: 'Local AI models as nodes' },
    { value: 'Rust', label: 'Durable execution engine' },
    { value: 'Time-travel', label: 'Replay from any checkpoint' },
    { value: '100% local', label: 'Runs fully offline' },
  ],
  features: [
    {
      eyebrow: 'Visual canvas',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'A node graph that shows your data flowing',
      desc: 'Drag typed nodes from a categorized palette and wire them together. Wires are colored by the data they carry, so a pipeline reads at a glance — and you watch it execute live.',
      bullets: [
        'Infinite zoom/pan canvas with minimap and auto-layout',
        'Type-checked ports — wires colored by data type (Blueprints-style)',
        'Real-time execution: data flowing through nodes as it runs',
        'Command palette, node search, alignment guides',
      ],
    },
    {
      eyebrow: 'Local AI',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Frontier AI as nodes — no cloud, no keys',
      desc: 'Drop 22+ GPU-accelerated models straight into a pipeline via xeno-lib, and give agents a seat with LLM inference from xeno-rt — all running on your own hardware.',
      bullets: [
        'Upscale, denoise, background removal, depth, OCR, segmentation & more',
        'AI Agent nodes with tools, persistent memory and multi-agent delegation',
        'RAG nodes with vector memory',
        'Runs offline — prompts and files never leave the machine',
      ],
    },
    {
      eyebrow: 'Execution engine',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.16), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'A Rust engine built for real work',
      desc: 'Durable, checkpointed execution on a Rust worker-thread pool — designed to keep running across restarts and to fan work out across parallel branches.',
      bullets: [
        'Durable execution — runs resume across restarts',
        'Automatic retry with configurable exponential backoff',
        'Parallel branch execution with fan-out / fan-in',
        'Sub-workflows — compose pipelines from reusable blocks',
      ],
    },
    {
      eyebrow: 'Debugging',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Time-travel through every run',
      desc: 'A checkpoint is captured at every node, so you can step back and forth through an execution, inspect the data at any point, tweak it, and replay from there.',
      bullets: [
        'Checkpoint captured at every node execution',
        'Step backward / forward through the run',
        'Modify intermediate data and replay from any checkpoint',
        'Execution timeline with per-node duration and status',
      ],
    },
    {
      eyebrow: 'XENO-native',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Drives your whole creative stack',
      desc: 'Native nodes for the XENO apps — so a workflow can edit an image, cut a video, mix audio or render a 3D scene as part of one pipeline.',
      bullets: [
        'Nodes for Pixel, Motion, Sound, 3D, Architect and Engine',
        'Data, external (HTTP / DB / S3 / Slack) and logic nodes',
        'MCP client/server for external tool discovery',
        'App-integration nodes are rolling out as each app exposes its API',
      ],
    },
    {
      eyebrow: 'Handle failure',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.14), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Error handling that expects the real world',
      desc: 'Per-node directives, dedicated error routes and a dead-letter queue mean a single failed step doesn’t take the whole run down.',
      bullets: [
        'Break / resume / retry / commit / rollback per node',
        'Error workflows triggered on failure',
        'Dead-letter queue with a retry UI',
        'Different routes for timeout vs data vs auth errors',
      ],
    },
  ],
  useCases: [
    { title: 'Creative production pipelines', icon: 'Boxes', desc: 'Watch a folder, upscale and clean up every drop, cut it in Motion or render in 3D, and export — a whole media pipeline as one graph.' },
    { title: 'AI & data automation', icon: 'Globe', desc: 'Pull from an API or database, transform the JSON, run it through local models or an agent, and push the result to Slack, S3 or a webhook.' },
    { title: 'Private, offline automation', icon: 'Lock', desc: 'Keep sensitive work on your own hardware — local AI, local execution, local data. Nothing has to touch someone else’s cloud.' },
  ],
  howItWorks: [
    { step: '1', title: 'Join the waitlist', desc: 'Sign in with your XENO account and get notified the moment the first desktop build ships.' },
    { step: '2', title: 'Wire up a pipeline', desc: 'Drag triggers, AI, logic and app nodes onto the canvas and connect their typed ports.' },
    { step: '3', title: 'Run it locally', desc: 'Execute on the Rust engine, watch data flow live, and replay from any checkpoint when something breaks.' },
  ],
  comparison: {
    competitor: 'most automation tools',
    rows: [
      { feature: 'Visual node graph with live data flow', xeno: true, them: true },
      { feature: 'Local, GPU-accelerated AI models as nodes', xeno: '22+ models', them: false },
      { feature: 'Native creative-app nodes (Pixel / Motion / Sound / 3D)', xeno: true, them: false },
      { feature: 'Durable, checkpointed execution', xeno: 'Rust engine', them: 'Cloud' },
      { feature: 'Time-travel debugging (replay from a checkpoint)', xeno: true, them: false },
      { feature: '100% local — data never leaves your machine', xeno: true, them: false },
      { feature: 'Mature ecosystem & prebuilt integrations', xeno: 'Growing', them: true },
      { feature: 'Availability', xeno: 'Coming soon', them: 'Available now' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows · macOS · Linux (Electron)' },
    { label: 'Engine', value: 'Rust via napi-rs' },
    { label: 'Project format', value: '.xflow' },
    { label: 'Status', value: 'Coming soon · in development' },
  ],
  faq: [
    { q: 'Is XENO Workflow available yet?', a: 'Not yet. It’s in active development — the desktop shell, node graph, palette, inspector and execution log are built, but it hasn’t been released. Join the waitlist and we’ll notify you when the first build is ready.' },
    { q: 'Does it run in the cloud?', a: 'It’s local-first: the app and its Rust execution engine run on your own machine, so your data and prompts stay local. An always-on server execution mode (scheduled and webhook-triggered) is planned for later.' },
    { q: 'What AI can it use?', a: '22+ local, GPU-accelerated models via xeno-lib (upscale, denoise, background removal, depth, OCR, segmentation and more) as drag-in nodes, plus AI Agent nodes powered by local LLMs through xeno-rt — no cloud dependency or API keys required.' },
    { q: 'How is it different from other automation tools?', a: 'Three things most tools don’t have: local GPU AI models as first-class nodes, native nodes for the XENO creative apps, and a Rust engine with durable execution and time-travel debugging — all running fully offline.' },
    { q: 'Can it drive the other XENO apps?', a: 'That’s the goal — native nodes for Pixel, Motion, Sound, 3D, Architect and Engine. These integration nodes require the target app to be running and are rolling out as each app exposes its automation API.' },
    { q: 'Will it be free?', a: 'Pricing hasn’t been announced. The waitlist is free — sign up and you’ll hear about availability and pricing first.' },
  ],
  seo: {
    title: 'XENO Workflow — local-first AI automation pipelines',
    description: 'A visual, node-based automation studio with 22+ local AI models, native creative-app nodes and a Rust execution engine with time-travel debugging. Runs fully offline. Join the waitlist.',
  },
};

export default workflow;

import type { ProductContent } from './_types';

/* XENO Workflow — sourced from ../xeno-workflow (README + the real Electron
 * renderer: Toolbar, NodePalette, WorkflowNode, NodeInspector, ExecutionLog,
 * node definitions). A `delivery: desktop` product: 0.3.0 is published and
 * downloadable (86.8 MB), so a visitor can check every claim here in a minute.
 *
 * CORRECTED 2026-07-27. Four claim families on this page were false, and the
 * live installer made them trivially disprovable:
 *
 *  1. "Rust execution engine" — asserted in SEVEN places (hero, badge,
 *     highlight, feature title + body, spec row, howItWorks, comparison, trust).
 *     The engine is TYPESCRIPT: renderer/src/engine/WorkflowEngine.ts, 1,266
 *     lines. The ONE Rust crate is `xeno-workflow-scene-graph` — an rstar R-tree
 *     spatial index loaded by preload as `__xenoWorkflowSceneGraph` and used for
 *     CANVAS viewport culling. It is real and it is loaded; it is simply not the
 *     execution engine. Describe it as canvas virtualization or not at all —
 *     never as "the engine".
 *  2. "22+ local AI models as nodes" — the nodes/xeno/ barrel WAS imported by
 *     NOTHING outside src/test/, and absent from builtinNodeDefinitions.
 *     FIXED in v0.3.0 (xeno-workflow b275afc): all 76 family nodes are now
 *     registered and reachable, and src/test/nodes-reachable.test.ts gates it.
 *     The underlying claim still needs care, though: the 54 creative-app nodes
 *     gate on window.xenoPixel and its siblings, which preload STILL never
 *     exposes (preload exposes only __xenoWorkflowSceneGraph and xenoWorkflow),
 *     and the 16 LibAI nodes need a xeno-rt task server. So they are now
 *     VISIBLE and configurable but still do not DO the work — reachable is not
 *     the same as functional, and this page must not conflate them. The Agent
 *     family (7) is the exception: it runs against xenoWorkflow's own main
 *     process and works. Out of the box there is still NO bundled AI.
 *     Separately, the 6 older registered creative-app nodes deliberately THROW
 *     "…is not available in this build" (engine/ecosystem/unavailable.ts).
 *  3. "100% local / runs fully offline / no keys" — the one registered AI node
 *     POSTs to a SEPARATELY INSTALLED xeno-rt on localhost:8080, and the Agent
 *     node reads a XENO CLOUD token from ~/.xeno/credentials.json. So: the graph
 *     runs locally, the AI does not come with it, and one node calls the cloud.
 *  4. "MCP client/server for external tool discovery" — `grep -rni mcp src/
 *     shared/` returns ZERO matches.
 *
 * What is real, and is what this page now sells: the desktop shell, the node
 * graph with type-checked ports, the palette, the inspector, the execution log,
 * and per-node checkpointing with replay. Windows only. */
const workflow: ProductContent = {
  slug: 'workflow',
  hero: {
    headline: 'Automation you can watch run, and replay when it breaks.',
    sub: 'A visual, node-based automation studio: wire triggers, logic, files and APIs into a typed node graph, then watch the data move through it. A checkpoint is captured at every node, so when a run goes wrong you can step back, change the data, and replay from that point.',
    media: { type: 'mockup', src: 'workflow-hero', alt: 'XENO Workflow — a node graph wiring a file trigger through a transform to a save step, with the node palette, inspector and live execution log' },
    badges: ['Windows desktop', 'Typed node graph', 'Replay from any checkpoint', 'Free beta'],
    note: 'Beta (v0.3) · Windows. The node graph, palette, inspector, execution log and checkpoint replay work today. AI nodes are NOT included out of the box — they need a separately installed xeno-rt (see “Using AI with it”). macOS and Linux builds follow.',
  },
  trust: ['The graph executes on your machine — no cloud account needed to run a workflow', 'AI is not bundled: the AI node needs a separately installed xeno-rt', 'Part of the XENO platform — one sign-in'],
  highlights: [
    { value: 'Typed ports', label: 'Wires colored by data type' },
    { value: 'Time-travel', label: 'Replay from any checkpoint' },
    { value: 'Live execution', label: 'Watch data move through it' },
    { value: 'Runs locally', label: 'No cloud to execute a graph' },
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
      eyebrow: 'Using AI with it',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI is something you connect, not something included',
      desc: 'We would rather be blunt: install XENO Workflow on its own and there is no AI in it. The AI node talks to xeno-rt, which you install and run separately, and the Agent node signs in to your XENO account. Both are worth wiring up — neither ships inside this build.',
      bullets: [
        'The AI node calls a xeno-rt server you run yourself at localhost:8080',
        'The Agent node uses your XENO account credentials — that call leaves the machine',
        'No models are bundled with the installer, and none are downloaded for you',
        'Image and vision node types became reachable in v0.3.0 — they still need a xeno-rt task server to actually run',
      ],
    },
    {
      eyebrow: 'Execution',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.16), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'An engine that expects runs to be long',
      desc: 'Execution is checkpointed node by node, so a run is inspectable while it happens and recoverable after it stops. Branches fan out and rejoin, and a pipeline can be composed from smaller ones.',
      bullets: [
        'A checkpoint per node — the basis for replay and resume',
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
      title: 'Built to drive the XENO stack — as those APIs land',
      desc: 'The general-purpose nodes — HTTP, database, S3, Slack, files, logic, transforms — work now. v0.3.0 made 76 fine-grained ecosystem nodes reachable in the palette, but the creative-app ones are still scaffolded against apps that are exposing their automation APIs, so treat them as direction rather than capability.',
      bullets: [
        'Working today: HTTP, SMTP email, Slack, Discord, GitHub issues, S3/R2, files, logic, transforms',
        '146 node types in the palette as of v0.3.0 — 70 core plus 76 XENO ecosystem nodes',
        'The 7 Agent nodes work today; agent-tool-call runs a real xeno-agent-sdk tool loop',
        'Pixel, Motion, Sound, 3D, Architect and Engine nodes place on the canvas but do not run yet',
        'They say so plainly when executed — "not available in this build", not a silent failure',
        'Database nodes (PostgreSQL, MySQL, Redis) are placeholders awaiting drivers',
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
    { title: 'Data & API automation', icon: 'Globe', desc: 'Pull from an API or database, transform the JSON, branch on the result, and push it to Slack, S3 or a webhook — with the whole run visible node by node.' },
    { title: 'File-driven pipelines', icon: 'Boxes', desc: 'Watch a folder, react to what lands in it, and move, rename or transform files through a graph you can read at a glance.' },
    { title: 'Debugging a flaky job', icon: 'Lock', desc: 'When step nine of a run fails, step back to step eight, edit the intermediate data, and replay from there instead of re-running the whole thing.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & open', desc: 'Get the Windows build and sign in with your XENO account.' },
    { step: '2', title: 'Wire up a pipeline', desc: 'Drag triggers, logic, data and API nodes onto the canvas and connect their typed ports.' },
    { step: '3', title: 'Run it and replay it', desc: 'Execute it on your machine, watch data flow through the graph, and replay from any checkpoint when something breaks.' },
  ],
  comparison: {
    competitor: 'most automation tools',
    rows: [
      { feature: 'Visual node graph with live data flow', xeno: true, them: true },
      { feature: 'Runs on your desktop, not a hosted account', xeno: true, them: 'Usually cloud' },
      { feature: 'Time-travel debugging (replay from a checkpoint)', xeno: true, them: false },
      { feature: 'Checkpointed execution', xeno: true, them: 'Cloud' },
      { feature: 'AI models included out of the box', xeno: false, them: 'Varies' },
      { feature: 'Creative-app nodes (Pixel / Motion / Sound / 3D)', xeno: 'Scaffolded', them: false },
      { feature: 'Mature ecosystem & prebuilt integrations', xeno: 'Growing', them: true },
      { feature: 'Availability', xeno: 'Beta (Windows)', them: 'Available now' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64) · Electron' },
    { label: 'Engine', value: 'TypeScript (WorkflowEngine)' },
    { label: 'AI', value: 'Not bundled · needs your own xeno-rt' },
    { label: 'Project format', value: '.xflow' },
    { label: 'Status', value: 'v0.3 · beta' },
  ],
  faq: [
    { q: 'Is XENO Workflow available yet?', a: 'Yes — the 0.2 beta is downloadable now for Windows. The desktop shell, node graph, typed ports, palette, inspector, execution log and checkpoint replay all work. It’s an honest beta: several node categories, the AI integration and the always-on server mode are still being built, and macOS and Linux builds are still to come.' },
    { q: 'What AI does it come with?', a: 'None — and we would rather say that here than let you find out after an 87 MB download. There is one registered AI node, and it calls a xeno-rt server on localhost:8080 that you install and run yourself; nothing is bundled and no model is fetched for you. There is also an Agent node, which signs in with your XENO account, so that one does make a network call. A larger local-model node set exists in the codebase but is not registered in this build.' },
    { q: 'Does it run in the cloud?', a: 'No — the app and its execution engine run on your own machine, and you can build and run a graph without any account. Two things reach the network if you use them: the Agent node (your XENO account) and any HTTP/database/S3/Slack node you wire up yourself. An always-on server execution mode (scheduled and webhook-triggered) is planned for later.' },
    { q: 'What is the engine written in?', a: 'TypeScript. Earlier copy on this page described a “Rust execution engine”; that was wrong and we have corrected it. The only Rust in the project is a spatial index for canvas virtualization — it is not the execution engine, and it is not what runs your workflow.' },
    { q: 'How is it different from other automation tools?', a: 'Two things it genuinely does differently: it runs on your desktop rather than in someone else’s account, and it checkpoints every node so you can step back through a finished run, edit the intermediate data and replay from that point. The XENO-native ambition — driving Pixel, Motion, Sound and 3D from a graph — is real work in progress, not a feature you can use today.' },
    { q: 'Can it drive the other XENO apps?', a: 'Not yet. Node types for Pixel, Motion, Sound, 3D, Architect and Engine exist in the codebase, but they need the target app running and exposing an automation API, and that work is still in progress across those apps. It is the goal, not the current state.' },
    { q: 'Will it be free?', a: 'The beta is free to download and use. General-release pricing hasn’t been announced; running a graph locally stays free, and only cloud features such as the Agent node would ever draw on credits.' },
  ],
  seo: {
    title: 'XENO Workflow — a visual automation studio you can replay',
    description: 'A visual, node-based automation studio for Windows: typed node graph, live execution view, and a checkpoint at every node so you can step back and replay a run from any point. Runs on your machine. AI nodes require your own xeno-rt. Free beta.',
  },
};

export default workflow;

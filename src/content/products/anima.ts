import type { ProductContent } from './_types';

/* XENO Anima — sourced from ../xeno-anima (README/SPEC/CHANGELOG + the real CLI in
 * apps/cli/src and packages/{mind,soul,runtime,orchestrate,compat-soul}). A
 * personal, always-on agent with an authored **Mind** that earns a **Soul**
 * (episodic memory + self-taught skills); run one, or many that coordinate as a
 * swarm. CLI `anima`.
 *
 * CORRECTED 2026-07-27 — this page said the product did not exist, in four
 * places (catalog coming-soon/soon, the hero note "there is nothing to install
 * today", the FAQ "Can I install it yet?" → "No", and specs "Install: Not
 * published yet"). All four were FALSE. Verified against the npm registry:
 *
 *   @xenosystem/anima                0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-mind           0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-soul           0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-runtime        0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-orchestrate    0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-compat-soul    0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-channels       0.0.1, 0.0.2   latest=0.0.2
 *   @xenosystem/anima-format         0.0.1, 0.0.2   latest=0.0.2
 *
 * ── THE SECURITY POINT — do not remove while 0.0.1 is installable ────────────
 * 0.0.1 is published AND DEPRECATED on npm. Its verbatim deprecation string:
 *   "Security: this build is missing the SDK dispatch_agent permission gate —
 *    a delegated subagent can read protected files with no prompt.
 *    Upgrade to 0.0.2."
 * A "coming soon" page gave anyone who installed 0.0.1 from a search result NO
 * upgrade signal at all. The 0.0.1 → 0.0.2 notice is therefore carried
 * EXPLICITLY here: hero note, trust band, a dedicated FAQ entry, and specs.
 * It comes out only when 0.0.1 is unpublished or otherwise uninstallable.
 *
 * NOTE: the repo README advertises https://get.xenostudio.ai/anima. That host is
 * NXDOMAIN (verified 2026-07-27). npm is the only real install path — never put
 * that URL on this page.
 *
 * Still honestly scoped: the Mind/Soul engine, always-on runtime, tool-use and
 * swarm work today (validated live on gpt-5.5); channels (xeno-comms), device
 * hands (xeno-use) and the `.xanima` save format are the next milestones. */
const anima: ProductContent = {
  slug: 'anima',
  hero: {
    headline: 'A Mind is given. A Soul is earned.',
    sub: 'Anima is your personal, always-on agent — one you author, name, and keep. You write its Mind (voice, values, boundaries, capabilities); it grows a Soul as it runs — episodic memory and skills it teaches itself. So it remembers you and gets better. Run one, or many that coordinate as a swarm.',
    media: { type: 'mockup', src: 'anima-hero', alt: 'XENO Anima CLI — a Mind runs a turn: it recalls from its Soul, replies, records the episode, and teaches itself a new skill' },
    badges: ['CLI · on npm', 'Local-first · bring any model', 'Swarm-native', 'Open source · AGPL-3.0'],
    note: 'Early release (v0.0.2) — install with npm install -g @xenosystem/anima. SECURITY: if you already have 0.0.1, upgrade now. 0.0.1 is deprecated because it is missing the SDK dispatch_agent permission gate, which lets a delegated subagent read protected files with no prompt. The Mind/Soul engine, always-on runtime, tool-using turns and the swarm all work today; channels (xeno-comms) and device hands (xeno-use) land next.',
  },
  trust: [
    'On npm now — 8 packages at v0.0.2',
    'Running 0.0.1? Upgrade: it is deprecated for a subagent permission-gate defect',
    'Node ≥ 20 · macOS · Linux · Windows',
    'AGPL-3.0 · self-hostable · Minds & Souls Ed25519-signed',
  ],
  highlights: [
    { value: 'Mind + Soul', label: 'Authored seed, earned self' },
    { value: 'Runs as a swarm', label: 'Many Minds coordinate' },
    { value: 'Local-first', label: 'xeno-rt · any model' },
    { value: 'Signed & scoped', label: 'Ed25519 · capability-gated' },
  ],
  features: [
    {
      eyebrow: 'The core idea',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'A Mind you author. A Soul it earns.',
      desc: 'The line is drawn where authorship changes hands: you write the Mind — personality, values, boundaries, scoped capabilities. The agent grows the Soul by living and working. Behavior text is Mind; anything it computes from experience is Soul.',
      bullets: [
        'mind.xeno — a schema-validated, versioned persona (no drifting markdown)',
        'Inheritance & mixins: extend a base Mind instead of copy-pasting prompts',
        'The Soul is data the agent earns from experience — never config',
        'Fork a Mind and its Soul does not come with it',
      ],
    },
    {
      eyebrow: 'The Soul',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,170,255,0.16), transparent 60%), linear-gradient(165deg,#101426,#070707 74%)',
      title: 'It remembers, and teaches itself new skills',
      desc: 'Every task becomes a structured episodic record. Solve something hard and the Soul distills a reusable, versioned skill — then recalls the right memories and skills automatically before similar work.',
      bullets: [
        'Episodic memory with similarity recall, injected before each turn',
        'Self-synthesized skills (name · trigger · procedure), versioned',
        'Evolved preferences and a relationship model of who it serves',
        'Ed25519-signed so its learning is auditable and tamper-evident',
      ],
    },
    {
      eyebrow: 'Swarm',
      icon: 'Network',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,180,0.16), transparent 60%), linear-gradient(165deg,#0d1a17,#070707 74%)',
      title: 'Run one, or a team that coordinates',
      desc: 'Solo, your Anima matches a Hermes or OpenClaw agent. Run many and they broadcast, hand off with context, and orchestrate — the thing the rivals’ isolated personas can’t do.',
      bullets: [
        'Broadcast one task to every Mind at once',
        'Handoff: transfer a task and carry the context',
        'Orchestrator decomposes work across specialists, then integrates',
        'Roles, routing, and an inter-agent event log',
      ],
    },
    {
      eyebrow: 'Local-first',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Bring any model — or run fully offline',
      desc: 'Per-Mind model preferences over xeno-rt’s OpenAI-compatible runtime, with cloud fallback when you allow it. The live loop is validated end-to-end on a real model (gpt-5.5).',
      bullets: [
        'xeno-rt (GGUF/ONNX) local, or Anthropic / OpenAI / Google in the cloud',
        'Per-Mind model preference with optional fallback',
        'BYO key via XENO_API_KEY — kept off the command line',
        'Offline echo driver for development without a model',
      ],
    },
    {
      eyebrow: 'Trust',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Signed personas, capability-scoped hands',
      desc: 'Minds and Souls carry Ed25519 signatures — provenance that loose, editable persona files can’t offer. Each Mind only gets the powers its manifest declares, default-deny.',
      bullets: [
        'Default-deny capability scoping (device · web · files · apps)',
        'Ed25519-signed Minds and earned Souls',
        'Tool use sandboxed to the Mind’s own workspace',
        'Confirmation hooks for destructive / host-path actions',
      ],
    },
    {
      eyebrow: 'Migrate',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Bring your SOUL.md — here it earns a Soul',
      desc: 'Import an OpenClaw brain or Hermes profile — including the 162+ community SOUL.md templates — straight into a mind.xeno, losslessly, and it starts learning from day one.',
      bullets: [
        'Reads the whole family: SOUL / IDENTITY / USER / AGENTS / MEMORY',
        'Splits earned-layer seeds (USER/MEMORY) out of the authored Mind',
        'Idempotent round-trip — export back to a SOUL.md family',
        'Your persona gains signing, scoping, inheritance & a real Soul',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'anima-swarm', alt: 'XENO Anima swarm — an orchestrator Mind decomposes a task across specialist Minds, hands off with context, and integrates the result' },
  ],
  useCases: [
    { title: 'One agent that’s truly yours', icon: 'Bot', desc: 'An always-on personal agent that remembers you across every session — not a chat that forgets. It carries its Soul from task to task and gets better the longer it runs.' },
    { title: 'A swarm that divides the work', icon: 'Network', desc: 'Give a big job to a coordinator Mind: it decomposes the work across specialists, they hand off with context, and it integrates the result — coordination the rivals lack.' },
    { title: 'Local, private, self-hosted', icon: 'Lock', desc: 'Run a Mind — or a whole swarm — entirely on your machine via xeno-rt. Souls are agent-owned and signed; nothing leaves your box unless you say so.' },
  ],
  howItWorks: [
    { step: '1', title: 'Install, then author a Mind', desc: 'npm install -g @xenosystem/anima (Node ≥ 20), then anima mind create — name it, give it a voice, values and scoped capabilities — or import an existing SOUL.md persona.' },
    { step: '2', title: 'Give it a model', desc: 'anima mind run --rt <xeno-rt url> to run local or cloud, BYO key. Skip --rt for the offline echo driver while you build.' },
    { step: '3', title: 'Let it live', desc: 'It recalls from its Soul, does the work, records what happened, and teaches itself skills. Add more Minds to form a swarm.' },
  ],
  comparison: {
    competitor: 'most personal-agent frameworks',
    rows: [
      { feature: 'Always-on personal agent', xeno: true, them: true },
      { feature: 'Structured, validated persona', xeno: 'mind.xeno', them: 'Loose markdown' },
      { feature: 'Portable, signed Soul (memory + skills)', xeno: true, them: 'Flat files' },
      { feature: 'Personas that coordinate (swarm)', xeno: true, them: false },
      { feature: 'Persona inheritance / mixins', xeno: true, them: false },
      { feature: 'Signed + capability-scoped', xeno: true, them: false },
      { feature: 'Local-first, bring any model', xeno: true, them: true },
      { feature: 'Maturity & ecosystem', xeno: 'Early (v0.0.2)', them: true },
    ],
  },
  specs: [
    { label: 'Install', value: 'npm install -g @xenosystem/anima' },
    { label: 'Runtime', value: 'Node ≥ 20' },
    { label: 'Inference', value: 'xeno-rt · BYO model' },
    { label: 'License', value: 'AGPL-3.0 · v0.0.2' },
    { label: 'Security', value: 'v0.0.1 deprecated — upgrade to 0.0.2' },
  ],
  faq: [
    { q: 'What’s the difference between a Mind and a Soul?', a: 'The Mind is the authored seed — a mind.xeno file with personality, values, boundaries and scoped capabilities. The Soul is what the agent earns at runtime: episodic memory, self-taught skills, evolved preferences and a model of the people it serves. A Mind is given; a Soul is earned.' },
    { q: 'Can I install it yet?', a: 'Yes — npm install -g @xenosystem/anima (Node ≥ 20). Anima ships as eight packages on npm at v0.0.2: the CLI plus the mind, soul, runtime, orchestrate, compat-soul, channels and format libraries. It is early, and honestly so: the Mind/Soul engine, the always-on runtime, tool-using turns and the swarm (broadcast, handoff, orchestrate) all work and are validated live against a real model, while channels via xeno-comms, device hands via xeno-use and the .xanima save format are the next milestones.' },
    { q: 'I installed 0.0.1 — do I need to upgrade?', a: 'Yes, upgrade now: npm install -g @xenosystem/anima@latest. Version 0.0.1 is deprecated on npm for a security defect — it is missing the SDK dispatch_agent permission gate, which means a delegated subagent can read protected files with no prompt. In other words, an agent you asked to delegate work could reach files you never approved. 0.0.2 restores the gate. If you are unsure which version you have, run anima --version.' },
    { q: 'How is it different from Hermes Agent or OpenClaw?', a: 'Anima is inspired by both and built on the full XENO platform. Two structural differences: the Mind/Soul split makes self-improvement a real, portable, signed artifact instead of a flat memory file; and Minds coordinate as a swarm (broadcast, handoff, orchestrate) where the rivals’ instances run in isolation. It also imports their SOUL.md personas so you can bring what you already have.' },
    { q: 'Can I run it locally and offline?', a: 'Yes — it’s local-first via xeno-rt (GGUF/ONNX), which is OpenAI-compatible, so a single Mind or a whole swarm can run entirely on your machine. Bring any model, and set a per-Mind cloud fallback (Anthropic/OpenAI/Google) only when you allow it.' },
    { q: 'Can I bring my existing persona?', a: 'Yes. Import an OpenClaw brain or Hermes profile — including the 162+ community SOUL.md templates — and it converts up into a mind.xeno, gaining inheritance, signing, capability scoping and a real Soul. It round-trips back to a SOUL.md family too, so you’re never locked in.' },
    { q: 'Is my agent’s memory private and portable?', a: 'Souls are agent-owned, Ed25519-signed, and stored under your home directory — never committed, and not embedded in a shared Mind by default. You can export, back up, or carry a Soul to a new Mind; forking a Mind does not clone its Soul.' },
  ],
  seo: {
    title: 'XENO Anima — a personal agent that earns a Soul',
    description: 'An always-on personal agent with an authored Mind that earns a Soul — episodic memory and self-taught skills, so it remembers you and gets better. Run one, or a swarm that coordinates. Local-first, bring any model. A Mind is given; a Soul is earned.',
  },
};

export default anima;

import type { ProductContent } from './_types';

/* XENO SDK — sourced from ../xeno-agent-sdk (README/CHANGELOG + src: create-agent.ts,
 * index.ts, src/ui, src/tools, src/providers). It's the TypeScript agent runtime the
 * whole platform embeds — v0.6.11, proprietary, "built from the same engine as XENO
 * Code". A `delivery: cli` product (npm install). Honest beta framing. */
const sdk: ProductContent = {
  slug: 'sdk',
  hero: {
    headline: 'The agent runtime inside every XENO app — now yours to embed.',
    sub: 'XENO SDK is the same TypeScript engine that powers XENO Code and the agent sidebar in Pixel, Motion and Sound. Register your app’s actions as tools, drop in the React chat panel, and ship an agent that reads, plans, asks permission and remembers — with any model, cloud or local.',
    media: { type: 'mockup', src: 'sdk-hero', alt: 'XENO SDK embedded in a host app — a createXenoAgent() tool registry on the left, the SDK’s React agent panel with a tool call and permission prompt on the right' },
    badges: ['npm · TypeScript', 'BYO model / local', 'React UI included', 'MCP · plugins'],
    note: 'Beta (v0.6.11) · proprietary. Embedded in 5+ XENO apps today. Model calls route through the XENO API, your own key, or a local runtime.',
  },
  trust: ['Node ≥ 20 · ESM · TypeScript 5.7', 'Same engine as XENO Code', 'Every tool call in a JSONL audit ledger'],
  highlights: [
    { value: 'One call', label: 'createXenoAgent() to embed' },
    { value: 'Any model', label: 'Cloud · local · OpenAI-compatible' },
    { value: 'React UI', label: 'Drop-in agent sidebar' },
    { value: 'Auditable', label: 'Every action logged' },
  ],
  features: [
    {
      eyebrow: 'Tools', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Your app’s actions become the agent’s tools',
      desc: 'A registry pattern: declare each operation with a description, an execute function, and confirm / destructive flags. The SDK handles dispatch, streaming and results.',
      bullets: [
        '6 built-in file tools: Read · Write · Edit · Glob · Grep · Bash',
        'Plus web search & fetch, git, and memory tools',
        'Per-tool confirm & destructive gates for user approval',
        'Opt-in JSON-schema validation so the model self-corrects',
      ],
    },
    {
      eyebrow: 'Agent loop', icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'A real agent loop, with permission built in',
      desc: 'It explores, plans, and acts — streaming output as it goes. Four permission modes and path sandboxing keep the user in control, and every decision lands in an audit ledger.',
      bullets: [
        'Permission modes: default · acceptEdits · plan · bypass',
        'Path sandboxing and destructive-action gates',
        'Streaming turns with an async, cancellable API',
        'JSON-lines audit log — who, what, when, result',
      ],
    },
    {
      eyebrow: 'Delegation', icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'A team of sub-agents, not one prompt',
      desc: 'Hand a task to a built-in planner → executor → reviewer workflow; a deterministic reducer merges the results by role precedence for reproducible runs.',
      bullets: [
        'planner / executor / reviewer sub-agents',
        'Deterministic reducer for reproducible merges',
        'dispatch-agent tool for in-loop delegation',
        'Per-agent budgets keep long runs bounded',
      ],
    },
    {
      eyebrow: 'Memory & Soul', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'It remembers how you work — and earns skills',
      desc: 'Four-level memory and identity (global → project → role → session) carry context across sessions. The Soul subsystem records each task and distills reusable, signed skills.',
      bullets: [
        '4-level memory with auto-capture & token budgets',
        '4-level identity hierarchy for personas & roles',
        'Soul: episodes → distilled Skills, Ed25519-signed',
        'Session persistence, checkpoints & crash recovery',
      ],
    },
    {
      eyebrow: 'Any model', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Provider-agnostic — cloud or fully local',
      desc: 'A pluggable LLMProvider interface routes the loop through any OpenAI-compatible backend. Use the hosted XENO API, your own key, or run offline on xeno-rt or Ollama.',
      bullets: [
        'XENO API (cloud) · xeno-rt & Ollama (local)',
        'Any OpenAI-compatible endpoint via one interface',
        'Pass your own LLMProvider to fully swap the transport',
        'No vendor lock-in — your keys, your models',
      ],
    },
    {
      eyebrow: 'Embed anywhere', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'React UI, Electron helpers, MCP & plugins',
      desc: 'A separate /ui entry ships the whole agent sidebar as React components. Or run the loop headless behind a JSON-RPC app-server, extend it with MCP servers, hooks and plugins.',
      bullets: [
        'AgentChatPanel, useAgent, permission & tool-call UI',
        'Electron bridge for renderer-process agents',
        'MCP servers, lifecycle hooks & a plugin system',
        'JSON-RPC app-server for headless / remote runs',
      ],
    },
  ],
  useCases: [
    { title: 'Agent-in-your-app', icon: 'Boxes', desc: 'Embed an agent sidebar that drives your app’s engine through tools — the same way Pixel, Motion and Sound do it.' },
    { title: 'Build an agent product', icon: 'Terminal', desc: 'Ship your own terminal or desktop agent on the exact loop that powers XENO Code — permissions, memory and audit included.' },
    { title: 'Headless automation', icon: 'Zap', desc: 'Run the loop server-side behind the JSON-RPC app-server or an MCP server, and wire it into pipelines and other agents.' },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'npm install @xeno-corporation/xeno-agent-sdk — ESM, Node ≥ 20, TypeScript types included.' },
    { step: '2', title: 'Register your tools', desc: 'Map your app’s actions to a tool registry, then call createXenoAgent({ tools, model }).' },
    { step: '3', title: 'Drop in the UI', desc: 'Mount AgentChatPanel + useAgent from /ui — or run the loop headless. Every action is audited.' },
  ],
  comparison: {
    competitor: 'most agent frameworks',
    rows: [
      { feature: 'Full agent loop (read · plan · act)', xeno: true, them: true },
      { feature: 'Embeddable React chat UI included', xeno: true, them: 'Add-on' },
      { feature: 'Permission modes + path sandboxing', xeno: true, them: 'Varies' },
      { feature: 'Built-in JSONL audit ledger', xeno: true, them: false },
      { feature: 'Planner/executor/reviewer delegation', xeno: 'Built in', them: 'DIY' },
      { feature: 'Provider-agnostic (cloud + local)', xeno: true, them: true },
      { feature: 'Ecosystem, plugins & community', xeno: 'Growing', them: true },
    ],
  },
  specs: [
    { label: 'Install', value: 'npm · ESM' },
    { label: 'Runtime', value: 'Node ≥ 20 · TS 5.7' },
    { label: 'UI', value: 'React 18+ (optional peer)' },
    { label: 'Version', value: '0.6.11 · beta' },
  ],
  faq: [
    { q: 'How is the SDK different from the Agent CLI?', a: 'The Agent CLI is the terminal app you run; the SDK is the library it’s built on. If you want to embed the same agent engine — the loop, tools, permissions, memory and audit — inside your own app, you use the SDK.' },
    { q: 'How do I embed an agent?', a: 'Register your app’s operations as a tool registry (each with a description, an execute function, and confirm/destructive flags), then call createXenoAgent({ tools, model }). Optionally mount the /ui React panel to get a full chat sidebar.' },
    { q: 'Which models can it use?', a: 'It’s provider-agnostic. Use the hosted XENO API, your own key, or run fully local on the xeno-rt runtime or Ollama — any OpenAI-compatible endpoint works, and you can pass your own LLMProvider to swap the transport entirely.' },
    { q: 'Do I have to use React?', a: 'No. The core SDK is headless and has no DOM dependency. The React components live in a separate /ui entry point with React as an optional peer dependency — import them only if you want the pre-built agent sidebar.' },
    { q: 'Is it safe to let the agent run tools?', a: 'You stay in control: four permission modes (default, acceptEdits, plan, bypass), path sandboxing, and destructive-action gates. Every tool call and permission decision is appended to a JSON-lines audit ledger.' },
    { q: 'Is it open source or free?', a: 'It’s proprietary and in beta (v0.6.11). The package is free to install; model calls route through the XENO API (billed), your own key, or a local model at no cost.' },
  ],
  seo: {
    title: 'XENO SDK — embed an AI agent into any app',
    description: 'The TypeScript agent runtime behind every XENO app. Register your actions as tools, drop in the React chat panel, and ship an agent with permissions, memory, delegation and an audit ledger — any model, cloud or local.',
  },
};

export default sdk;

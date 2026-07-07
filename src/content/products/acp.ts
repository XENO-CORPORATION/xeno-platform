import type { ProductContent } from './_types';

/* XENO ACP — sourced from ../xeno-acp (README + docs/SPEC.md + docs/ARCHITECTURE.md).
 * A Layer-3 (Agent & Automation) component: the XENO ecosystem's single client for
 * the Agent Client Protocol (ACP). It plays the ACP *client*, supervises approved
 * ACP agents (Claude Code, Codex, OpenCode, Gemini, Kimi, GLM), and re-exposes them
 * two ways — embedded in-process (@xeno-acp/core, structured events) or over an
 * OpenAI-compatible HTTP gateway (@xeno-acp/server, flattened to text/SSE).
 *
 * Honest framing: private developer alpha (0.1.0-alpha.2), Apache-2.0. Single-owner
 * scope — each agent uses YOUR OWN provider logins; it does not pool or resell.
 * Not publicly downloadable yet → coming-soon / waitlist. */
const acp: ProductContent = {
  slug: 'acp',
  hero: {
    headline: 'Every coding agent, behind one API.',
    sub: 'XENO ACP speaks the Agent Client Protocol to Claude Code, Codex, Gemini and more — then re-exposes them two ways: embedded in-process for full tool, diff and plan events, or over an OpenAI-compatible HTTP gateway. Bring your own logins; every session runs sandboxed.',
    media: { type: 'mockup', src: 'acp-hero', alt: 'XENO ACP gateway console — an OpenAI request driven through the Claude Code ACP agent, projected into structured tool_call, diff, plan and message events' },
    badges: ['OpenAI-compatible', 'Embed or HTTP', 'Your own logins', 'Apache-2.0'],
    note: 'Private developer alpha (0.1.0-alpha.2) · single-owner scope — each agent uses your own provider logins, never pooled or resold.',
  },
  trust: ['Layer 3 — Agent & Automation', 'Built on the official Apache-2.0 ACP SDK', 'Your own logins — no pooling, no reselling'],
  highlights: [
    { value: 'Any ACP agent', label: 'Claude Code · Codex · Gemini +' },
    { value: 'Embed or HTTP', label: 'In-process + OpenAI API' },
    { value: 'Tools · diffs · plans', label: 'Structured, not just text' },
    { value: 'Sandboxed', label: 'Per-session · no shell' },
  ],
  features: [
    {
      eyebrow: 'One protocol', icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Any ACP agent, one client',
      desc: 'ACP is to coding agents what LSP is to language servers: one protocol, any client ↔ any agent. XENO ACP plays the client side and drives them all.',
      bullets: [
        'Built-in definitions for Claude Code, Codex, OpenCode, Gemini, Kimi & GLM',
        'Add any other ACP agent by config — no code change',
        'JSON-RPC 2.0 over stdio; protocol version negotiated at initialize',
        'Windows-safe launch (.cmd shims routed through cmd /c, no shell)',
      ],
    },
    {
      eyebrow: 'Two surfaces', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Embed it, or call it over HTTP',
      desc: 'The same engine, two ways to consume: import it for full structured access, or point any OpenAI client at the gateway and route by model id.',
      bullets: [
        '@xeno-acp/core — embed in-process, get typed agent events',
        '@xeno-acp/server — OpenAI-compatible /v1/chat/completions + /v1/models',
        'Existing LLMProvider clients work unchanged — just change baseURL',
        'Per-app bearer keys for attribution and allowlists',
      ],
    },
    {
      eyebrow: 'Structured', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Tools, diffs and plans — not just text',
      desc: 'Agents run a real agentic loop: read files, run terminals, call MCP servers, edit code. In-process you see every step; over HTTP it flattens to text/SSE.',
      bullets: [
        'flatten() maps ACP session updates → OpenAI deltas',
        'tool_call, plan, diff and message events in-process',
        'verbose mode narrates tools & plans into the text stream',
        'Flattening never disables tools — the agent still does the work',
      ],
    },
    {
      eyebrow: 'Sandboxed', icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Headless, but contained',
      desc: 'Auto-approval lets agents run non-interactively — so every session gets an isolated workspace and every action is bounded by it.',
      bullets: [
        'Per-session sandbox workspace, path-traversal guarded',
        'fs / terminal / permission handled by the client, policy-gated',
        'No shell:true anywhere — commands resolved & spawned shell:false',
        'Honest gaps: no network-egress controls yet; local keys are plaintext',
      ],
    },
    {
      eyebrow: 'Your credentials', icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Bring your own logins',
      desc: 'Each agent authenticates with your own provider credentials. The gateway routes; it does not pool or resell access — the sanctioned, ToS-safe path.',
      bullets: [
        'Claude Max, ChatGPT, Google, Kimi, Z.AI — your own accounts',
        'Single-owner, many-internal-apps scope (not a public reseller)',
        'Official ACP adapters & native --acp modes only',
        'Local adapters use the operator’s own installed CLIs',
      ],
    },
    {
      eyebrow: 'Fits the ecosystem', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'One capability the whole platform can call',
      desc: 'Sibling to xeno-rt (raw inference) and xeno-agent-sdk (tool/identity runtime). Where xeno-rt serves models, XENO ACP serves agents.',
      bullets: [
        'Consumed in-process by agent-sdk, workflow, use, agent-cli & Hub',
        'Consumed over HTTP by anything that speaks the OpenAI chat format',
        'Hermetic, deterministic test suite against a fixture ACP agent',
        'TypeScript + Node 20+ + Fastify; Apache-2.0',
      ],
    },
  ],
  useCases: [
    { title: 'XENO ecosystem apps', icon: 'Boxes', desc: 'One import lets agent-sdk, workflow, use or Hub drive any ACP agent in-process — with full tool, diff and plan events, not a copy-pasted transcript.' },
    { title: 'OpenAI-compatible clients', icon: 'Globe', desc: 'Point any existing OpenAI client or LLMProvider at the gateway, list agents from /v1/models, and route a whole agentic run by model id.' },
    { title: 'Safe headless automation', icon: 'ShieldCheck', desc: 'Run agents non-interactively for CI and pipelines — each session confined to a sandboxed workspace, spawned with no shell, capabilities policy-gated.' },
  ],
  howItWorks: [
    { step: '1', title: 'Configure agents', desc: 'Copy xeno-acp.config.jsonc, list the ACP agents you want and per-app keys. Add any conforming agent — no code change.' },
    { step: '2', title: 'Start or embed', desc: 'Run the gateway (pnpm --filter @xeno-acp/server dev), or embed AcpManager from @xeno-acp/core in your own project.' },
    { step: '3', title: 'Drive an agent', desc: 'POST /v1/chat/completions with a model id, or iterate acp.prompt(...) in-process — reading files, editing code and running commands, sandboxed.' },
  ],
  comparison: {
    competitor: 'most agent runtimes',
    rows: [
      { feature: 'One protocol for any ACP agent', xeno: true, them: 'Per-tool SDKs' },
      { feature: 'Structured tool / diff / plan events in-process', xeno: true, them: false },
      { feature: 'OpenAI-compatible HTTP surface', xeno: true, them: 'Varies' },
      { feature: 'Per-session sandbox + no-shell spawn', xeno: true, them: 'Varies' },
      { feature: 'Uses your own provider logins (no reselling)', xeno: true, them: 'Varies' },
      { feature: 'Maturity & ecosystem', xeno: 'Private alpha', them: true },
    ],
  },
  specs: [
    { label: 'Protocol', value: 'ACP over stdio · v1' },
    { label: 'Surfaces', value: '@xeno-acp/core · /server' },
    { label: 'Stack', value: 'TypeScript · Node 20+ · Fastify' },
    { label: 'License', value: 'Apache-2.0 · private alpha' },
  ],
  faq: [
    { q: 'What is ACP?', a: 'The Agent Client Protocol — think LSP, but for AI coding agents. One protocol lets any client drive any conforming agent (Claude Code, Codex, OpenCode, Gemini, Kimi, GLM). XENO ACP plays the client side and re-exposes those agents to the rest of the ecosystem.' },
    { q: 'How do I consume it?', a: 'Two ways. Embed @xeno-acp/core in-process for a typed API that returns structured agent events (tool calls, diffs, plans, edits). Or hit @xeno-acp/server, an OpenAI-compatible HTTP gateway — POST /v1/chat/completions and route by model id.' },
    { q: 'Does flattening to OpenAI text disable the tools?', a: 'No. The agent still performs every file, terminal and MCP action inside its workspace — flattening only chooses how much of that is narrated back over the text/SSE stream. Use the in-process API when you want the full structured events.' },
    { q: 'Is it safe to run agents headless?', a: 'Permissions are auto-approved so agents run non-interactively, so every session gets an isolated sandbox workspace (path-traversal guarded) and processes spawn with no shell. Honest gaps for now: there are no network-egress controls, and bearer keys are plaintext in local config — fine only for the single-owner scope.' },
    { q: 'Can I resell access to my provider subscriptions through it?', a: 'No. The scope is one owner, many internal apps: each agent uses your own provider logins, and the gateway routes without pooling or reselling access. Multi-tenant use would require bring-your-own-credentials per tenant and a ToS review — explicitly out of scope.' },
    { q: 'Which agents work today, and can I use it?', a: 'It ships data-driven definitions for Claude Code, Codex, OpenCode, Gemini, Kimi and GLM (add any other via config). It is a private developer alpha (0.1.0-alpha.2) on the internal XENO stack — join the waitlist and we’ll reach out.' },
  ],
  seo: {
    title: 'XENO ACP — one client for every coding agent',
    description: 'The XENO ecosystem’s adapter to the Agent Client Protocol. Drive Claude Code, Codex, Gemini and more — embedded in-process for structured tool/diff/plan events, or over an OpenAI-compatible HTTP gateway. Bring your own logins; sandboxed by session. Apache-2.0, private alpha.',
  },
};

export default acp;
